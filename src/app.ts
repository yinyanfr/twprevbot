import { autoRetry } from "@grammyjs/auto-retry";
import { Bot, type Context } from "grammy";
import { loadConfig } from "./config.js";
import { fetchTwitterThread } from "./fx-twitter.js";
import { normalizeThreadResponse } from "./preview.js";
import type { PreviewPost } from "./preview.js";
import { buildTelegramPreview } from "./telegram-preview.js";
import { extractTweetUrls } from "./twitter-url.js";

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
    const response = await fetchTwitterThread(tweetUrl.id);
    const posts = normalizeThreadResponse(response);

    let replyToMessageId = ctx.message.message_id;

    for (const post of posts) {
      const sentMessageId = await sendPreview(ctx, post, replyToMessageId);
      replyToMessageId = sentMessageId;
    }
  }
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

  try {
    const messages = await ctx.replyWithMediaGroup(preview.media, {
      reply_parameters: { message_id: replyToMessageId },
    });

    return messages.at(-1)?.message_id ?? replyToMessageId;
  } catch {
    const message = await ctx.reply(`${preview.text}\n\n${post.url}`, {
      reply_parameters: { message_id: replyToMessageId },
    });
    return message.message_id;
  }
}

bot.catch((error) => {
  console.error("Bot error:", error);
});

await bot.start({
  onStart(botInfo) {
    console.log(`@${botInfo.username} is running`);
  },
});
