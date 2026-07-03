export const TELEGRAM_TEXT_LENGTH_LIMIT = 4096;
export const TELEGRAM_CAPTION_LENGTH_LIMIT = 1024;

export type AppendableMessage = {
  kind: "text" | "caption";
  html: string;
  text: string;
};

export type AppendedMessage = AppendableMessage & {
  canUseHtml: boolean;
  canUseText: boolean;
};

export function buildAppendedMessage(
  previous: AppendableMessage,
  next: { html: string; text: string },
): AppendedMessage {
  const html = `${previous.html}\n\n${next.html}`;
  const text = `${previous.text}\n\n${next.text}`;
  const limit =
    previous.kind === "caption"
      ? TELEGRAM_CAPTION_LENGTH_LIMIT
      : TELEGRAM_TEXT_LENGTH_LIMIT;

  return {
    kind: previous.kind,
    html,
    text,
    canUseHtml: html.length <= limit,
    canUseText: text.length <= limit,
  };
}
