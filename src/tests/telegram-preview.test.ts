import assert from "node:assert/strict";
import test from "node:test";
import { buildTelegramPreview } from "../libs/telegram-preview.js";

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

test("adds has_spoiler to photo and video media when spoiler is set", () => {
  const result = buildTelegramPreview({
    id: "20",
    url: "https://x.com/a/status/20",
    authorName: "Alice",
    text: "sensitive",
    media: [
      {
        kind: "photo",
        url: "https://example.com/1.jpg",
        spoiler: true,
      },
      {
        kind: "video",
        url: "https://example.com/2.mp4",
        spoiler: true,
      },
    ],
  });

  assert.equal(result.kind, "mediaGroup");
  const item0 = result.media[0];
  const item1 = result.media[1];
  assert.ok(item0);
  assert.ok(item1);
  assert.equal(item0.has_spoiler, true);
  assert.equal(item1.has_spoiler, true);
});

test("does not add has_spoiler to animation/document media", () => {
  const result = buildTelegramPreview({
    id: "20",
    url: "https://x.com/a/status/20",
    authorName: "Alice",
    text: "gif",
    media: [
      {
        kind: "animation",
        url: "https://example.com/1.gif",
        spoiler: true,
      },
    ],
  });

  assert.equal(result.kind, "mediaGroup");
  const item0 = result.media[0];
  assert.ok(item0);
  assert.equal(item0.has_spoiler, undefined);
});
