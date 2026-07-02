import assert from "node:assert/strict";
import test from "node:test";
import type { BilibiliUrl } from "../libs/bilibili-url.js";
import { fetchBilibiliPreview } from "../services/bilibili.js";

test("fetches bilibili preview for direct video url", async () => {
  const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
  const source: BilibiliUrl = {
    kind: "direct",
    url: "https://www.bilibili.com/video/BV1xx411c7mD/",
    page: 2,
    bvid: "BV1xx411c7mD",
  };
  const fetcher = (
    input: string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ input: String(input), init });

    if (calls.length === 1) {
      return Promise.resolve(
        Response.json({
          code: 0,
          message: "OK",
          data: {
            bvid: "BV1xx411c7mD",
            title: "Title",
            desc: "Desc",
            pic: "https://i0.hdslb.com/cover.jpg",
            owner: { name: "Uploader" },
            pages: [
              { cid: 1, page: 1, part: "P1" },
              { cid: 2, page: 2, part: "P2" },
            ],
          },
        }),
      );
    }

    return Promise.resolve(
      Response.json({
        code: 0,
        message: "OK",
        data: {
          durl: [{ url: "https://upos.example.com/video.mp4" }],
        },
      }),
    );
  };

  const result = await fetchBilibiliPreview(source, fetcher);

  assert.equal(calls.length, 2);
  assert.equal(
    calls[0]?.input,
    "https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD",
  );
  assert.equal(
    calls[1]?.input,
    "https://api.bilibili.com/x/player/playurl?bvid=BV1xx411c7mD&cid=2&qn=16&fnval=0&fourk=0",
  );
  assert.equal(
    new Headers(calls[1]?.init?.headers).get("referer"),
    "https://www.bilibili.com/video/BV1xx411c7mD/?p=2",
  );
  assert.ok(result);
  assert.deepEqual(result, {
    id: "BV1xx411c7mD-p2",
    url: "https://www.bilibili.com/video/BV1xx411c7mD/?p=2",
    authorName: "Uploader",
    text: "Title\n\n分P 2: P2\n\nDesc",
    media: [
      {
        kind: "video",
        url: "https://upos.example.com/video.mp4",
        thumbnailUrl: "https://i0.hdslb.com/cover.jpg",
        downloadHeaders: {
          Referer: "https://www.bilibili.com/video/BV1xx411c7mD/?p=2",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        },
        forceUpload: true,
      },
    ],
  });
});

test("resolves b23 short url and ignores unsupported redirects", async () => {
  const fetcher = (input: string | URL): Promise<Response> => {
    if (String(input) === "https://b23.tv/good") {
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: {
            location: "https://www.bilibili.com/video/BV1xx411c7mD?p=3",
          },
        }),
      );
    }

    if (String(input) === "https://b23.tv/bad") {
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: {
            location: "https://www.bilibili.com/bangumi/play/ep1",
          },
        }),
      );
    }

    if (String(input).includes("/x/web-interface/view?bvid=BV1xx411c7mD")) {
      return Promise.resolve(
        Response.json({
          code: 0,
          message: "OK",
          data: {
            bvid: "BV1xx411c7mD",
            title: "Title",
            desc: "",
            pic: "https://i0.hdslb.com/cover.jpg",
            owner: { name: "Uploader" },
            pages: [{ cid: 3, page: 3, part: "" }],
          },
        }),
      );
    }

    return Promise.resolve(
      Response.json({
        code: 0,
        message: "OK",
        data: { durl: [{ url: "https://upos.example.com/video.mp4" }] },
      }),
    );
  };

  const good = await fetchBilibiliPreview(
    { kind: "short", url: "https://b23.tv/good" },
    fetcher,
  );
  const bad = await fetchBilibiliPreview(
    { kind: "short", url: "https://b23.tv/bad" },
    fetcher,
  );

  assert.ok(good);
  assert.equal(good?.url, "https://www.bilibili.com/video/BV1xx411c7mD/?p=3");
  assert.equal(bad, null);
});
