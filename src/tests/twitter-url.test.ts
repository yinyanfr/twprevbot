import assert from "node:assert/strict";
import test from "node:test";
import { extractTweetUrls } from "../libs/twitter-url.js";

test("extracts tweet ids from twitter and x urls", () => {
  assert.deepEqual(
    extractTweetUrls(
      "https://twitter.com/jack/status/20 and https://x.com/user/status/1234567890123456789",
    ),
    [
      {
        id: "20",
        url: "https://twitter.com/jack/status/20",
      },
      {
        id: "1234567890123456789",
        url: "https://x.com/user/status/1234567890123456789",
      },
    ],
  );
});

test("supports mobile twitter and ignores duplicates", () => {
  assert.deepEqual(
    extractTweetUrls(
      "https://mobile.twitter.com/a/status/20 https://twitter.com/a/status/20?s=20",
    ),
    [{ id: "20", url: "https://mobile.twitter.com/a/status/20" }],
  );
});

test("ignores non-status links and invalid ids", () => {
  assert.deepEqual(
    extractTweetUrls("https://x.com/user https://x.com/user/status/abc"),
    [],
  );
});
