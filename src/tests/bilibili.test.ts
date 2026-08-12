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
        { cid: 1, page: 1, part: "P1" },
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

function metadata(): Record<string, unknown> {
  return {
    duration: 59.6,
    formats: [
      {
        format_id: "30280",
        vcodec: "none",
        acodec: "mp4a.40.2",
        abr: 128,
        filesize_approx: 900_000,
      },
      {
        format_id: "30064",
        vcodec: "avc1.640033",
        acodec: "none",
        width: 1280,
        height: 720,
        quality: 64,
        tbr: 1_000,
        filesize_approx: 8_000_000,
      },
      {
        format_id: "30080",
        vcodec: "avc1.640033",
        acodec: "none",
        width: 1920,
        height: 1080,
        quality: 80,
        tbr: 2_000,
        filesize_approx: 16_000_000,
      },
    ],
  };
}

async function mediaDependencies(tempDir: string): Promise<{
  dependencies: BilibiliDependencies;
  calls: Array<{ file: string; args: string[] }>;
}> {
  const calls: Array<{ file: string; args: string[] }> = [];
  const cookieFile = join(tempDir, "bilibili.cookies.txt");
  await writeFile(cookieFile, "# Netscape HTTP Cookie File\n");
  return {
    calls,
    dependencies: {
      cookieFile,
      ytDlpPath: "/usr/bin/yt-dlp",
      ffmpegPath: "/usr/bin/ffmpeg",
      createTempDir: () => Promise.resolve(tempDir),
      runCommand: async (file, args) => {
        calls.push({ file, args });
        if (args.includes("--dump-single-json")) {
          return { stdout: JSON.stringify(metadata()), stderr: "" };
        }

        if (file.endsWith("yt-dlp")) {
          const output = args[args.indexOf("--output") + 1]!;
          await writeFile(output, "merged");
          return { stdout: "", stderr: "" };
        }

        await writeFile(args.at(-1)!, "faststart");
        return { stdout: "", stderr: "" };
      },
    },
  };
}

test("fetches and prepares a Bilibili video for streaming upload", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "twprevbot-bilibili-test-"));
  const source: BilibiliUrl = {
    kind: "direct",
    url: "https://www.bilibili.com/video/BV1xx411c7mD/",
    page: 2,
    bvid: "BV1xx411c7mD",
  };
  const apiCalls: string[] = [];
  const { dependencies, calls } = await mediaDependencies(tempDir);

  try {
    const result = await fetchBilibiliPreview(
      source,
      (input) => {
        apiCalls.push(String(input));
        return Promise.resolve(viewResponse());
      },
      dependencies,
    );

    assert.deepEqual(apiCalls, [
      "https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD",
    ]);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0]?.args.slice(0, 3), [
      "--dump-single-json",
      "--no-download",
      "--no-playlist",
    ]);
    assert.ok(calls[0]?.args.includes("--cookies"));
    assert.ok(calls[1]?.args.includes("30080+30280"));
    const ffmpegLocationIndex =
      calls[1]?.args.indexOf("--ffmpeg-location") ?? -1;
    assert.deepEqual(
      calls[1]?.args.slice(ffmpegLocationIndex, ffmpegLocationIndex + 2),
      ["--ffmpeg-location", "/usr/bin/ffmpeg"],
    );
    assert.ok(calls[2]?.args.includes("-movflags"));
    assert.ok(calls[2]?.args.includes("+faststart"));
    assert.equal(calls[2]?.args.at(-1), join(tempDir, "BV1xx411c7mD-p2.mp4"));
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
          width: 1920,
          height: 1080,
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

