export type YouTubeUrl = {
  videoId: string;
  url: string;
};

const YOUTUBE_URL_PATTERN =
  /https?:\/\/(?:www\.)?(?:youtube\.com\/[^\s]+|youtu\.be\/[^\s]+)/gi;

export function extractYouTubeUrls(text: string): YouTubeUrl[] {
  const results: Array<{ index: number; value: YouTubeUrl }> = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(YOUTUBE_URL_PATTERN)) {
    const rawUrl = trimTrailingUrlPunctuation(match[0]);
    const parsed = parseYouTubeVideoUrl(rawUrl);

    if (parsed === null || seen.has(parsed.videoId)) {
      continue;
    }

    seen.add(parsed.videoId);
    results.push({ index: match.index ?? 0, value: parsed });
  }

  return results.sort((a, b) => a.index - b.index).map((item) => item.value);
}

export function parseYouTubeVideoUrl(url: string): YouTubeUrl | null {
  const parsed = new URL(url);
  const videoId = getYouTubeVideoId(parsed);

  if (videoId === null) {
    return null;
  }

  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function getYouTubeVideoId(parsed: URL): string | null {
  if (parsed.hostname === "youtu.be") {
    return normalizeVideoId(parsed.pathname.slice(1));
  }

  if (
    parsed.hostname !== "youtube.com" &&
    parsed.hostname !== "www.youtube.com" &&
    parsed.hostname !== "m.youtube.com"
  ) {
    return null;
  }

  if (parsed.pathname === "/watch") {
    return normalizeVideoId(parsed.searchParams.get("v"));
  }

  const shortsMatch = parsed.pathname.match(/^\/shorts\/([^/?#]+)/);

  if (shortsMatch !== null) {
    return normalizeVideoId(shortsMatch[1]);
  }

  return null;
}

function normalizeVideoId(value: string | null | undefined): string | null {
  if (
    value === undefined ||
    value === null ||
    !/^[0-9A-Za-z_-]{11}$/.test(value)
  ) {
    return null;
  }

  return value;
}

function trimTrailingUrlPunctuation(url: string): string {
  return url.replace(/[).,!?:;]+$/g, "");
}
