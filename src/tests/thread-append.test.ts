import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAppendedMessage,
  TELEGRAM_CAPTION_LENGTH_LIMIT,
  TELEGRAM_TEXT_LENGTH_LIMIT,
} from "../libs/thread-append.js";

test("appends thread text for plain messages within text limit", () => {
  const result = buildAppendedMessage(
    {
      kind: "text",
      html: "<b>first</b>",
      text: "first",
    },
    {
      html: "<b>second</b>",
      text: "second",
    },
  );

  assert.equal(result.html, "<b>first</b>\n\n<b>second</b>");
  assert.equal(result.text, "first\n\nsecond");
  assert.equal(result.canUseHtml, true);
  assert.equal(result.canUseText, true);
});

test("uses caption limit for media captions", () => {
  const result = buildAppendedMessage(
    {
      kind: "caption",
      html: "a".repeat(TELEGRAM_CAPTION_LENGTH_LIMIT - 2),
      text: "a".repeat(TELEGRAM_CAPTION_LENGTH_LIMIT - 2),
    },
    {
      html: "b",
      text: "b",
    },
  );

  assert.equal(result.canUseHtml, false);
  assert.equal(result.canUseText, false);
});

test("allows longer appended text up to message text limit", () => {
  const result = buildAppendedMessage(
    {
      kind: "text",
      html: "a".repeat(TELEGRAM_TEXT_LENGTH_LIMIT - 3),
      text: "a".repeat(TELEGRAM_TEXT_LENGTH_LIMIT - 3),
    },
    {
      html: "b",
      text: "b",
    },
  );

  assert.equal(result.canUseHtml, true);
  assert.equal(result.canUseText, true);
});
