import type {
  InputMediaDocument,
  InputMediaPhoto,
  InputMediaVideo,
} from "grammy/types";
import type {
  TelegramMediaGroupItem,
  TelegramMediaGroupPreview,
} from "./telegram-preview.js";

const TELEGRAM_MEDIA_GROUP_LIMIT = 10;

export function buildTelegramAlbumInput(
  media: readonly TelegramMediaGroupItem[],
  plainCaption?: string,
): InputMediaDocument[] | Array<InputMediaPhoto | InputMediaVideo> {
  if (media.length < 2 || media.length > TELEGRAM_MEDIA_GROUP_LIMIT) {
    throw new Error("Telegram albums must contain 2–10 media");
  }
  const items = media.map((item) => {
    const result = { ...item };
    if (plainCaption !== undefined) {
      delete result.parse_mode;
      if (result.caption !== undefined) {
        result.caption = plainCaption;
      }
    }
    return result;
  });
  if (items.every((item) => item.type === "document")) {
    return items.map((item) => ({ ...item, type: "document" as const }));
  }
  if (items.some((item) => item.type === "document")) {
    throw new Error("Documents cannot share an album with photos/videos");
  }
  return items.map((item) => ({
    ...item,
    type: item.type === "photo" ? ("photo" as const) : ("video" as const),
  }));
}

// Telegram permits photos/videos together, but documents must form their own albums.
export function splitTelegramMediaBatches(
  media: readonly TelegramMediaGroupItem[],
): TelegramMediaGroupItem[][] {
  const batches: TelegramMediaGroupItem[][] = [];

  for (const item of media) {
    const current = batches.at(-1);
    if (
      current === undefined ||
      current.length === TELEGRAM_MEDIA_GROUP_LIMIT ||
      (current[0]?.type === "document") !== (item.type === "document")
    ) {
      batches.push([item]);
    } else {
      current.push(item);
    }
  }

  return batches;
}

export async function sendTelegramMediaBatches<
  T extends { replyMessageId: number },
>(
  preview: TelegramMediaGroupPreview,
  replyToMessageId: number,
  sendBatch: (
    batch: TelegramMediaGroupPreview,
    replyToMessageId: number,
  ) => Promise<T>,
): Promise<T> {
  let first: T | undefined;
  let lastMessageId = replyToMessageId;

  for (const media of splitTelegramMediaBatches(preview.media)) {
    const batch: TelegramMediaGroupPreview = {
      kind: "mediaGroup",
      html: first === undefined ? preview.html : "",
      text: first === undefined ? preview.text : "",
      media,
    };
    const sent = await sendBatch(batch, lastMessageId);
    first ??= sent;
    lastMessageId = sent.replyMessageId;
  }

  if (first === undefined) {
    throw new Error("Cannot send an empty media preview");
  }

  // Keep the first caption as the thread append target, but reply to the last batch.
  return { ...first, replyMessageId: lastMessageId };
}
