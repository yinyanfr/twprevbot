import assert from "node:assert/strict";
import test from "node:test";
import { getUploadedMediaFallbackTypes } from "../libs/upload-fallback.js";

test("keeps photo uploads as photo only", () => {
  assert.deepEqual(getUploadedMediaFallbackTypes("photo"), ["photo"]);
});

test("tries video uploads as document after video fails", () => {
  assert.deepEqual(getUploadedMediaFallbackTypes("video"), [
    "video",
    "document",
  ]);
});

test("keeps document uploads as document only", () => {
  assert.deepEqual(getUploadedMediaFallbackTypes("document"), ["document"]);
});
