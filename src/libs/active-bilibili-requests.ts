import type { BilibiliUrl } from "./bilibili-url.js";

type ActiveRequest = {
  duplicateNotified: boolean;
};

export type ActiveBilibiliRequestResult =
  | { kind: "accepted"; release: () => void }
  | { kind: "duplicate"; shouldNotify: boolean }
  | { kind: "full" };

export class ActiveBilibiliRequests {
  readonly #requestsByChat = new Map<number, Map<string, ActiveRequest>>();

  constructor(private readonly maxPerChat: number) {}

  acquire(chatId: number, url: BilibiliUrl): ActiveBilibiliRequestResult {
    const key = getBilibiliRequestKey(url);
    const requests =
      this.#requestsByChat.get(chatId) ?? new Map<string, ActiveRequest>();
    const existing = requests.get(key);

    if (existing !== undefined) {
      const shouldNotify = !existing.duplicateNotified;
      existing.duplicateNotified = true;
      return { kind: "duplicate", shouldNotify };
    }

    if (requests.size >= this.maxPerChat) {
      return { kind: "full" };
    }

    requests.set(key, { duplicateNotified: false });
    this.#requestsByChat.set(chatId, requests);
    let released = false;

    return {
      kind: "accepted",
      release: () => {
        if (released) {
          return;
        }

        released = true;
        requests.delete(key);
        if (requests.size === 0) {
          this.#requestsByChat.delete(chatId);
        }
      },
    };
  }
}

function getBilibiliRequestKey(url: BilibiliUrl): string {
  if (url.kind === "short") {
    return `short:${url.url}`;
  }

  const videoId = (url.bvid ?? `av${url.aid ?? ""}`).toLowerCase();
  return `direct:${videoId}:p${url.page}`;
}
