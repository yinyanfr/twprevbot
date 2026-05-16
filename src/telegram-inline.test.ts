import assert from "node:assert/strict";
import test from "node:test";
import { buildInlineResult } from "./telegram-inline.js";
import type { PreviewPost } from "./preview.js";

type InlineResult = {
  type: string;
  id: string;
  title?: string;
  description?: string;
  photo_url?: string;
  video_url?: string;
  mime_type?: string;
  thumbnail_url?: string;
  caption?: string;
  parse_mode?: string;
  input_message_content?: {
    message_text: string;
    parse_mode?: string;
  };
};

function asResult(value: ReturnType<typeof buildInlineResult>): InlineResult {
  return value as InlineResult;
}

test("no-media single tweet returns article with html text", () => {
  const posts: PreviewPost[] = [
    {
      id: "20",
      url: "https://x.com/alice/status/20",
      authorName: "Alice",
      text: "hello world",
      media: [],
    },
  ];

  const result = asResult(buildInlineResult(posts));
  assert.equal(result.type, "article");
  assert.equal(result.title, "Alice: hello world");
  assert.equal(result.input_message_content?.parse_mode, "HTML");
  assert.ok(result.input_message_content?.message_text?.includes("hello"));
});

test("single photo returns photo inline result", () => {
  const posts: PreviewPost[] = [
    {
      id: "20",
      url: "https://x.com/alice/status/20",
      authorName: "Alice",
      text: "check this",
      media: [
        { kind: "photo", url: "https://example.com/1.jpg", altText: "cat" },
      ],
    },
  ];

  const result = asResult(buildInlineResult(posts));
  assert.equal(result.type, "photo");
  assert.equal(result.photo_url, "https://example.com/1.jpg");
  assert.ok(result.caption?.includes("cat"));
});

test("single video with thumbnail returns video inline result", () => {
  const posts: PreviewPost[] = [
    {
      id: "20",
      url: "https://x.com/alice/status/20",
      authorName: "Alice",
      text: "watch this",
      media: [
        {
          kind: "video",
          url: "https://example.com/video.mp4",
          thumbnailUrl: "https://example.com/thumb.jpg",
        },
      ],
    },
  ];

  const result = asResult(buildInlineResult(posts));
  assert.equal(result.type, "video");
  assert.equal(result.video_url, "https://example.com/video.mp4");
  assert.equal(result.thumbnail_url, "https://example.com/thumb.jpg");
  assert.equal(result.mime_type, "video/mp4");
});

test("single video without thumbnail falls back to fxtwitter article", () => {
  const posts: PreviewPost[] = [
    {
      id: "20",
      url: "https://x.com/alice/status/20",
      authorName: "Alice",
      text: "watch this",
      media: [{ kind: "video", url: "https://example.com/video.mp4" }],
    },
  ];

  const result = asResult(buildInlineResult(posts));
  assert.equal(result.type, "article");
  assert.ok(
    result.input_message_content?.message_text?.includes(
      "fxtwitter.com/alice/status/20",
    ),
  );
});

test("multiple media falls back to fxtwitter article", () => {
  const posts: PreviewPost[] = [
    {
      id: "20",
      url: "https://x.com/alice/status/20",
      authorName: "Alice",
      text: "gallery",
      media: [
        { kind: "photo", url: "https://example.com/1.jpg" },
        { kind: "photo", url: "https://example.com/2.jpg" },
      ],
    },
  ];

  const result = asResult(buildInlineResult(posts));
  assert.equal(result.type, "article");
  assert.ok(
    result.input_message_content?.message_text?.includes(
      "fxtwitter.com/alice/status/20",
    ),
  );
});

test("thread with multiple posts falls back to fxtwitter article", () => {
  const posts: PreviewPost[] = [
    {
      id: "1",
      url: "https://x.com/alice/status/1",
      authorName: "Alice",
      text: "first",
      media: [],
    },
    {
      id: "2",
      url: "https://x.com/alice/status/2",
      authorName: "Alice",
      text: "second",
      media: [],
    },
  ];

  const result = asResult(buildInlineResult(posts));
  assert.equal(result.type, "article");
  assert.ok(
    result.input_message_content?.message_text?.includes(
      "fxtwitter.com/alice/status/1",
    ),
  );
});

test("empty posts returns article with unavailable message", () => {
  const posts: PreviewPost[] = [
    {
      id: "unavailable",
      url: "",
      authorName: "Twitter",
      text: "Post deleted",
      media: [],
    },
  ];

  const result = asResult(buildInlineResult(posts));
  assert.equal(result.type, "article");
  assert.ok(
    result.input_message_content?.message_text?.includes("Post deleted"),
  );
});
