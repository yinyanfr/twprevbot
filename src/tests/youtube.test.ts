import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { YouTubeUrl } from "../libs/youtube-url.js";
import {
  fetchYouTubePreview,
  writeFakeYouTubeFile,
} from "../services/youtube.js";

test("fetches youtube preview and downloads media to a temp file", async () => {
  const source: YouTubeUrl = {
    videoId: "dQw4w9WgXcQ",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  };
  const tempDir = await mkdtemp(join(tmpdir(), "twprevbot-youtube-test-"));
  const calls: Array<{ file: string; args: string[] }> = [];

  try {
    const result = await fetchYouTubePreview(source, {
      createTempDir: () => Promise.resolve(tempDir),
      ytDlpPath: "/usr/bin/yt-dlp",
      runCommand: async (file, args) => {
        calls.push({ file, args });

        if (args.includes("--dump-single-json")) {
          return {
            stdout: JSON.stringify({
              id: "dQw4w9WgXcQ",
              title: "Never Gonna Give You Up",
              description: "Official video",
              channel: "RickAstleyVEVO",
              webpage_url: source.url,
              thumbnails: [
                {
                  url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
                  width: 480,
                  height: 360,
                },
              ],
            }),
            stderr: "",
          };
        }

        const filePath = await writeFakeYouTubeFile(tempDir, "dQw4w9WgXcQ.mp4");
        return {
          stdout: `${filePath}\n`,
          stderr: "",
        };
      },
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.file, "/usr/bin/yt-dlp");
    assert.deepEqual(calls[0]?.args.slice(0, 3), [
      "--dump-single-json",
      "--no-download",
      "--no-playlist",
    ]);
    assert.deepEqual(calls[0]?.args.slice(3, 5), [
      "--js-runtimes",
      `node:${process.execPath}`,
    ]);
    assert.ok(calls[1]?.args.includes("--merge-output-format"));
    assert.ok(calls[1]?.args.includes("--js-runtimes"));
    assert.ok(calls[1]?.args.includes(`node:${process.execPath}`));
    assert.deepEqual(result, {
      id: "dQw4w9WgXcQ",
      url: source.url,
      authorName: "RickAstleyVEVO",
      text: "Never Gonna Give You Up\n\nOfficial video",
      media: [
        {
          kind: "video",
          url: source.url,
          thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
          localFilePath: join(tempDir, "dQw4w9WgXcQ.mp4"),
          forceUpload: true,
        },
      ],
      cleanupPaths: [tempDir],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("cleans up temp dir when youtube download fails", async () => {
  const source: YouTubeUrl = {
    videoId: "dQw4w9WgXcQ",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  };
  const tempDir = await mkdtemp(join(tmpdir(), "twprevbot-youtube-test-"));

  await assert.rejects(
    fetchYouTubePreview(source, {
      createTempDir: () => Promise.resolve(tempDir),
      ytDlpPath: "/usr/local/bin/yt-dlp",
      runCommand: (_file, args) => {
        if (args.includes("--dump-single-json")) {
          return Promise.resolve({
            stdout: JSON.stringify({ title: "Title" }),
            stderr: "",
          });
        }

        return Promise.reject(new Error("download failed"));
      },
    }),
    /download failed/,
  );

  await assert.rejects(
    rm(tempDir, { recursive: false }),
    /ENOENT|no such file or directory/i,
  );
});
