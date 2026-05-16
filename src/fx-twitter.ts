export type FxTwitterProfile = {
  type: "profile";
  id: string;
  name: string;
  screen_name: string;
};

export type FxTwitterTombstone = {
  type: "tombstone";
  provider: string;
  reason: "deleted" | "suspended" | "private" | "blocked" | "unavailable";
  message: string;
  id?: string;
  url?: string;
};

export type FxTwitterPhoto = {
  type: "photo" | "gif";
  url: string;
  width: number;
  height: number;
  altText?: string;
};

export type FxTwitterVideoFormat = {
  container?: "mp4" | "webm" | "m3u8";
  codec?: "h264" | "hevc" | "vp9" | "av1";
  bitrate?: number;
  url: string;
  height?: number;
  width?: number;
};

export type FxTwitterVideo = {
  type: "video" | "gif";
  url: string;
  width: number;
  height: number;
  thumbnail_url?: string | null;
  duration: number;
  formats: FxTwitterVideoFormat[];
};

export type FxTwitterMedia = {
  photos?: FxTwitterPhoto[];
  videos?: FxTwitterVideo[];
  all?: Array<FxTwitterPhoto | FxTwitterVideo>;
};

export type FxTwitterStatus = {
  type: "status";
  id: string;
  url: string;
  text: string;
  author: FxTwitterProfile;
  media: FxTwitterMedia;
  provider: "twitter";
};

export type FxTwitterThreadResponse = {
  code: number;
  status: FxTwitterStatus | FxTwitterTombstone | null;
  thread: Array<FxTwitterStatus | FxTwitterTombstone> | null;
  author: FxTwitterProfile | null;
};

export type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

const FX_TWITTER_BASE_URL = "https://api.fxtwitter.com";

export async function fetchTwitterThread(
  id: string,
  fetcher: Fetcher = fetch,
): Promise<FxTwitterThreadResponse> {
  const url = `${FX_TWITTER_BASE_URL}/2/thread/${id}`;

  try {
    return await fetchJson(url, fetcher);
  } catch (error) {
    if (!isNetworkError(error)) {
      throw error;
    }

    return await fetchJson(url, fetcher);
  }
}

async function fetchJson(
  url: string,
  fetcher: Fetcher,
): Promise<FxTwitterThreadResponse> {
  const response = await fetcher(url);
  return (await response.json()) as FxTwitterThreadResponse;
}

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}
