import type {
  FxTwitterMedia,
  FxTwitterPhoto,
  FxTwitterStatus,
  FxTwitterThreadResponse,
  FxTwitterTombstone,
  FxTwitterVideo,
  FxTwitterVideoFormat,
} from "./fx-twitter.js";

export type PreviewMedia =
  | {
      kind: "photo";
      url: string;
      altText?: string;
    }
  | {
      kind: "video" | "animation";
      url: string;
      altText?: string;
    };

export type PreviewPost = {
  id: string;
  url: string;
  authorName: string;
  text: string;
  media: PreviewMedia[];
};

export function normalizeThreadResponse(
  response: FxTwitterThreadResponse,
): PreviewPost[] {
  const items =
    response.thread !== null && response.thread.length > 0
      ? response.thread
      : response.status === null
        ? []
        : [response.status];

  if (items.length === 0) {
    return [
      {
        id: "unavailable",
        url: "",
        authorName: "Twitter",
        text: "无法读取这条推文。",
        media: [],
      },
    ];
  }

  return items.map(normalizeItem);
}

function normalizeItem(
  item: FxTwitterStatus | FxTwitterTombstone,
): PreviewPost {
  if (item.type === "tombstone") {
    return {
      id: item.id ?? "unavailable",
      url: item.url ?? "",
      authorName: "Twitter",
      text: item.message,
      media: [],
    };
  }

  return {
    id: item.id,
    url: item.url,
    authorName: item.author.name,
    text: item.text,
    media: normalizeMedia(item.media),
  };
}

function normalizeMedia(media: FxTwitterMedia): PreviewMedia[] {
  const all = media.all ?? [...(media.photos ?? []), ...(media.videos ?? [])];

  return all.map((item) => {
    if (isVideo(item)) {
      return {
        kind: item.type === "gif" ? ("animation" as const) : ("video" as const),
        url: selectVideoUrl(item),
      };
    }

    return normalizePhoto(item);
  });
}

function normalizePhoto(photo: FxTwitterPhoto): PreviewMedia {
  return {
    kind: "photo",
    url: photo.url,
    ...(photo.altText !== undefined ? { altText: photo.altText } : {}),
  };
}

function isVideo(
  item: FxTwitterPhoto | FxTwitterVideo,
): item is FxTwitterVideo {
  return "formats" in item;
}

function selectVideoUrl(video: FxTwitterVideo): string {
  const mp4Formats = video.formats
    .filter((format) => format.container === "mp4")
    .sort(compareVideoFormats);

  return mp4Formats[0]?.url ?? video.url;
}

function compareVideoFormats(
  a: FxTwitterVideoFormat,
  b: FxTwitterVideoFormat,
): number {
  return (b.bitrate ?? 0) - (a.bitrate ?? 0);
}
