import { Bot, type Context } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { loadConfig } from "./configs/index.js";
import { fetchTwitterThread } from "./services/index.js";
import {
  buildInlineResult,
  buildTelegramPreview,
  extractTweetUrls,
  logger,
  normalizeThreadResponse,
} from "./libs/index.js";
import type { PreviewPost, TelegramMediaGroupItem } from "./libs/index.js";

const config = loadConfig();
const bot = new Bot(config.botToken);

bot.api.config.use(autoRetry());

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  const tweetUrls = extractTweetUrls(text);

  if (tweetUrls.length === 0) {
    return;
  }

  await ctx.replyWithChatAction("typing");

  for (const tweetUrl of tweetUrls) {
    try {
      const response = await fetchTwitterThread(tweetUrl.id);
      const posts = normalizeThreadResponse(response);

      let replyToMessageId = ctx.message.message_id;

      for (const post of posts) {
        const sentMessageId = await sendPreview(ctx, post, replyToMessageId);
        replyToMessageId = sentMessageId;
      }
    } catch (error) {
      logger.error(
        { err: error, tweetId: tweetUrl.id },
        "Failed to process tweet",
      );
      await ctx.reply(`读取失败：${tweetUrl.url}`, {
        reply_parameters: { message_id: ctx.message.message_id },
      });
    }
  }
});

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
): Promise<number> {
  const preview = buildTelegramPreview(post);

  if (preview.kind === "text") {
    try {
      const message = await ctx.reply(preview.html, {
        parse_mode: "HTML",
        reply_parameters: { message_id: replyToMessageId },
      });
      return message.message_id;
    } catch {
      const message = await ctx.reply(preview.text, {
        reply_parameters: { message_id: replyToMessageId },
      });
      return message.message_id;
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
): Promise<number> {
  const media = preview.media[0]!;
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

  try {
    const message = await sendOne(ctx, media, captionHtml);
    return message.message_id;
  } catch {
    try {
      const message = await sendOne(ctx, media, captionText);
      return message.message_id;
    } catch {
      const message = await ctx.reply(`${preview.text}\n\n${tweetUrl}`, {
        reply_parameters: { message_id: replyToMessageId },
      });
      return message.message_id;
    }
  }
}

async function sendOne(
  ctx: Context,
  media: TelegramMediaGroupItem,
  other: Record<string, unknown>,
): Promise<{ message_id: number }> {
  switch (media.type) {
    case "photo":
      return await ctx.replyWithPhoto(media.media, other);
    case "video":
      return await ctx.replyWithVideo(media.media, other);
    case "document":
      return await ctx.replyWithDocument(media.media, other);
  }
}

async function sendMediaGroup(
  ctx: Context,
  preview: { html: string; text: string; media: TelegramMediaGroupItem[] },
  replyToMessageId: number,
  tweetUrl: string,
): Promise<number> {
  try {
    const messages = await ctx.replyWithMediaGroup(preview.media, {
      reply_parameters: { message_id: replyToMessageId },
    });
    return messages.at(-1)?.message_id ?? replyToMessageId;
  } catch {
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
      return messages.at(-1)?.message_id ?? replyToMessageId;
    } catch {
      const message = await ctx.reply(`${preview.text}\n\n${tweetUrl}`, {
        reply_parameters: { message_id: replyToMessageId },
      });
      return message.message_id;
    }
  }
}

bot.catch((error) => {
  logger.error(error, "Bot error");
});

await bot.start({
  onStart(botInfo) {
    logger.info({ username: botInfo.username }, "Bot started");
  },
});
