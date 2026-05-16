import assert from "node:assert/strict";
import test from "node:test";
import { normalizeThreadResponse } from "./preview.js";
import type { FxTwitterThreadResponse } from "./fx-twitter.js";

test("uses full thread when present", () => {
  const response: FxTwitterThreadResponse = {
    code: 200,
    author: null,
    status: null,
    thread: [
      {
        type: "status",
        id: "1",
        url: "https://x.com/a/status/1",
        text: "root",
        provider: "twitter",
        author: {
          type: "profile",
          id: "a",
          name: "Alice",
          screen_name: "alice",
        },
        media: {},
      },
      {
        type: "status",
        id: "2",
        url: "https://x.com/a/status/2",
        text: "next",
        provider: "twitter",
        author: {
          type: "profile",
          id: "a",
          name: "Alice",
          screen_name: "alice",
        },
        media: {},
      },
    ],
  };

  assert.deepEqual(normalizeThreadResponse(response), [
    {
      id: "1",
      url: "https://x.com/a/status/1",
      authorName: "Alice",
      text: "root",
      media: [],
    },
    {
      id: "2",
      url: "https://x.com/a/status/2",
      authorName: "Alice",
      text: "next",
      media: [],
    },
  ]);
});

test("falls back to single status when thread is missing", () => {
  const response: FxTwitterThreadResponse = {
    code: 200,
    author: null,
    thread: null,
    status: {
      type: "status",
      id: "20",
      url: "https://x.com/a/status/20",
      text: "single",
      provider: "twitter",
      author: {
        type: "profile",
        id: "a",
        name: "Alice",
        screen_name: "alice",
      },
      media: {},
    },
  };

  assert.equal(normalizeThreadResponse(response).length, 1);
});

test("normalizes alt text and selects best mp4 video format", () => {
  const response: FxTwitterThreadResponse = {
    code: 200,
    author: null,
    thread: null,
    status: {
      type: "status",
      id: "20",
      url: "https://x.com/a/status/20",
      text: "media",
      provider: "twitter",
      author: {
        type: "profile",
        id: "a",
        name: "Alice",
        screen_name: "alice",
      },
      media: {
        all: [
          {
            type: "photo",
            url: "https://example.com/1.jpg",
            width: 100,
            height: 100,
            altText: "cat",
          },
          {
            type: "video",
            url: "https://example.com/fallback.mp4",
            width: 100,
            height: 100,
            duration: 10,
            formats: [
              {
                url: "https://example.com/low.mp4",
                container: "mp4",
                bitrate: 100,
              },
              {
                url: "https://example.com/high.mp4",
                container: "mp4",
                bitrate: 200,
              },
            ],
          },
        ],
      },
    },
  };

  assert.deepEqual(normalizeThreadResponse(response)[0]?.media, [
    { kind: "photo", url: "https://example.com/1.jpg", altText: "cat" },
    { kind: "video", url: "https://example.com/high.mp4" },
  ]);
});

test("includes thumbnail_url for video media", () => {
  const response: FxTwitterThreadResponse = {
    code: 200,
    author: null,
    thread: null,
    status: {
      type: "status",
      id: "20",
      url: "https://x.com/a/status/20",
      text: "video",
      provider: "twitter",
      author: {
        type: "profile",
        id: "a",
        name: "Alice",
        screen_name: "alice",
      },
      media: {
        videos: [
          {
            type: "video",
            url: "https://example.com/v.mp4",
            width: 100,
            height: 100,
            duration: 5,
            thumbnail_url: "https://example.com/thumb.jpg",
            formats: [{ url: "https://example.com/v.mp4" }],
          },
        ],
      },
    },
  };

  assert.deepEqual(normalizeThreadResponse(response)[0]?.media, [
    {
      kind: "video",
      url: "https://example.com/v.mp4",
      thumbnailUrl: "https://example.com/thumb.jpg",
    },
  ]);
});

test("returns tombstone message for unavailable posts", () => {
  const response: FxTwitterThreadResponse = {
    code: 404,
    author: null,
    thread: null,
    status: {
      type: "tombstone",
      provider: "twitter",
      reason: "deleted",
      message: "Post deleted",
    },
  };

  assert.deepEqual(normalizeThreadResponse(response), [
    {
      id: "unavailable",
      url: "",
      authorName: "Twitter",
      text: "Post deleted",
      media: [],
    },
  ]);
});
