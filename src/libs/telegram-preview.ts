import { formatTweetHtml, formatTweetText } from "./html.js";
import type { PreviewPost } from "./preview.js";

export type TelegramTextPreview = {
  kind: "text";
  html: string;
  text: string;
};

export type TelegramMediaGroupItem =
  | {
      type: "photo";
      media: string;
      caption?: string;
      parse_mode?: "HTML";
      has_spoiler?: boolean;
    }
  | {
      type: "video" | "document";
      media: string;
      caption?: string;
      parse_mode?: "HTML";
      has_spoiler?: boolean;
    };

export type TelegramMediaGroupPreview = {
  kind: "mediaGroup";
  media: TelegramMediaGroupItem[];
  html: string;
  text: string;
};

export type TelegramPreview = TelegramTextPreview | TelegramMediaGroupPreview;

export function buildTelegramPreview(post: PreviewPost): TelegramPreview {
  const altTexts = post.media.flatMap((media, index) =>
    media.altText === undefined ? [] : [`图${index + 1}: ${media.altText}`],
  );

  const parts = {
    authorName: post.authorName,
    tweetUrl: post.url,
    text: post.text,
    altTexts,
  };

  const html = formatTweetHtml(parts);
  const text = formatTweetText(parts);

  if (post.media.length === 0) {
    return { kind: "text", html, text };
  }

  return {
    kind: "mediaGroup",
    html,
    text,
    media: post.media.map((media, index) => ({
      type: media.kind === "animation" ? "document" : media.kind,
      media: media.url,
      ...(media.kind !== "animation" && media.spoiler === true
        ? { has_spoiler: true }
        : {}),
      ...(index === 0 ? { caption: html, parse_mode: "HTML" as const } : {}),
    })),
  };
}
