import assert from "node:assert/strict";
import test from "node:test";
import { GrammyError, InputFile } from "grammy";
import {
  buildTelegramAlbumInput,
  sendTelegramAlbum,
  sendTelegramMediaBatches,
  splitTelegramMediaBatches,
} from "../libs/telegram-media-batches.js";
import {
  buildTelegramPreview,
  type TelegramMediaGroupPreview,
} from "../libs/telegram-preview.js";

function albumError(description: string): GrammyError {
  return new GrammyError(
    "Album rejected",
    { ok: false, error_code: 400, description },
    "sendMediaGroup",
    {},
  );
}

test("uploads a rejected album in order and retries a 404 Twitter photo at the same size", async () => {
  const source = preview(2);
  const original = "https://pbs.twimg.com/media/photo.jpg?name=orig";
  source.media[0]!.media = original;
  const requests: string[] = [];
  let sends = 0;
  const result = await sendTelegramAlbum(
    source,
    (items) => {
      if (++sends === 1) {
        assert.deepEqual(
          items.map((item) => item.media),
          [original, "https://example.com/1"],
        );
        throw albumError(
          'failed to send message #2 with the error message "WEBPAGE_CURL_FAILED"',
        );
      }
      assert.ok(items.every((item) => item.media instanceof InputFile));
      assert.deepEqual(
        items.map((item) => item.type),
        ["photo", "video"],
      );
      assert.equal(items[0]?.caption, source.html);
      assert.equal(items[0]?.parse_mode, "HTML");
      assert.equal(items[1]?.caption, undefined);
      assert.ok(
        items.every((item) => "has_spoiler" in item && item.has_spoiler),
      );
      return Promise.resolve(123);
    },
    (url) => {
      assert.ok(typeof url === "string");
      requests.push(url);
      return Promise.resolve(
        url === original
          ? new Response(null, { status: 404 })
          : new Response("media"),
      );
    },
  );
  assert.equal(result, 123);
  assert.equal(sends, 2);
  assert.deepEqual(requests, [
    original,
    "https://pbs.twimg.com/media/photo?format=jpg&name=orig",
    "https://example.com/1",
  ]);
});

test("reuses uploaded files if Telegram rejects the HTML caption", async () => {
  let sends = 0;
  let downloads = 0;
  let uploaded: string | InputFile | undefined;
  const source = preview(2);
  await sendTelegramAlbum(
    source,
    (items) => {
      switch (++sends) {
        case 1:
          throw albumError("failed to get HTTP URL content");
        case 2:
          uploaded = items[0]?.media;
          throw albumError("can't parse entities");
        default:
          assert.ok(uploaded instanceof InputFile);
          assert.equal(items[0]?.media, uploaded);
          assert.equal(items[0]?.caption, source.text);
          assert.equal(items[0]?.parse_mode, undefined);
          return Promise.resolve();
      }
    },
    () => {
      downloads++;
      return Promise.resolve(new Response("media"));
    },
  );
  assert.equal(sends, 3);
  assert.equal(downloads, 2);
});

test("tries the large photo variant if the original is unavailable in both URL forms", async () => {
  const source = preview(2);
  source.media[0]!.media = "https://pbs.twimg.com/media/photo.jpg?name=orig";
  const requests: string[] = [];
  let sends = 0;
  await sendTelegramAlbum(
    source,
    () => {
      if (++sends === 1) {
        throw albumError("WEBPAGE_CURL_FAILED");
      }
      return Promise.resolve();
    },
    (url) => {
      assert.ok(typeof url === "string");
      requests.push(url);
      return Promise.resolve(
        url.includes("name=orig")
          ? new Response(null, { status: 404 })
          : new Response("media"),
      );
    },
  );
  assert.deepEqual(requests, [
    "https://pbs.twimg.com/media/photo.jpg?name=orig",
    "https://pbs.twimg.com/media/photo?format=jpg&name=orig",
    "https://pbs.twimg.com/media/photo?format=jpg&name=large",
    "https://example.com/1",
  ]);
});

test("does not retry ambiguous send failures", async () => {
  const error = new Error("connection lost");
  let sends = 0;
  await assert.rejects(
    sendTelegramAlbum(preview(2), () => {
      sends++;
      throw error;
    }),
    error,
  );
  assert.equal(sends, 1);
});

test("rejects an oversized photo during album download without attempting upload", async () => {
  let sends = 0;
  await assert.rejects(
    sendTelegramAlbum(
      preview(2),
      () => {
        sends++;
        throw albumError("WEBPAGE_CURL_FAILED");
      },
      () => Promise.resolve(new Response(new Uint8Array(10_000_001))),
    ),
    /exceeded the size limit/,
  );
  assert.equal(sends, 1);
});

function preview(count: number): TelegramMediaGroupPreview {
  const result = buildTelegramPreview({
    id: "20",
    url: "https://x.com/a/status/20",
    authorName: "Alice",
    text: "hello",
    media: Array.from({ length: count }, (_, index) => ({
      kind: index % 2 === 0 ? "photo" : "video",
      url: `https://example.com/${index}`,
      spoiler: true,
      ...(index === 0 ? { altText: "cat" } : {}),
    })),
  });
  assert.equal(result.kind, "mediaGroup");
  return result;
}

