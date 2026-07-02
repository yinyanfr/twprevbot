export type BilibiliUrl =
  | {
      kind: "direct";
      url: string;
      page: number;
      bvid?: string;
      aid?: string;
    }
  | {
      kind: "short";
      url: string;
    };

const BILIBILI_DIRECT_URL_PATTERN =
  /https?:\/\/(?:www\.)?bilibili\.com\/video\/(BV[0-9A-Za-z]+|av\d+)(?:[^\s]*)?/gi;
const BILIBILI_SHORT_URL_PATTERN =
  /https?:\/\/b23\.tv\/([0-9A-Za-z]+)(?:[^\s]*)?/gi;

export function extractBilibiliUrls(text: string): BilibiliUrl[] {
  const results: Array<{ index: number; value: BilibiliUrl }> = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(BILIBILI_DIRECT_URL_PATTERN)) {
    const rawUrl = trimTrailingUrlPunctuation(match[0]);
    const parsed = parseBilibiliVideoUrl(rawUrl);
    const key =
      parsed === null ? "" : `${parsed.kind}:${parsed.url}:p${parsed.page}`;

    if (parsed === null || seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push({ index: match.index ?? 0, value: parsed });
  }

  for (const match of text.matchAll(BILIBILI_SHORT_URL_PATTERN)) {
    const rawUrl = trimTrailingUrlPunctuation(match[0]);
    const parsed = new URL(rawUrl);
    const canonicalUrl = `${parsed.origin}${parsed.pathname}`;

    if (seen.has(canonicalUrl)) {
      continue;
    }

    seen.add(canonicalUrl);
    results.push({
      index: match.index ?? 0,
      value: { kind: "short", url: canonicalUrl },
    });
  }

  return results.sort((a, b) => a.index - b.index).map((item) => item.value);
}

export function parseBilibiliVideoUrl(
  url: string,
): Extract<BilibiliUrl, { kind: "direct" }> | null {
  const parsed = new URL(url);

  if (!isBilibiliVideoHost(parsed.hostname)) {
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

  const canonicalUrl = `${parsed.origin}/video/${videoId}/`;
  const rawPage = Number(parsed.searchParams.get("p"));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  return videoId.toLowerCase().startsWith("av")
    ? {
        kind: "direct",
        url: canonicalUrl,
        page,
        aid: videoId.slice(2),
      }
    : {
        kind: "direct",
        url: canonicalUrl,
        page,
        bvid: videoId,
      };
}

function isBilibiliVideoHost(hostname: string): boolean {
  return hostname === "bilibili.com" || hostname === "www.bilibili.com";
}

function trimTrailingUrlPunctuation(url: string): string {
  return url.replace(/[).,!?:;]+$/g, "");
}
