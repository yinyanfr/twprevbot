import assert from "node:assert/strict";
import test from "node:test";
import {
  extractBilibiliUrls,
  parseBilibiliVideoUrl,
} from "../libs/bilibili-url.js";

test("extracts bilibili video and b23 urls", () => {
  assert.deepEqual(
    extractBilibiliUrls(
      "https://www.bilibili.com/video/BV1xx411c7mD?p=2 https://b23.tv/abc123",
    ),
    [
      {
        kind: "direct",
        url: "https://www.bilibili.com/video/BV1xx411c7mD/",
        page: 2,
        bvid: "BV1xx411c7mD",
      },
      {
        kind: "short",
        url: "https://b23.tv/abc123",
      },
    ],
  );
});

test("ignores trailing punctuation around bilibili urls", () => {
  assert.deepEqual(
    extractBilibiliUrls(
      "(https://www.bilibili.com/video/BV1xx411c7mD) https://b23.tv/abc123.",
    ),
    [
      {
        kind: "direct",
        url: "https://www.bilibili.com/video/BV1xx411c7mD/",
        page: 1,
        bvid: "BV1xx411c7mD",
      },
      {
        kind: "short",
        url: "https://b23.tv/abc123",
      },
    ],
  );
});

test("ignores unsupported bilibili links and keeps distinct pages", () => {
  assert.deepEqual(
    extractBilibiliUrls(
      "https://www.bilibili.com/bangumi/play/ep1 https://www.bilibili.com/video/av170001 https://www.bilibili.com/video/av170001?p=9",
    ),
    [
      {
        kind: "direct",
        url: "https://www.bilibili.com/video/av170001/",
        page: 1,
        aid: "170001",
      },
      {
        kind: "direct",
        url: "https://www.bilibili.com/video/av170001/",
        page: 9,
        aid: "170001",
      },
    ],
  );
});

test("parses direct bilibili video url with canonical path", () => {
  assert.deepEqual(
    parseBilibiliVideoUrl("https://bilibili.com/video/BV1ab411c7mD"),
    {
      kind: "direct",
      url: "https://bilibili.com/video/BV1ab411c7mD/",
      page: 1,
      bvid: "BV1ab411c7mD",
    },
  );
});
