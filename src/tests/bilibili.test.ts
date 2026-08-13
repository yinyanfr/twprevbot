import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { BilibiliUrl } from "../libs/bilibili-url.js";
import {
  cleanupStaleBilibiliTempDirs,
  fetchBilibiliPreview,
  selectBilibiliFormats,
  type BilibiliDependencies,
  type BilibiliPlayInfo,
} from "../services/bilibili.js";

function viewResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    code: 0,
    message: "OK",
    data: {
      bvid: "BV1xx411c7mD",
      title: "Title",
      desc: "Desc",
      pic: "https://i0.hdslb.com/cover.jpg",
      owner: { name: "Uploader" },
      pages: [
        { cid: 1, page: 1, part: "P1", duration: 60 },
        {
          cid: 2,
          page: 2,
          part: "P2",
          duration: 60,
          dimension: { width: 1920, height: 1080 },
        },
      ],
      ...overrides,
    },
  });
}

function playInfo(duration = 60): BilibiliPlayInfo {
  return {
    timelength: duration * 1000,
    dash: {
      duration,
      audio: [
        {
          id: 30280,
          baseUrl: "https://cdn.example/audio.m4s",
          backupUrl: ["https://backup.example/audio.m4s"],
          mimeType: "audio/mp4",
          codecs: "mp4a.40.2",
          bandwidth: 128_000,
        },
      ],
      video: [
        {
          id: 64,
          baseUrl: "https://cdn.example/720.m4s",
          backupUrl: ["https://backup.example/720.m4s"],
          mimeType: "video/mp4",
          codecs: "avc1.640033",
          width: 1280,
          height: 720,
          bandwidth: 1_000_000,
        },
        {
          id: 80,
          baseUrl: "https://cdn.example/1080.m4s",
          mimeType: "video/mp4",
          codecs: "avc1.640033",
          width: 1920,
          height: 1080,
          bandwidth: 2_000_000,
        },
      ],
    },
  };
}

function playResponse(info = playInfo()): Response {
  return Response.json({ code: 0, message: "OK", data: info });
}

async function mediaDependencies(tempDir: string): Promise<{
  dependencies: BilibiliDependencies;
  downloads: Array<{
    urls: readonly string[];
    destination: string;
    headers: Record<string, string>;
    maxBytes: number;
  }>;
  commands: Array<{ file: string; args: string[] }>;
}> {
  const downloads: Array<{
    urls: readonly string[];
    destination: string;
    headers: Record<string, string>;
    maxBytes: number;
  }> = [];
  const commands: Array<{ file: string; args: string[] }> = [];
  const cookieFile = join(tempDir, "bilibili.cookies.txt");
  await writeFile(
    cookieFile,
    "# Netscape HTTP Cookie File\n.bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\tsecret\n",
  );
  return {
    downloads,
    commands,
    dependencies: {
      cookieFile,
      ffmpegPath: "/usr/bin/ffmpeg",
      createTempDir: () => Promise.resolve(tempDir),
      downloadStream: async (urls, destination, headers, maxBytes) => {
        downloads.push({ urls, destination, headers, maxBytes });
        await writeFile(destination, "stream");
        return 6;
      },
      runCommand: async (file, args) => {
        commands.push({ file, args });
        await writeFile(args.at(-1)!, "faststart");
        return { stdout: "", stderr: "" };
      },
    },
  };
}

const directSource: BilibiliUrl = {
  kind: "direct",
  url: "https://www.bilibili.com/video/BV1xx411c7mD/",
  page: 2,
  bvid: "BV1xx411c7mD",
};

