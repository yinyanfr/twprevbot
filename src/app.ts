import { rm } from "node:fs/promises";
import { Bot, type Context, InputFile } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { loadConfig } from "./configs/index.js";
import {
  cleanupStaleBilibiliTempDirs,
  fetchBilibiliPreview,
  fetchTwitterThread,
} from "./services/index.js";
import {
  buildInlineResult,
  buildAppendedMessage,
  buildTelegramPreview,
  ActiveBilibiliRequests,
  extractBilibiliUrls,
  extractTweetUrls,
  getUploadedMediaFallbackTypes,
  logger,
  normalizeThreadResponse,
  SerialTaskQueue,
  startRepeatingChatAction,
} from "./libs/index.js";
import type {
  BilibiliUrl,
  PreviewPost,
  TelegramMediaGroupItem,
} from "./libs/index.js";

type SentMessage = {
  replyMessageId: number;
  appendTarget?: {
    messageId: number;
    content: {
      kind: "text" | "caption";
      html: string;
      text: string;
    };
  };
};

const config = loadConfig();
const bot = new Bot(config.botToken, {
  client: {
    ...(config.telegramApiRoot !== undefined
      ? { apiRoot: config.telegramApiRoot }
      : {}),
    ...(config.telegramLocalMode ? { timeoutSeconds: 60 * 60 } : {}),
  },
});

const TELEGRAM_RETRY_OPTIONS = {
  maxRetryAttempts: 2,
  maxDelaySeconds: 30,
  rethrowHttpErrors: true,
};
const MEDIA_DOWNLOAD_TIMEOUT_MS = 30_000;
const MEMORY_LOG_INTERVAL_MS = 60 * 60 * 1000;
const activeBilibiliRequests = new ActiveBilibiliRequests(2);
const bilibiliTaskQueue = new SerialTaskQueue();

type AcceptedBilibiliUrl = {
  url: BilibiliUrl;
  release: () => void;
};

bot.api.config.use(autoRetry(TELEGRAM_RETRY_OPTIONS));

startMemoryMetricsLogging();

bot.on("message:text", (ctx) => {
  const text = ctx.message.text;
  const tweetUrls = extractTweetUrls(text);
  const bilibiliUrls: AcceptedBilibiliUrl[] = [];

  for (const url of extractBilibiliUrls(text)) {
    const result = activeBilibiliRequests.acquire(ctx.chat.id, url);

    if (result.kind === "accepted") {
      bilibiliUrls.push({ url, release: result.release });
      continue;
    }

    if (result.kind === "duplicate") {
      if (result.shouldNotify) {
        void replyToSourceMessage(ctx, "该链接正在处理中，请稍候。", url.url);
      }
      continue;
    }

    void replyToSourceMessage(ctx, "当前任务较多，请稍后再试。", url.url);
  }

  if (tweetUrls.length === 0 && bilibiliUrls.length === 0) {
    return;
  }

  void processMessageText(ctx, tweetUrls, bilibiliUrls).catch((error) => {
    logger.error(
      { err: error, messageId: ctx.message.message_id },
      "Failed to process message text",
    );
  });
});

