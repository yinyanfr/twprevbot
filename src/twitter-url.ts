export type TweetUrl = {
  id: string;
  url: string;
};

const TWEET_URL_PATTERN =
  /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com|mobile\.twitter\.com|fxtwitter\.com)\/[^/\s?#]+\/status(?:es)?\/(\d{2,20})(?:[^\s]*)?/gi;

export function extractTweetUrls(text: string): TweetUrl[] {
  const results: TweetUrl[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(TWEET_URL_PATTERN)) {
    const rawUrl = match[0];
    const id = match[1];

    if (id === undefined || seen.has(id)) {
      continue;
    }

    const parsed = new URL(rawUrl);
    const canonicalUrl = `${parsed.origin}${parsed.pathname}`;

    seen.add(id);
    results.push({ id, url: canonicalUrl });
  }

  return results;
}
