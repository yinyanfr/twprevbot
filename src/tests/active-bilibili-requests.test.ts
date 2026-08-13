import assert from "node:assert/strict";
import test from "node:test";
import { ActiveBilibiliRequests } from "../libs/active-bilibili-requests.js";
import type { BilibiliUrl } from "../libs/bilibili-url.js";

const firstUrl: BilibiliUrl = {
  kind: "direct",
  url: "https://www.bilibili.com/video/BV1first/",
  page: 1,
  bvid: "BV1first",
};
const secondUrl: BilibiliUrl = {
  kind: "direct",
  url: "https://www.bilibili.com/video/BV1second/",
  page: 1,
  bvid: "BV1second",
};

test("notifies only once for an active duplicate", () => {
  const requests = new ActiveBilibiliRequests(2);
  const accepted = requests.acquire(1, firstUrl);

  assert.equal(accepted.kind, "accepted");
  assert.deepEqual(requests.acquire(1, firstUrl), {
    kind: "duplicate",
    shouldNotify: true,
  });
  assert.deepEqual(requests.acquire(1, firstUrl), {
    kind: "duplicate",
    shouldNotify: false,
  });
  assert.deepEqual(
    requests.acquire(1, {
      ...firstUrl,
      bvid: "bv1FIRST",
    }),
    { kind: "duplicate", shouldNotify: false },
  );
});

test("limits each chat to two active Bilibili links", () => {
  const requests = new ActiveBilibiliRequests(2);
  const first = requests.acquire(1, firstUrl);
  const second = requests.acquire(1, secondUrl);

  assert.equal(first.kind, "accepted");
  assert.equal(second.kind, "accepted");
  assert.deepEqual(
    requests.acquire(1, {
      kind: "short",
      url: "https://b23.tv/third",
    }),
    { kind: "full" },
  );
});

test("keeps chats independent and allows a link again after release", () => {
  const requests = new ActiveBilibiliRequests(2);
  const firstChat = requests.acquire(1, firstUrl);
  const secondChat = requests.acquire(2, firstUrl);

  assert.equal(firstChat.kind, "accepted");
  assert.equal(secondChat.kind, "accepted");
  assert.equal(firstChat.kind === "accepted", true);
  if (firstChat.kind === "accepted") {
    firstChat.release();
    firstChat.release();
  }
  assert.equal(requests.acquire(1, firstUrl).kind, "accepted");
});
