import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import type { PreviewPost } from "../libs/preview.js";
import type { YouTubeUrl } from "../libs/youtube-url.js";

type YouTubeThumbnail = {
  url: string;
  width?: number;
  height?: number;
};

type YouTubeMetadata = {
  id?: string;
  title?: string;
  description?: string;
  channel?: string;
  uploader?: string;
  webpage_url?: string;
  original_url?: string;
  thumbnails?: YouTubeThumbnail[];
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  file: string,
  args: string[],
) => Promise<CommandResult>;

export type TempDirFactory = () => Promise<string>;

type YouTubeDependencies = {
  runCommand?: CommandRunner;
  createTempDir?: TempDirFactory;
  ytDlpPath?: string;
};

const DEFAULT_YT_DLP_PATH = "yt-dlp";
const YT_DLP_TIMEOUT_MS = 120_000;
const YOUTUBE_FORMAT =
  "bestvideo[ext=mp4][vcodec!=none]+bestaudio[ext=m4a][acodec!=none]/best[ext=mp4][acodec!=none]/best[acodec!=none]";
const MEDIA_EXTENSIONS = new Set([".mp4", ".mkv", ".webm", ".mov", ".m4v"]);

export async function fetchYouTubePreview(
  source: YouTubeUrl,
  dependencies: YouTubeDependencies = {},
): Promise<PreviewPost> {
  const runCommand = dependencies.runCommand ?? runCommandWithExecFile;
  const createTempDir = dependencies.createTempDir ?? createTempDirInSystemTemp;
  const ytDlpPath = dependencies.ytDlpPath ?? DEFAULT_YT_DLP_PATH;
  const metadata = await fetchMetadata(source, runCommand, ytDlpPath);
  const tempDir = await createTempDir();

  try {
    const localFilePath = await downloadVideo(
      source,
      tempDir,
      runCommand,
      ytDlpPath,
    );

    return {
      id: metadata.id ?? source.videoId,
      url: metadata.webpage_url ?? metadata.original_url ?? source.url,
      authorName: metadata.channel ?? metadata.uploader ?? "YouTube",
      text: buildDescription(metadata.title, metadata.description),
      media: [
        buildPreviewMedia(
          metadata.webpage_url ?? metadata.original_url ?? source.url,
          localFilePath,
          selectThumbnailUrl(metadata.thumbnails),
        ),
      ],
      cleanupPaths: [tempDir],
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

async function fetchMetadata(
  source: YouTubeUrl,
  runCommand: CommandRunner,
  ytDlpPath: string,
): Promise<YouTubeMetadata> {
  const result = await runCommand(ytDlpPath, [
    "--dump-single-json",
    "--no-download",
    "--no-playlist",
    "--",
    source.url,
  ]);

  try {
    return JSON.parse(result.stdout) as YouTubeMetadata;
  } catch (error) {
    throw new Error(`Failed to parse yt-dlp metadata JSON: ${String(error)}`, {
      cause: error,
    });
  }
}

async function downloadVideo(
  source: YouTubeUrl,
  tempDir: string,
  runCommand: CommandRunner,
  ytDlpPath: string,
): Promise<string> {
  const outputTemplate = join(tempDir, "%(id)s.%(ext)s");
  const result = await runCommand(ytDlpPath, [
    "--no-playlist",
    "--no-progress",
    "--no-part",
    "--restrict-filenames",
    "--output",
    outputTemplate,
    "--format",
    YOUTUBE_FORMAT,
    "--merge-output-format",
    "mp4",
    "--print",
    "after_move:%(filepath)s",
    "--",
    source.url,
  ]);
  const printedPath = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .at(-1);

  if (printedPath !== undefined) {
    return printedPath;
  }

  return await findDownloadedFile(tempDir);
}

async function findDownloadedFile(tempDir: string): Promise<string> {
  const entries = await readdir(tempDir, { withFileTypes: true });
  const file = entries.find(
    (entry) =>
      entry.isFile() && MEDIA_EXTENSIONS.has(extname(entry.name).toLowerCase()),
  );

  if (file === undefined) {
    throw new Error("yt-dlp did not produce a downloadable media file");
  }

  return join(tempDir, file.name);
}

function buildDescription(title?: string, description?: string): string {
  const trimmedTitle = title?.trim() ?? "YouTube 视频";
  const trimmedDescription = description?.trim() ?? "";

  if (trimmedDescription === "") {
    return trimmedTitle;
  }

  return `${trimmedTitle}\n\n${trimmedDescription}`;
}

function buildPreviewMedia(
  url: string,
  localFilePath: string,
  thumbnailUrl?: string,
): PreviewPost["media"][number] {
  return {
    kind: "video",
    url,
    localFilePath,
    forceUpload: true,
    ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
  };
}

function selectThumbnailUrl(
  thumbnails?: YouTubeThumbnail[],
): string | undefined {
  return [...(thumbnails ?? [])]
    .sort(
      (a, b) =>
        (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0),
    )
    .find((thumbnail) => thumbnail.url.trim() !== "")?.url;
}

async function createTempDirInSystemTemp(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "twprevbot-youtube-"));
}

async function runCommandWithExecFile(
  file: string,
  args: string[],
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: YT_DLP_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(
            new Error(
              `Command failed: ${basename(file)} ${args.join(" ")}\n${stderr || stdout}`,
            ),
          );
          return;
        }

        resolve({ stdout, stderr });
      },
    );
  });
}

export async function writeFakeYouTubeFile(
  tempDir: string,
  filename: string,
): Promise<string> {
  const filePath = join(tempDir, filename);
  await writeFile(filePath, "video");
  return filePath;
}