test("fetches native DASH streams and prepares a Bilibili video", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "twprevbot-bilibili-test-"));
  const apiCalls: Array<{ url: string; headers?: HeadersInit }> = [];
  const { dependencies, downloads, commands } =
    await mediaDependencies(tempDir);

  try {
    const result = await fetchBilibiliPreview(
      directSource,
      (input, init) => {
        const url = String(input);
        apiCalls.push({
          url,
          ...(init?.headers !== undefined ? { headers: init.headers } : {}),
        });
        return Promise.resolve(
          url.includes("/x/player/playurl") ? playResponse() : viewResponse(),
        );
      },
      dependencies,
    );

    assert.equal(apiCalls.length, 2);
    assert.equal(
      apiCalls[0]?.url,
      "https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD",
    );
    const playUrl = new URL(apiCalls[1]!.url);
    assert.equal(playUrl.pathname, "/x/player/playurl");
    assert.equal(playUrl.searchParams.get("bvid"), "BV1xx411c7mD");
    assert.equal(playUrl.searchParams.get("cid"), "2");
    assert.equal(playUrl.searchParams.get("qn"), "64");
    assert.equal(playUrl.searchParams.get("fnval"), "16");
    assert.equal(
      (apiCalls[0]?.headers as Record<string, string>).Cookie,
      "SESSDATA=secret",
    );
    assert.deepEqual(downloads[0]?.urls, [
      "https://cdn.example/audio.m4s",
      "https://backup.example/audio.m4s",
    ]);
    assert.deepEqual(downloads[1]?.urls, [
      "https://cdn.example/720.m4s",
      "https://backup.example/720.m4s",
    ]);
    assert.equal(
      downloads[0]?.headers.Referer,
      "https://www.bilibili.com/video/BV1xx411c7mD/?p=2",
    );
    assert.equal(downloads[0]?.headers.Origin, "https://www.bilibili.com");
    assert.equal(downloads[0]?.headers.Cookie, undefined);
    assert.equal(commands.length, 1);
    assert.equal(commands[0]?.file, "/usr/bin/ffmpeg");
    assert.ok(commands[0]?.args.includes("+faststart"));
    assert.deepEqual(result, {
      id: "BV1xx411c7mD-p2",
      url: "https://www.bilibili.com/video/BV1xx411c7mD/?p=2",
      authorName: "Uploader",
      text: "Title\n\n分P 2: P2\n\nDesc",
      media: [
        {
          kind: "video",
          url: "https://www.bilibili.com/video/BV1xx411c7mD/?p=2",
          thumbnailUrl: "https://i0.hdslb.com/cover.jpg",
          width: 1280,
          height: 720,
          duration: 60,
          supportsStreaming: true,
          localFilePath: join(tempDir, "BV1xx411c7mD-p2.mp4"),
          forceUpload: true,
          allowDocumentFallback: false,
          preserveHtmlCaption: true,
        },
      ],
      cleanupPaths: [tempDir],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("streams media from a backup URL when the primary URL fails", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "twprevbot-bilibili-test-"));
  const calls: string[] = [];
  const { dependencies } = await mediaDependencies(tempDir);
  delete dependencies.downloadStream;
  dependencies.runCommand = async (_file, args) => {
    await writeFile(args.at(-1)!, "faststart");
    return { stdout: "", stderr: "" };
  };

  try {
    const result = await fetchBilibiliPreview(
      directSource,
      (input) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("/x/web-interface/view")) {
          return Promise.resolve(viewResponse());
        }
        if (url.includes("/x/player/playurl")) {
          return Promise.resolve(playResponse());
        }
        if (url.startsWith("https://cdn.example/")) {
          return Promise.resolve(new Response(null, { status: 503 }));
        }
        return Promise.resolve(new Response("stream"));
      },
      dependencies,
    );

    assert.equal(result?.media[0]?.kind, "video");
    assert.ok(calls.includes("https://backup.example/audio.m4s"));
    assert.ok(calls.includes("https://backup.example/720.m4s"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("omits duplicate page title when part matches the video title", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "twprevbot-bilibili-test-"));
  const { dependencies } = await mediaDependencies(tempDir);
  try {
    const result = await fetchBilibiliPreview(
      { ...directSource, page: 1 },
      (input) =>
        Promise.resolve(
          String(input).includes("playurl")
            ? playResponse()
            : viewResponse({
                title: "Same Title",
                pages: [{ cid: 1, page: 1, part: "Same Title", duration: 60 }],
              }),
        ),
      dependencies,
    );
    assert.equal(result?.text, "Same Title\n\nDesc");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("resolves b23 short URLs and ignores unsupported redirects", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "twprevbot-bilibili-test-"));
  const { dependencies } = await mediaDependencies(tempDir);
  const fetcher = (input: string | URL): Promise<Response> => {
    const url = String(input);
    if (url === "https://b23.tv/good") {
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: {
            location: "https://www.bilibili.com/video/BV1xx411c7mD?p=1",
          },
        }),
      );
    }
    if (url === "https://b23.tv/bad") {
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "https://www.bilibili.com/bangumi/play/ep1" },
        }),
      );
    }
    return Promise.resolve(
      url.includes("playurl") ? playResponse() : viewResponse(),
    );
  };
  try {
    const good = await fetchBilibiliPreview(
      { kind: "short", url: "https://b23.tv/good" },
      fetcher,
      dependencies,
    );
    const bad = await fetchBilibiliPreview(
      { kind: "short", url: "https://b23.tv/bad" },
      fetcher,
      dependencies,
    );
    assert.equal(good?.url, "https://www.bilibili.com/video/BV1xx411c7mD/?p=1");
    assert.equal(bad, null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("selects the highest H.264 and AAC streams within policy", () => {
  const selected = selectBilibiliFormats(playInfo(), 60, 10_000_000);
  assert.equal(selected.video.id, 64);
  assert.equal(selected.audio.id, 30280);
});

test("supports snake_case DASH response fields", () => {
  const selected = selectBilibiliFormats(
    {
      dash: {
        audio: [
          {
            base_url: "https://cdn.example/audio",
            mime_type: "audio/mp4",
            codecs: "mp4a.40.2",
            bandwidth: 64_000,
          },
        ],
        video: [
          {
            base_url: "https://cdn.example/video",
            mime_type: "video/mp4",
            codecs: "avc1.4d401f",
            height: 480,
            bandwidth: 500_000,
          },
        ],
      },
    },
    60,
    10_000_000,
  );
  assert.equal(selected.video.height, 480);
});

test("limits videos at least 20 minutes long to 480p", () => {
  const source = playInfo(20 * 60);
  source.dash!.video!.push({
    id: 32,
    baseUrl: "https://cdn.example/480.m4s",
    mimeType: "video/mp4",
    codecs: "avc1.4d401f",
    width: 854,
    height: 480,
    bandwidth: 500_000,
  });
  const selected = selectBilibiliFormats(source, 20 * 60, 100_000_000);
  assert.equal(selected.video.id, 32);
});

test("ignores HEVC and formats with unknown height", () => {
  const source = playInfo();
  source.dash!.video!.push(
    {
      id: 65,
      baseUrl: "https://cdn.example/hevc.m4s",
      mimeType: "video/mp4",
      codecs: "hev1.1.6.L120.90",
      height: 720,
      bandwidth: 2_000_000,
    },
    {
      id: 66,
      baseUrl: "https://cdn.example/unknown.m4s",
      mimeType: "video/mp4",
      codecs: "avc1.640033",
      bandwidth: 2_000_000,
    },
  );
  assert.equal(selectBilibiliFormats(source, 60, 100_000_000).video.id, 64);
});

test("uses lower bitrate AAC when it preserves higher video quality", () => {
  const source = playInfo();
  source.dash!.audio = [
    {
      id: 1,
      baseUrl: "https://cdn.example/high-audio",
      mimeType: "audio/mp4",
      codecs: "mp4a.40.2",
      bandwidth: 200_000,
    },
    {
      id: 2,
      baseUrl: "https://cdn.example/low-audio",
      mimeType: "audio/mp4",
      codecs: "mp4a.40.2",
      bandwidth: 50_000,
    },
  ];
  source.dash!.video = [
    {
      id: 64,
      baseUrl: "https://cdn.example/720",
      mimeType: "video/mp4",
      codecs: "avc1.640033",
      height: 720,
      bandwidth: 1_000_000,
    },
    {
      id: 32,
      baseUrl: "https://cdn.example/480",
      mimeType: "video/mp4",
      codecs: "avc1.4d401f",
      height: 480,
      bandwidth: 500_000,
    },
  ];
  const selected = selectBilibiliFormats(source, 60, 8_000_000);
  assert.equal(selected.video.id, 64);
  assert.equal(selected.audio.id, 2);
});

test("rejects streams that cannot fit the upload budget", () => {
  assert.throws(
    () => selectBilibiliFormats(playInfo(), 60, 1_000_000),
    /within the upload limit/,
  );
});

test("returns text preview and removes partial media after download failure", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "twprevbot-bilibili-test-"));
  const { dependencies } = await mediaDependencies(tempDir);
  dependencies.downloadStream = () =>
    Promise.reject(new Error("media unavailable"));
  const result = await fetchBilibiliPreview(
    { ...directSource, page: 1 },
    (input) =>
      Promise.resolve(
        String(input).includes("playurl") ? playResponse() : viewResponse(),
      ),
    dependencies,
  );
  assert.deepEqual(result, {
    id: "BV1xx411c7mD-p1",
    url: "https://www.bilibili.com/video/BV1xx411c7mD/?p=1",
    authorName: "Uploader",
    text: "Title\n\n分P 1: P1\n\nDesc",
    media: [],
  });
  await assert.rejects(access(tempDir));
});

test("cleans only stale Bilibili temp directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "twprevbot-cleanup-test-"));
  const stale = join(root, "twprevbot-bilibili-stale");
  const unrelated = join(root, "unrelated");
  await mkdir(stale);
  await mkdir(unrelated);
  try {
    await cleanupStaleBilibiliTempDirs(root);
    await assert.rejects(access(stale));
    await access(unrelated);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
