import type { PreviewPost } from "../libs/preview.js";
import type { BilibiliUrl } from "../libs/bilibili-url.js";

export type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

type BilibiliApiEnvelope<T> = {
  code: number;
  message: string;
  data?: T;
};

type BilibiliViewPage = {
  cid: number;
  page: number;
  part: string;
  dimension?: {
    width?: number;
    height?: number;
  };
};

type BilibiliViewData = {
  bvid: string;
  title: string;
  desc: string;
  pic: string;
  owner: {
    name: string;
  };
  dimension?: {
    width?: number;
    height?: number;
  };
  pages: BilibiliViewPage[];
};

type BilibiliPlayUrlData = {
  durl?: Array<{
    url: string;
  }>;
};

const API_BASE_URL = "https://api.bilibili.com";
const BILIBILI_TIMEOUT_MS = 10_000;
const BILIBILI_VIDEO_QUALITY = 16;
const BILIBILI_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

export async function fetchBilibiliPreview(
  source: BilibiliUrl,
  fetcher: Fetcher = fetch,
): Promise<PreviewPost | null> {
  const resolved = await resolveBilibiliUrl(source, fetcher);

  if (resolved === null) {
    return null;
  }

  const viewQuery =
    resolved.bvid !== undefined
      ? `bvid=${resolved.bvid}`
      : `aid=${resolved.aid}`;
  const view = await fetchJson<BilibiliViewData>(
    `${API_BASE_URL}/x/web-interface/view?${viewQuery}`,
    fetcher,
    defaultHeaders(),
  );
  const page = view.pages[resolved.page - 1] ?? view.pages[0];

  if (page === undefined) {
    return null;
  }

  const canonicalUrl = `${new URL(resolved.url).origin}/video/${view.bvid}/?p=${page.page}`;
  const play = await fetchJson<BilibiliPlayUrlData>(
    `${API_BASE_URL}/x/player/playurl?bvid=${view.bvid}&cid=${page.cid}&qn=${BILIBILI_VIDEO_QUALITY}&fnval=0&fourk=0`,
    fetcher,
    mediaHeaders(canonicalUrl),
  );
  const videoUrl = play.durl?.[0]?.url;

  if (videoUrl === undefined) {
    return null;
  }

  return {
    id: `${view.bvid}-p${page.page}`,
    url: canonicalUrl,
    authorName: view.owner.name,
    text: buildDescription(view.title, view.desc, page),
    media: [
      {
        kind: "video",
        url: videoUrl,
        thumbnailUrl: view.pic,
        ...(page.dimension?.width !== undefined
          ? { width: page.dimension.width }
          : view.dimension?.width !== undefined
            ? { width: view.dimension.width }
            : {}),
        ...(page.dimension?.height !== undefined
          ? { height: page.dimension.height }
          : view.dimension?.height !== undefined
            ? { height: view.dimension.height }
            : {}),
        downloadHeaders: mediaHeaders(canonicalUrl),
        forceUpload: true,
      },
    ],
  };
}

async function resolveBilibiliUrl(
  source: BilibiliUrl,
  fetcher: Fetcher,
): Promise<Extract<BilibiliUrl, { kind: "direct" }> | null> {
  if (source.kind === "direct") {
    return source;
  }

  const response = await fetchWithRetry(source.url, fetcher, {
    headers: defaultHeaders(),
    redirect: "manual",
  });
  const location = response.headers.get("location");

  await cancelResponseBody(response);

  if (location === null) {
    return null;
  }

  return parseRedirectUrl(new URL(location, source.url).toString());
}

function parseRedirectUrl(
  url: string,
): Extract<BilibiliUrl, { kind: "direct" }> | null {
  const parsed = new URL(url);

  if (
    parsed.hostname !== "bilibili.com" &&
    parsed.hostname !== "www.bilibili.com"
  ) {
    return null;
  }

  const match = parsed.pathname.match(/^\/video\/(BV[0-9A-Za-z]+|av\d+)\/?$/i);

  if (match === null) {
    return null;
  }

  const videoId = match[1];

  if (videoId === undefined) {
    return null;
  }

  const rawPage = Number(parsed.searchParams.get("p"));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  return videoId.toLowerCase().startsWith("av")
    ? {
        kind: "direct",
        url: `${parsed.origin}/video/${videoId}/`,
        page,
        aid: videoId.slice(2),
      }
    : {
        kind: "direct",
        url: `${parsed.origin}/video/${videoId}/`,
        page,
        bvid: videoId,
      };
}

async function fetchJson<T>(
  url: string,
  fetcher: Fetcher,
  headers: Record<string, string>,
): Promise<T> {
  const response = await fetchWithRetry(url, fetcher, { headers });

  if (!response.ok) {
    await cancelResponseBody(response);
    throw new Error(
      `Bilibili API request failed: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as BilibiliApiEnvelope<T>;

  if (payload.code !== 0 || payload.data === undefined) {
    throw new Error(
      `Bilibili API error: ${payload.code} ${payload.message || "unknown error"}`,
    );
  }

  return payload.data;
}

async function fetchWithRetry(
  url: string,
  fetcher: Fetcher,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(BILIBILI_TIMEOUT_MS),
    });
  } catch (error) {
    if (!isNetworkError(error)) {
      throw error;
    }

    return await fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(BILIBILI_TIMEOUT_MS),
    });
  }
}

function buildDescription(
  title: string,
  desc: string,
  page: BilibiliViewPage,
): string {
  const parts = [title];
  const trimmedTitle = title.trim();
  const trimmedPart = page.part.trim();

  if (trimmedPart !== "" && trimmedPart !== trimmedTitle) {
    parts.push(`分P ${page.page}: ${page.part}`);
  }

  const trimmedDesc = desc.trim();

  if (trimmedDesc !== "") {
    parts.push(trimmedDesc);
  }

  return parts.join("\n\n");
}

function defaultHeaders(): Record<string, string> {
  return {
    Referer: "https://www.bilibili.com/",
    "User-Agent": BILIBILI_USER_AGENT,
  };
}

function mediaHeaders(referer: string): Record<string, string> {
  return {
    Referer: referer,
    "User-Agent": BILIBILI_USER_AGENT,
  };
}

function isNetworkError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === "TimeoutError")
  );
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Ignore cancellation failures on already-closed bodies.
  }
}
