export type TweetTextParts = {
  authorName: string;
  tweetUrl: string;
  text: string;
  altTexts: string[];
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function formatTweetHtml(parts: TweetTextParts): string {
  const author = escapeHtml(parts.authorName);
  const url = escapeHtml(parts.tweetUrl);
  const body = escapeHtml(parts.text);
  const altBlock =
    parts.altTexts.length > 0
      ? `\n\n<blockquote>${parts.altTexts.map(escapeHtml).join("\n")}</blockquote>`
      : "";

  return `<a href="${url}"><b>${author}</b></a>：\n\n${body}${altBlock}`;
}

export function formatTweetText(parts: TweetTextParts): string {
  const altBlock =
    parts.altTexts.length > 0
      ? `\n\n${parts.altTexts.map((line) => `> ${line}`).join("\n")}`
      : "";

  return `${parts.authorName}：${parts.tweetUrl}\n\n${parts.text}${altBlock}`;
}
