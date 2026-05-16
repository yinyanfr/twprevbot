import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml, formatTweetHtml, formatTweetText } from "../libs/html.js";

test("escapes telegram html special characters", () => {
  assert.equal(escapeHtml("<a&b>"), "&lt;a&amp;b&gt;");
});

test("formats tweet html with author link and alt blockquote", () => {
  assert.equal(
    formatTweetHtml({
      authorName: "A < B",
      tweetUrl: "https://x.com/a/status/20",
      text: "hello\nworld",
      altTexts: ["图1: first alt", "图2: second alt"],
    }),
    '<a href="https://x.com/a/status/20"><b>A &lt; B</b></a>：\n\nhello\nworld\n\n<blockquote>图1: first alt\n图2: second alt</blockquote>',
  );
});

test("formats plain text fallback", () => {
  assert.equal(
    formatTweetText({
      authorName: "Author",
      tweetUrl: "https://x.com/a/status/20",
      text: "hello",
      altTexts: ["图1: alt"],
    }),
    "Author：https://x.com/a/status/20\n\nhello\n\n> 图1: alt",
  );
});
