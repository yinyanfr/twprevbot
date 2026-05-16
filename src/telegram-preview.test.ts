import assert from "node:assert/strict";
import test from "node:test";
import { buildTelegramPreview } from "./telegram-preview.js";

test("builds text message for post without media", () => {
  assert.deepEqual(
    buildTelegramPreview({
      id: "20",
      url: "https://x.com/a/status/20",
      authorName: "Alice",
      text: "hello",
      media: [],
    }),
    {
      kind: "text",
      html: '<a href="https://x.com/a/status/20"><b>Alice</b></a>：\n\nhello',
      text: "Alice：https://x.com/a/status/20\n\nhello",
    },
  );
});

test("builds media group and puts caption only on first item", () => {
  const result = buildTelegramPreview({
    id: "20",
    url: "https://x.com/a/status/20",
    authorName: "Alice",
    text: "hello",
    media: [
      { kind: "photo", url: "https://example.com/1.jpg", altText: "cat" },
      { kind: "video", url: "https://example.com/2.mp4" },
    ],
  });

  assert.equal(result.kind, "mediaGroup");
  assert.equal(result.media.length, 2);
  assert.equal(
    result.media[0]?.caption?.includes("<blockquote>图1: cat</blockquote>"),
    true,
  );
  assert.equal(result.media[1]?.caption, undefined);
});
