import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTelegramAlbumInput,
  sendTelegramMediaBatches,
  splitTelegramMediaBatches,
} from "../libs/telegram-media-batches.js";
import {
  buildTelegramPreview,
  type TelegramMediaGroupPreview,
} from "../libs/telegram-preview.js";

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
