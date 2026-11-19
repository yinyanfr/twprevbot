import { GrammyError, InputFile } from "grammy";
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
const ALBUM_DOWNLOAD_LIMIT = 50_000_000;
const PHOTO_UPLOAD_LIMIT = 10_000_000;
const MEDIA_DOWNLOAD_TIMEOUT_MS = 30_000;

type AlbumInput =
  InputMediaDocument[] | Array<InputMediaPhoto | InputMediaVideo>;

export function buildTelegramAlbumInput(
  media: readonly TelegramMediaGroupItem[],
  plainCaption?: string,
  uploads?: readonly InputFile[],
): AlbumInput {
  if (media.length < 2 || media.length > TELEGRAM_MEDIA_GROUP_LIMIT) {
    throw new Error("Telegram albums must contain 2–10 media");
  }
  const items = media.map((item, index) => {
    const result = { ...item, media: uploads?.[index] ?? item.media };
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

function isCaptionError(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    error.error_code === 400 &&
    /can't parse entities|caption is too long|caption_too_long/i.test(
      error.description,
    )
  );
}

function isRemoteMediaError(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    error.error_code === 400 &&
    /WEBPAGE_CURL_FAILED|WEBPAGE_MEDIA_EMPTY|failed to get HTTP URL content|wrong (?:file identifier|type of the web page content)/i.test(
      error.description,
    )
  );
}

function alternateTwitterPhotoUrls(rawUrl: string): string[] {
  const url = new URL(rawUrl);
  const match = /^\/media\/([\w-]+)\.(jpg|jpeg|png|webp)$/i.exec(url.pathname);
  if (url.origin !== "https://pbs.twimg.com" || match === null) {
    return [];
  }
  const name = url.searchParams.get("name");
  url.pathname = `/media/${match[1]}`;
  url.search = new URLSearchParams({
    format: match[2]!.toLowerCase(),
  }).toString();
  if (name !== null) {
    url.searchParams.set("name", name);
  }
  const alternate = url.href;
  if (name !== "orig") {
    return [alternate];
  }
  return [
    alternate,
    ...["large", "medium", "900x900", "small"].map((size) => {
      url.searchParams.set("name", size);
      return url.href;
    }),
  ];
}

async function downloadAlbum(
  media: readonly TelegramMediaGroupItem[],
  fetchMedia: typeof fetch,
): Promise<InputFile[]> {
  const uploads: InputFile[] = [];
  let remaining = ALBUM_DOWNLOAD_LIMIT;
  for (const item of media) {
    if (item.localFilePath !== undefined) {
      uploads.push(new InputFile(item.localFilePath));
      continue;
    }

    const signal = AbortSignal.timeout(MEDIA_DOWNLOAD_TIMEOUT_MS);
    const options = {
      signal,
      ...(item.downloadHeaders === undefined
        ? {}
        : { headers: item.downloadHeaders }),
    };
    let response = await fetchMedia(item.media, options);
    if (item.type === "photo" && response.status === 404) {
      for (const alternate of alternateTwitterPhotoUrls(item.media)) {
        await response.body?.cancel();
        response = await fetchMedia(alternate, options);
        if (response.status !== 404) {
          break;
        }
      }
    }
    const limit =
      item.type === "photo"
        ? Math.min(remaining, PHOTO_UPLOAD_LIMIT)
        : remaining;
    if (!response.ok || response.body === null) {
      await response.body?.cancel();
      throw new Error(`Album media download failed (HTTP ${response.status})`);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (
        let chunk = await reader.read();
        !chunk.done;
        chunk = await reader.read()
      ) {
        size += chunk.value.byteLength;
        if (size > limit) {
          throw new Error("Album media download exceeded the size limit");
        }
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (size === 0) {
      throw new Error("Album media download was empty");
    }
    remaining -= size;
    const filename = new URL(item.media).pathname.split("/").at(-1);
    uploads.push(
      new InputFile(Buffer.concat(chunks, size), filename || undefined),
    );
  }
  return uploads;
}

export async function sendTelegramAlbum<T>(
  preview: Pick<TelegramMediaGroupPreview, "media" | "text">,
  send: (album: AlbumInput) => Promise<T>,
  fetchMedia: typeof fetch = fetch,
): Promise<T> {
  let plainCaption: string | undefined;
  let uploads: InputFile[] | undefined;

  for (;;) {
    try {
      return await send(
        buildTelegramAlbumInput(preview.media, plainCaption, uploads),
      );
    } catch (error) {
      if (
        plainCaption === undefined &&
        preview.media.some((item) => item.parse_mode !== undefined) &&
        isCaptionError(error)
      ) {
        plainCaption = preview.text;
      } else if (uploads === undefined && isRemoteMediaError(error)) {
        uploads = await downloadAlbum(preview.media, fetchMedia);
      } else {
        throw error;
      }
    }
  }
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