async function processMessageText(
  ctx: Context & { message: { message_id: number } },
  tweetUrls: ReturnType<typeof extractTweetUrls>,
  bilibiliUrls: AcceptedBilibiliUrl[],
): Promise<void> {
  const stopChatAction = startRepeatingChatAction(
    () => ctx.replyWithChatAction("typing"),
    {
      onError: (error) => {
        logger.warn(
          { err: error, chatId: ctx.chat?.id },
          "Failed to send repeating chat action",
        );
      },
    },
  );
  const bilibiliTasks = bilibiliUrls.map((bilibiliRequest) =>
    bilibiliTaskQueue
      .run(() => processBilibiliRequest(ctx, bilibiliRequest.url))
      .finally(bilibiliRequest.release),
  );

  try {
    for (const tweetUrl of tweetUrls) {
      try {
        const response = await fetchTwitterThread(tweetUrl.id);
        const posts = normalizeThreadResponse(response);

        let replyToMessageId = ctx.message.message_id;
        let previousMessage: SentMessage | undefined;

        for (const post of posts) {
          if (
            post.media.length === 0 &&
            previousMessage?.appendTarget !== undefined
          ) {
            const appendedMessage = await appendTextToPreviousMessage(
              ctx,
              previousMessage.appendTarget,
              post,
            );

            if (appendedMessage !== undefined) {
              previousMessage = {
                ...previousMessage,
                appendTarget: appendedMessage,
              };
              continue;
            }
          }

          try {
            const sentMessage = await sendPreview(ctx, post, replyToMessageId);
            replyToMessageId = sentMessage.replyMessageId;
            previousMessage = sentMessage;
          } finally {
            await cleanupPreviewFiles(post);
          }
        }
      } catch (error) {
        logger.error(
          { err: error, tweetId: tweetUrl.id },
          "Failed to process tweet",
        );
        await replyToSourceMessage(
          ctx,
          `读取失败：${tweetUrl.url}`,
          tweetUrl.url,
        );
      }
    }

    await Promise.all(bilibiliTasks);
  } finally {
    await Promise.allSettled(bilibiliTasks);
    stopChatAction();
    for (const bilibiliRequest of bilibiliUrls) {
      bilibiliRequest.release();
    }
  }
}

async function processBilibiliRequest(
  ctx: Context & { message: { message_id: number } },
  bilibiliUrl: BilibiliUrl,
): Promise<void> {
  try {
    const post = await fetchBilibiliPreview(bilibiliUrl, fetch, {
      ...(config.bilibiliCookieFile !== undefined
        ? { cookieFile: config.bilibiliCookieFile }
        : {}),
      ...(config.ytDlpPath !== undefined
        ? { ytDlpPath: config.ytDlpPath }
        : {}),
      ...(config.ffmpegPath !== undefined
        ? { ffmpegPath: config.ffmpegPath }
        : {}),
      telegramLocalMode: config.telegramLocalMode,
    });

    if (post === null) {
      return;
    }

    try {
      await sendPreview(ctx, post, ctx.message.message_id);
    } finally {
      await cleanupPreviewFiles(post);
    }
  } catch (error) {
    logger.error(
      { err: error, bilibiliUrl: bilibiliUrl.url },
      "Failed to process bilibili video",
    );
    await replyToSourceMessage(
      ctx,
      `读取失败：${bilibiliUrl.url}`,
      bilibiliUrl.url,
    );
  }
}

async function replyToSourceMessage(
  ctx: Context & { message: { message_id: number } },
  message: string,
  bilibiliUrl: string,
): Promise<void> {
  try {
    await ctx.reply(message, {
      reply_parameters: { message_id: ctx.message.message_id },
    });
  } catch (error) {
    logger.warn(
      { err: error, bilibiliUrl },
      "Failed to send Bilibili request status",
    );
  }
}