for (const [count, sizes] of [
  [1, [1]],
  [2, [2]],
  [10, [10]],
  [11, [10, 1]],
  [19, [10, 9]],
  [20, [10, 10]],
] as const) {
  test(`splits ${count} media into ${sizes.join("+")} without reordering`, () => {
    const source = preview(count);
    const batches = splitTelegramMediaBatches(source.media);
    assert.deepEqual(
      batches.map((batch) => batch.length),
      [...sizes],
    );
    assert.deepEqual(batches.flat(), source.media);
    assert.ok(batches.flat().every((item) => item.has_spoiler));
    assert.equal(
      batches.flat().filter((item) => item.caption !== undefined).length,
      1,
    );
    assert.match(batches[0]![0]!.caption!, /图1: cat/);
  });
}

test("keeps documents separate from photo/video albums", () => {
  const source = preview(5);
  source.media[1] = { type: "document", media: "https://example.com/gif1" };
  source.media[2] = { type: "document", media: "https://example.com/gif2" };
  const batches = splitTelegramMediaBatches(source.media);
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [1, 2, 2],
  );
  assert.deepEqual(batches.flat(), source.media);
});

test("sends albums sequentially, captions once, and retains the first append target", async () => {
  const source = preview(20);
  const calls: Array<{ batch: TelegramMediaGroupPreview; replyTo: number }> =
    [];
  let active = false;
  const result = await sendTelegramMediaBatches(
    source,
    100,
    async (batch, replyTo) => {
      assert.equal(active, false);
      active = true;
      calls.push({ batch, replyTo });
      await Promise.resolve();
      active = false;
      return {
        replyMessageId: calls.length === 1 ? 110 : 120,
        appendTarget: { messageId: calls.length === 1 ? 101 : 111 },
      };
    },
  );

  assert.deepEqual(
    calls.map((call) => call.replyTo),
    [100, 110],
  );
  assert.equal(calls[0]?.batch.html, source.html);
  assert.equal(calls[0]?.batch.text, source.text);
  assert.equal(calls[1]?.batch.html, "");
  assert.equal(calls[1]?.batch.text, "");
  assert.ok(calls[1]?.batch.media.every((item) => item.caption === undefined));
  assert.deepEqual(result, {
    replyMessageId: 120,
    appendTarget: { messageId: 101 },
  });
});

test("passes the trailing singleton to the single-media sender", async () => {
  const calls: number[] = [];
  await sendTelegramMediaBatches(preview(11), 100, (batch) => {
    calls.push(batch.media.length);
    return Promise.resolve({ replyMessageId: 100 + calls.length });
  });
  assert.deepEqual(calls, [10, 1]);
});

test("does not resend a successful album if a later album fails", async () => {
  const calls: number[] = [];
  await assert.rejects(
    sendTelegramMediaBatches(preview(20), 100, (batch) => {
      calls.push(batch.media.length);
      if (calls.length === 2) {
        return Promise.reject(new Error("later album failed"));
      }
      return Promise.resolve({ replyMessageId: 110 });
    }),
    /later album failed/,
  );
  assert.deepEqual(calls, [10, 10]);
});

test("rejects empty media instead of reporting a successful send", async () => {
  assert.deepEqual(splitTelegramMediaBatches([]), []);
  await assert.rejects(
    sendTelegramMediaBatches(
      { kind: "mediaGroup", html: "", text: "", media: [] },
      100,
      () => {
        throw new Error("must not send");
      },
    ),
    /empty media/,
  );
});

test("plain album retry preserves spoilers, order and caption placement", () => {
  const source = preview(20);
  const [first, second] = splitTelegramMediaBatches(source.media);
  const plain = buildTelegramAlbumInput(first!, source.text);
  assert.equal(plain[0]?.caption, source.text);
  assert.equal(plain[0]?.parse_mode, undefined);
  assert.equal(plain[1]?.caption, undefined);
  assert.ok(plain.every((item) => "has_spoiler" in item && item.has_spoiler));
  assert.deepEqual(
    plain.map((item) => item.media),
    first!.map((item) => item.media),
  );
  assert.ok(
    buildTelegramAlbumInput(second!, "").every(
      (item) => item.caption === undefined,
    ),
  );
});

test("validates Telegram album sizes and document compatibility", () => {
  assert.throws(() => buildTelegramAlbumInput(preview(1).media), /2–10/);
  assert.throws(() => buildTelegramAlbumInput(preview(11).media), /2–10/);
  assert.throws(
    () =>
      buildTelegramAlbumInput([
        { type: "photo", media: "photo" },
        { type: "document", media: "gif" },
      ]),
    /cannot share/,
  );
  assert.deepEqual(
    buildTelegramAlbumInput([
      { type: "document", media: "gif1" },
      { type: "document", media: "gif2" },
    ]).map((item) => item.type),
    ["document", "document"],
  );
});
