import { formatTweetHtml } from "./html.js";
import type { PreviewPost } from "./preview.js";

export function buildInlineResult(
  posts: PreviewPost[],
): Record<string, unknown> | null {
  if (posts.length === 0) {
    return null;
  }

  if (posts.length > 1 || posts[0]!.media.length > 1) {
    return buildFxTwitterArticle(posts[0]!);
  }

  const post = posts[0]!;

  if (post.media.length === 0) {
    return buildTextArticle(post);
  }

  const media = post.media[0]!;

  if (media.spoiler === true) {
    return buildFxTwitterArticle(post);
  }

  if (media.kind === "photo") {
    return buildPhotoResult(post, media.url);
  }

  if (media.thumbnailUrl !== undefined) {
    return buildVideoResult(post, media.url, media.thumbnailUrl);
  }

  return buildFxTwitterArticle(post);
}

function buildTextArticle(post: PreviewPost): Record<string, unknown> {
  const html = formatTweetHtml({
    authorName: post.authorName,
    tweetUrl: post.url,
    text: post.text,
    altTexts: [],
  });

  return {
    type: "article",
    id: post.id,
    title: truncate(`${post.authorName}: ${post.text}`),
    input_message_content: {
      message_text: html,
      parse_mode: "HTML",
    },
  };
}

function buildPhotoResult(
  post: PreviewPost,
  photoUrl: string,
): Record<string, unknown> {
  const html = formatTweetHtml({
    authorName: post.authorName,
    tweetUrl: post.url,
    text: post.text,
    altTexts: post.media.flatMap((m, i) =>
      m.altText !== undefined ? [`图${i + 1}: ${m.altText}`] : [],
    ),
  });

  const caption = truncate(html);

  return {
    type: "photo",
    id: post.id,
    photo_url: photoUrl,
    thumbnail_url: photoUrl,
    caption,
    parse_mode: "HTML",
  };
}

function buildVideoResult(
  post: PreviewPost,
  videoUrl: string,
  thumbnailUrl: string,
): Record<string, unknown> {
  const html = formatTweetHtml({
    authorName: post.authorName,
    tweetUrl: post.url,
    text: post.text,
    altTexts: post.media.flatMap((m, i) =>
      m.altText !== undefined ? [`图${i + 1}: ${m.altText}`] : [],
    ),
  });

  const caption = truncate(html);

  return {
    type: "video",
    id: post.id,
    video_url: videoUrl,
    mime_type: "video/mp4",
    thumbnail_url: thumbnailUrl,
    title: truncate(`${post.authorName}: ${post.text}`),
    caption,
    parse_mode: "HTML",
  };
}

function buildFxTwitterArticle(post: PreviewPost): Record<string, unknown> {
  const fxUrl = toFxTwitterUrl(post.url);

  return {
    type: "article",
    id: post.id,
    title: truncate(`${post.authorName}: ${post.text}`),
    description: "点击通过 FxTwitter 查看预览",
    input_message_content: {
      message_text: fxUrl,
    },
  };
}

function toFxTwitterUrl(tweetUrl: string): string {
  return tweetUrl.replace(
    /^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com|mobile\.twitter\.com)/,
    "https://fxtwitter.com",
  );
}

function truncate(value: string): string {
  const max = 1024;

  if (value.length <= max) {
    return value;
  }

  return value.slice(0, max - 1) + "…";
}