bot.on("inline_query", async (ctx) => {
  const query = ctx.inlineQuery.query;
  const tweetUrls = extractTweetUrls(query);

  if (tweetUrls.length === 0) {
    await ctx.answerInlineQuery([], {
      button: {
        text: "发送 Twitter/X 链接以生成预览",
        start_parameter: "inline",
      },
    });
    return;
  }

  const tweetUrl = tweetUrls[0]!;
  const response = await fetchTwitterThread(tweetUrl.id);
  const posts = normalizeThreadResponse(response);
  const result = buildInlineResult(posts);

  if (result === null) {
    await ctx.answerInlineQuery([]);
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await ctx.answerInlineQuery([result as any]);
});

async function sendPreview(
  ctx: Context,
  post: PreviewPost,
  replyToMessageId: number,
): Promise<SentMessage> {
  const preview = buildTelegramPreview(post);

  if (preview.kind === "text") {
    try {
      const message = await ctx.reply(preview.html, {
        parse_mode: "HTML",
        reply_parameters: { message_id: replyToMessageId },
      });
      return {
        replyMessageId: message.message_id,
        appendTarget: {
          messageId: message.message_id,
          content: { kind: "text", html: preview.html, text: preview.text },
        },
      };
    } catch {
      const message = await ctx.reply(preview.text, {
        reply_parameters: { message_id: replyToMessageId },
      });
      return {
        replyMessageId: message.message_id,
        appendTarget: {
          messageId: message.message_id,
          content: { kind: "text", html: preview.html, text: preview.text },
        },
      };
    }
  }

  if (preview.media.length === 1) {
    return await sendSingleMedia(ctx, preview, replyToMessageId, post.url);
  }

  return await sendMediaGroup(ctx, preview, replyToMessageId, post.url);
}

async function sendSingleMedia(
  ctx: Context,
  preview: { html: string; text: string; media: TelegramMediaGroupItem[] },
  replyToMessageId: number,
  tweetUrl: string,
): Promise<SentMessage> {
  const media = preview.media[0]!;
  let uploadedMedia: InputFile | undefined;
  const spoiler = media.has_spoiler === true ? { has_spoiler: true } : {};
  const captionHtml = {
    caption: preview.html,
    parse_mode: "HTML" as const,
    reply_parameters: { message_id: replyToMessageId },
    ...spoiler,
  };
  const captionText = {
    caption: preview.text,
    reply_parameters: { message_id: replyToMessageId },
    ...spoiler,
  };
  const mediaCaptionHtml = withVideoDimensions(media, captionHtml);
  const mediaCaptionText = withVideoDimensions(media, captionText);

  if (media.forceUpload === true) {
    return await sendSingleUploadedMedia(
      ctx,
      preview,
      replyToMessageId,
      tweetUrl,
      media,
      mediaCaptionHtml,
      mediaCaptionText,
    );
  }

  try {
    const message = await sendOne(
      ctx,
      media.type,
      media.media,
      mediaCaptionHtml,
    );
    return {
      replyMessageId: message.message_id,
      appendTarget: {
        messageId: message.message_id,
        content: { kind: "caption", html: preview.html, text: preview.text },
      },
    };
  } catch (error) {
    logger.warn(
      { err: error, tweetUrl, mediaUrl: media.media, mediaType: media.type },
      "Failed to send media with HTML caption",
    );

    try {
      const message = await sendOne(
        ctx,
        media.type,
        media.media,
        mediaCaptionText,
      );
      return {
        replyMessageId: message.message_id,
        appendTarget: {
          messageId: message.message_id,
          content: { kind: "caption", html: preview.html, text: preview.text },
        },
      };
    } catch (retryError) {
      logger.warn(
        {
          err: retryError,
          tweetUrl,
          mediaUrl: media.media,
          mediaType: media.type,
        },
        "Failed to send media with plain caption",
      );

      try {
        uploadedMedia ??= await downloadMedia(media.media, media.type);
        const message = await sendOne(
          ctx,
          media.type,
          uploadedMedia,
          mediaCaptionHtml,
        );
        return {
          replyMessageId: message.message_id,
          appendTarget: {
            messageId: message.message_id,
            content: {
              kind: "caption",
              html: preview.html,
              text: preview.text,
            },
          },
        };
      } catch (uploadError) {
        logger.warn(
          {
            err: uploadError,
            tweetUrl,
            mediaUrl: media.media,
            mediaType: media.type,
          },
          "Failed to upload downloaded media with HTML caption",
        );

        try {
          uploadedMedia ??= await downloadMedia(media.media, media.type);
          const message = await sendOne(
            ctx,
            media.type,
            uploadedMedia,
            mediaCaptionText,
          );
          return {
            replyMessageId: message.message_id,
            appendTarget: {
              messageId: message.message_id,
              content: {
                kind: "caption",
                html: preview.html,
                text: preview.text,
              },
            },
          };
        } catch (plainUploadError) {
          logger.warn(
            {
              err: plainUploadError,
              tweetUrl,
              mediaUrl: media.media,
              mediaType: media.type,
            },
            "Failed to upload downloaded media with plain caption",
          );

          const message = await ctx.reply(`${preview.text}\n\n${tweetUrl}`, {
            reply_parameters: { message_id: replyToMessageId },
          });
          return {
            replyMessageId: message.message_id,
            appendTarget: {
              messageId: message.message_id,
              content: {
                kind: "text",
                html: `${preview.html}\n\n${tweetUrl}`,
                text: `${preview.text}\n\n${tweetUrl}`,
              },
            },
          };
        }
      }
    }
  }
}

function withVideoDimensions(
  media: TelegramMediaGroupItem,
  options: Record<string, unknown>,
): Record<string, unknown> {
  if (media.type !== "video") {
    return options;
  }

  return {
    ...options,
    ...(media.width !== undefined ? { width: media.width } : {}),
    ...(media.height !== undefined ? { height: media.height } : {}),
    ...(media.duration !== undefined ? { duration: media.duration } : {}),
    ...(media.supportsStreaming === true ? { supports_streaming: true } : {}),
    ...(media.thumbnailUrl !== undefined
      ? { cover: media.thumbnailUrl.replace(/^http:/, "https:") }
      : {}),
  };
}

async function sendSingleUploadedMedia(
  ctx: Context,
  preview: { html: string; text: string; media: TelegramMediaGroupItem[] },
  replyToMessageId: number,
  sourceUrl: string,
  media: TelegramMediaGroupItem,
  captionHtml: Record<string, unknown>,
  captionText: Record<string, unknown>,
): Promise<SentMessage> {
  let uploadedMedia: InputFile | undefined;
  const uploadMediaTypes =
    media.type !== "photo" && media.allowDocumentFallback === false
      ? [media.type]
      : getUploadedMediaFallbackTypes(media.type);

  try {
    uploadedMedia ??= await getUploadedMedia(media);
    for (const uploadMediaType of uploadMediaTypes) {
      try {
        const message = await sendOne(
          ctx,
          uploadMediaType,
          uploadedMedia,
          captionHtml,
        );
        return {
          replyMessageId: message.message_id,
          appendTarget: {
            messageId: message.message_id,
            content: {
              kind: "caption",
              html: preview.html,
              text: preview.text,
            },
          },
        };
      } catch (error) {
        logger.warn(
          {
            err: error,
            sourceUrl,
            mediaUrl: media.media,
            mediaType: uploadMediaType,
          },
          "Failed to upload downloaded media with HTML caption",
        );
      }
    }
  } catch (error) {
    logger.warn(
      { err: error, sourceUrl, mediaUrl: media.media, mediaType: media.type },
      "Failed to download media for upload",
    );
  }

  if (media.type !== "photo" && media.preserveHtmlCaption === true) {
    return await sendHtmlTextFallback(
      ctx,
      preview,
      replyToMessageId,
      sourceUrl,
    );
  }

  try {
    uploadedMedia ??= await getUploadedMedia(media);
    for (const uploadMediaType of uploadMediaTypes) {
      try {
        const message = await sendOne(
          ctx,
          uploadMediaType,
          uploadedMedia,
          captionText,
        );
        return {
          replyMessageId: message.message_id,
          appendTarget: {
            messageId: message.message_id,
            content: {
              kind: "caption",
              html: preview.html,
              text: preview.text,
            },
          },
        };
      } catch (plainUploadError) {
        logger.warn(
          {
            err: plainUploadError,
            sourceUrl,
            mediaUrl: media.media,
            mediaType: uploadMediaType,
          },
          "Failed to upload downloaded media with plain caption",
        );
      }
    }
  } catch (downloadError) {
    logger.warn(
      {
        err: downloadError,
        sourceUrl,
        mediaUrl: media.media,
        mediaType: media.type,
      },
      "Failed to download media for plain upload fallback",
    );
  }

  const message = await ctx.reply(preview.text, {
    reply_parameters: { message_id: replyToMessageId },
  });
  return {
    replyMessageId: message.message_id,
    appendTarget: {
      messageId: message.message_id,
      content: {
        kind: "text",
        html: preview.html,
        text: preview.text,
      },
    },
  };
}

async function sendHtmlTextFallback(
  ctx: Context,
  preview: { html: string; text: string },
  replyToMessageId: number,
  sourceUrl: string,
): Promise<SentMessage> {
  try {
    const message = await ctx.reply(preview.html, {
      parse_mode: "HTML",
      reply_parameters: { message_id: replyToMessageId },
    });
    return {
      replyMessageId: message.message_id,
      appendTarget: {
        messageId: message.message_id,
        content: { kind: "text", html: preview.html, text: preview.text },
      },
    };
  } catch (error) {
    logger.warn(
      { err: error, sourceUrl },
      "Failed to send HTML media fallback",
    );
    const message = await ctx.reply(preview.text, {
      reply_parameters: { message_id: replyToMessageId },
    });
    return {
      replyMessageId: message.message_id,
      appendTarget: {
        messageId: message.message_id,
        content: { kind: "text", html: preview.html, text: preview.text },
      },
    };
  }
}

async function getUploadedMedia(
  media: TelegramMediaGroupItem,
): Promise<InputFile> {
  if (media.localFilePath !== undefined) {
    return new InputFile(media.localFilePath);
  }

  return await downloadMedia(media.media, media.type, media.downloadHeaders);
}

async function sendOne(
  ctx: Context,
  mediaType: TelegramMediaGroupItem["type"],
  media: string | InputFile,
  other: Record<string, unknown>,
): Promise<{ message_id: number }> {
  switch (mediaType) {
    case "photo":
      return await ctx.replyWithPhoto(media, other);
    case "video":
      return await ctx.replyWithVideo(media, other);
    case "document":
      return await ctx.replyWithDocument(media, other);
  }
}

async function downloadMedia(
  url: string,
  mediaType: TelegramMediaGroupItem["type"],
  headers?: Record<string, string>,
): Promise<InputFile> {
  const response = await fetch(url, {
    ...(headers !== undefined ? { headers } : {}),
    signal: AbortSignal.timeout(MEDIA_DOWNLOAD_TIMEOUT_MS),
  });

  if (!response.ok) {
    await cancelResponseBody(response);
    throw new Error(
      `Failed to download media: ${response.status} ${response.statusText}`,
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  return new InputFile(bytes, buildMediaFilename(url, mediaType));
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Ignore cancellation failures on already-closed bodies.
  }
}

function buildMediaFilename(
  url: string,
  mediaType: TelegramMediaGroupItem["type"],
): string {
  const pathname = new URL(url).pathname;
  const filename = pathname.split("/").at(-1);

  if (filename !== undefined && filename.length > 0) {
    return filename;
  }

  switch (mediaType) {
    case "photo":
      return "media.jpg";
    case "video":
      return "media.mp4";
    case "document":
      return "media.bin";
  }
}

async function sendMediaGroup(
  ctx: Context,
  preview: { html: string; text: string; media: TelegramMediaGroupItem[] },
  replyToMessageId: number,
  tweetUrl: string,
): Promise<SentMessage> {
  try {
    const messages = await ctx.replyWithMediaGroup(preview.media, {
      reply_parameters: { message_id: replyToMessageId },
    });
    const firstMessageId = messages[0]?.message_id ?? replyToMessageId;
    return {
      replyMessageId: messages.at(-1)?.message_id ?? replyToMessageId,
      appendTarget: {
        messageId: firstMessageId,
        content: { kind: "caption", html: preview.html, text: preview.text },
      },
    };
  } catch (error) {
    logger.warn(
      {
        err: error,
        tweetUrl,
        mediaUrls: preview.media.map((item) => item.media),
        mediaTypes: preview.media.map((item) => item.type),
      },
      "Failed to send media group with HTML caption",
    );

    try {
      const plainMedia: TelegramMediaGroupItem[] = preview.media.map(
        (item, index) => ({
          type: item.type,
          media: item.media,
          ...(index === 0 ? { caption: preview.text } : {}),
        }),
      );
      const messages = await ctx.replyWithMediaGroup(plainMedia, {
        reply_parameters: { message_id: replyToMessageId },
      });
      const firstMessageId = messages[0]?.message_id ?? replyToMessageId;
      return {
        replyMessageId: messages.at(-1)?.message_id ?? replyToMessageId,
        appendTarget: {
          messageId: firstMessageId,
          content: { kind: "caption", html: preview.html, text: preview.text },
        },
      };
    } catch (retryError) {
      logger.warn(
        {
          err: retryError,
          tweetUrl,
          mediaUrls: preview.media.map((item) => item.media),
          mediaTypes: preview.media.map((item) => item.type),
        },
        "Failed to send media group with plain caption",
      );

      const message = await ctx.reply(`${preview.text}\n\n${tweetUrl}`, {
        reply_parameters: { message_id: replyToMessageId },
      });
      return {
        replyMessageId: message.message_id,
        appendTarget: {
          messageId: message.message_id,
          content: {
            kind: "text",
            html: `${preview.html}\n\n${tweetUrl}`,
            text: `${preview.text}\n\n${tweetUrl}`,
          },
        },
      };
    }
  }
}

async function appendTextToPreviousMessage(
  ctx: Context,
  appendTarget: SentMessage["appendTarget"],
  post: PreviewPost,
): Promise<SentMessage["appendTarget"] | undefined> {
  if (appendTarget === undefined || ctx.chatId === undefined) {
    return undefined;
  }

  const preview = buildTelegramPreview(post);

  if (preview.kind !== "text") {
    return undefined;
  }

  const appended = buildAppendedMessage(appendTarget.content, preview);

  if (!appended.canUseHtml && !appended.canUseText) {
    return undefined;
  }

  if (appended.canUseHtml) {
    try {
      await editSentMessage(
        ctx,
        appendTarget.messageId,
        appendTarget.content.kind,
        appended.html,
        "html",
      );
      return {
        messageId: appendTarget.messageId,
        content: {
          kind: appended.kind,
          html: appended.html,
          text: appended.text,
        },
      };
    } catch (error) {
      logger.warn(
        { err: error, postUrl: post.url, messageId: appendTarget.messageId },
        "Failed to append thread text with HTML formatting",
      );
    }
  }

  if (appended.canUseText) {
    try {
      await editSentMessage(
        ctx,
        appendTarget.messageId,
        appendTarget.content.kind,
        appended.text,
        "text",
      );
      return {
        messageId: appendTarget.messageId,
        content: {
          kind: appended.kind,
          html: appended.html,
          text: appended.text,
        },
      };
    } catch (error) {
      logger.warn(
        { err: error, postUrl: post.url, messageId: appendTarget.messageId },
        "Failed to append thread text with plain formatting",
      );
    }
  }

  return undefined;
}

async function editSentMessage(
  ctx: Context,
  messageId: number,
  kind: "text" | "caption",
  content: string,
  mode: "html" | "text",
): Promise<void> {
  if (kind === "text") {
    await ctx.api.editMessageText(ctx.chatId!, messageId, content, {
      ...(mode === "html" ? { parse_mode: "HTML" as const } : {}),
    });
    return;
  }

  await ctx.api.editMessageCaption(ctx.chatId!, messageId, {
    caption: content,
    ...(mode === "html" ? { parse_mode: "HTML" as const } : {}),
  });
}

async function cleanupPreviewFiles(post: PreviewPost): Promise<void> {
  for (const cleanupPath of post.cleanupPaths ?? []) {
    try {
      await rm(cleanupPath, { recursive: true, force: true });
    } catch (error) {
      logger.warn(
        { err: error, cleanupPath, postUrl: post.url },
        "Failed to clean up preview files",
      );
    }
  }
}

bot.catch((error) => {
  logger.error(error, "Bot error");
});

function startMemoryMetricsLogging(): void {
  const timer = setInterval(() => {
    const memory = process.memoryUsage();
    logger.info(
      {
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
        external: memory.external,
        arrayBuffers: memory.arrayBuffers,
      },
      "Process memory snapshot",
    );
  }, MEMORY_LOG_INTERVAL_MS);

  timer.unref();
}

try {
  await cleanupStaleBilibiliTempDirs();
} catch (error) {
  logger.warn({ err: error }, "Failed to clean up stale Bilibili temp files");
}

await bot.start({
  onStart(botInfo) {
    logger.info({ username: botInfo.username }, "Bot started");
  },
});