test("omits duplicate page title when part matches the video title", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "twprevbot-bilibili-test-"));
  const { dependencies } = await mediaDependencies(tempDir);

  try {
    const result = await fetchBilibiliPreview(
      {
        kind: "direct",
        url: "https://www.bilibili.com/video/BV1xx411c7mD/",
        page: 1,
        bvid: "BV1xx411c7mD",
      },
      () =>
        Promise.resolve(
          viewResponse({
            title: "Same Title",
            pages: [{ cid: 1, page: 1, part: "Same Title" }],
          }),
        ),
      dependencies,
    );

    assert.equal(result?.text, "Same Title\n\nDesc");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("resolves b23 short url and ignores unsupported redirects", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "twprevbot-bilibili-test-"));
  const { dependencies } = await mediaDependencies(tempDir);
  const fetcher = (input: string | URL): Promise<Response> => {
    if (String(input) === "https://b23.tv/good") {
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: {
            location: "https://www.bilibili.com/video/BV1xx411c7mD?p=1",
          },
        }),
      );
    }
    if (String(input) === "https://b23.tv/bad") {
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "https://www.bilibili.com/bangumi/play/ep1" },
        }),
      );
    }
    return Promise.resolve(viewResponse());
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

    assert.ok(good);
    assert.equal(good.url, "https://www.bilibili.com/video/BV1xx411c7mD/?p=1");
    assert.equal(bad, null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("selects the highest H.264 format that fits the Telegram budget", () => {
  const source = metadata();
  const official = selectBilibiliFormats(source, 10_000_000);
  const local = selectBilibiliFormats(source, 100_000_000);

  assert.equal(official.video.format_id, "30064");
  assert.equal(local.video.format_id, "30080");
  assert.equal(local.audio.format_id, "30280");
});

test("rejects formats that cannot fit the Telegram upload budget", () => {
  assert.throws(
    () => selectBilibiliFormats(metadata(), 1_000_000),
    /within the upload limit/,
  );
});

test("uses lower bitrate AAC when it preserves a higher video quality", () => {
  const selected = selectBilibiliFormats(
    {
      duration: 60,
      formats: [
        {
          format_id: "audio-high",
          vcodec: "none",
          acodec: "mp4a.40.2",
          abr: 192,
          filesize_approx: 2_000_000,
        },
        {
          format_id: "audio-low",
          vcodec: "none",
          acodec: "mp4a.40.2",
          abr: 64,
          filesize_approx: 500_000,
        },
        {
          format_id: "video-high",
          vcodec: "avc1.640033",
          acodec: "none",
          height: 1080,
          filesize_approx: 9_000_000,
        },
        {
          format_id: "video-low",
          vcodec: "avc1.640033",
          acodec: "none",
          height: 720,
          filesize_approx: 5_000_000,
        },
      ],
    },
    10_000_000,
  );

  assert.equal(selected.video.format_id, "video-high");
  assert.equal(selected.audio.format_id, "audio-low");
});

test("returns an HTML-capable text preview when media preparation fails", async () => {
  const result = await fetchBilibiliPreview(
    {
      kind: "direct",
      url: "https://www.bilibili.com/video/BV1xx411c7mD/",
      page: 1,
      bvid: "BV1xx411c7mD",
    },
    () => Promise.resolve(viewResponse()),
    {
      runCommand: () => Promise.reject(new Error("media unavailable")),
    },
  );

  assert.deepEqual(result, {
    id: "BV1xx411c7mD-p1",
    url: "https://www.bilibili.com/video/BV1xx411c7mD/?p=1",
    authorName: "Uploader",
    text: "Title\n\n分P 1: P1\n\nDesc",
    media: [],
  });
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

test("falls back to text while another Bilibili media job is active", async () => {
  const firstTempDir = await mkdtemp(
    join(tmpdir(), "twprevbot-bilibili-test-"),
  );
  let releaseMetadata!: () => void;
  const metadataGate = new Promise<void>((resolve) => {
    releaseMetadata = resolve;
  });
  let metadataStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    metadataStarted = resolve;
  });
  const source: BilibiliUrl = {
    kind: "direct",
    url: "https://www.bilibili.com/video/BV1xx411c7mD/",
    page: 1,
    bvid: "BV1xx411c7mD",
  };
  const first = fetchBilibiliPreview(
    source,
    () => Promise.resolve(viewResponse()),
    {
      createTempDir: () => Promise.resolve(firstTempDir),
      runCommand: async (file, args) => {
        if (args.includes("--dump-single-json")) {
          metadataStarted();
          await metadataGate;
          return { stdout: JSON.stringify(metadata()), stderr: "" };
        }
        if (file.endsWith("yt-dlp")) {
          await writeFile(args[args.indexOf("--output") + 1]!, "merged");
        } else {
          await writeFile(args.at(-1)!, "faststart");
        }
        return { stdout: "", stderr: "" };
      },
    },
  );

  try {
    await started;
    const second = await fetchBilibiliPreview(
      source,
      () => Promise.resolve(viewResponse()),
      {
        runCommand: () => {
          throw new Error("second media command must not run");
        },
      },
    );

    assert.deepEqual(second?.media, []);
    releaseMetadata();
    assert.equal((await first)?.media.length, 1);
  } finally {
    releaseMetadata();
    await first;
    await rm(firstTempDir, { recursive: true, force: true });
  }
});
