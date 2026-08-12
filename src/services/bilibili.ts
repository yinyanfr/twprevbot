import { execFile } from "node:child_process";
import { access, copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { logger } from "../libs/logger.js";
import type { PreviewPost } from "../libs/preview.js";
import type { BilibiliUrl } from "../libs/bilibili-url.js";

export type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

type BilibiliApiEnvelope<T> = {
  code: number;
  message: string;
  data?: T;
};

type BilibiliViewPage = {
  cid: number;
  page: number;
  part: string;
  duration?: number;
  dimension?: {
    width?: number;
    height?: number;
  };
};

type BilibiliViewData = {
  bvid: string;
  title: string;
  desc: string;
  pic: string;
  owner: {
    name: string;
  };
  dimension?: {
    width?: number;
    height?: number;
  };
  pages: BilibiliViewPage[];
};

type BilibiliFormat = {
  format_id?: string;
  vcodec?: string;
  acodec?: string;
  width?: number;
  height?: number;
  quality?: number;
  tbr?: number;
  abr?: number;
  filesize?: number;
  filesize_approx?: number;
};

type BilibiliYtDlpMetadata = {
  duration?: number;
  formats?: BilibiliFormat[];
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

export type BilibiliCommandRunner = (
  file: string,
  args: string[],
) => Promise<CommandResult>;

export type BilibiliDependencies = {
  runCommand?: BilibiliCommandRunner;
  createTempDir?: () => Promise<string>;
  cookieFile?: string;
  ytDlpPath?: string;
  ffmpegPath?: string;
  telegramLocalMode?: boolean;
};

const API_BASE_URL = "https://api.bilibili.com";
const BILIBILI_TIMEOUT_MS = 10_000;
const BILIBILI_COMMAND_TIMEOUT_MS = 60 * 60_000;
const OFFICIAL_TELEGRAM_MEDIA_LIMIT = 47 * 1024 * 1024;
const LOCAL_TELEGRAM_MEDIA_LIMIT = 1900 * 1024 * 1024;
const DEFAULT_YT_DLP_PATH = "yt-dlp";
const DEFAULT_FFMPEG_PATH = "ffmpeg";
const BILIBILI_TEMP_DIR_PREFIX = "twprevbot-bilibili-";
const BILIBILI_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
let bilibiliMediaBusy = false;

export async function fetchBilibiliPreview(
  source: BilibiliUrl,
  fetcher: Fetcher = fetch,
  dependencies: BilibiliDependencies = {},
): Promise<PreviewPost | null> {
  const resolved = await resolveBilibiliUrl(source, fetcher);

  if (resolved === null) {
    return null;
  }

  const viewQuery =
    resolved.bvid !== undefined
      ? `bvid=${resolved.bvid}`
      : `aid=${resolved.aid}`;
  const view = await fetchJson<BilibiliViewData>(
    `${API_BASE_URL}/x/web-interface/view?${viewQuery}`,
    fetcher,
    defaultHeaders(),
  );
  const page = view.pages[resolved.page - 1] ?? view.pages[0];

  if (page === undefined) {
    return null;
  }

  const canonicalUrl = `${new URL(resolved.url).origin}/video/${view.bvid}/?p=${page.page}`;
  let media: Awaited<ReturnType<typeof prepareBilibiliMedia>> | undefined;

  try {
    media = await prepareBilibiliMedia(
      canonicalUrl,
      view.bvid,
      page,
      dependencies,
    );
  } catch (error) {
    logger.warn(
      { err: error, bilibiliUrl: canonicalUrl },
      "Failed to prepare Bilibili media; using text preview",
    );
  }

  if (media === undefined) {
    return {
      id: `${view.bvid}-p${page.page}`,
      url: canonicalUrl,
      authorName: view.owner.name,
      text: buildDescription(view.title, view.desc, page),
      media: [],
    };
  }
  const width = media.width ?? page.dimension?.width ?? view.dimension?.width;
  const height =
    media.height ?? page.dimension?.height ?? view.dimension?.height;
  const duration = media.duration ?? page.duration;

  return {
    id: `${view.bvid}-p${page.page}`,
    url: canonicalUrl,
    authorName: view.owner.name,
    text: buildDescription(view.title, view.desc, page),
    media: [
      {
        kind: "video",
        url: canonicalUrl,
        thumbnailUrl: view.pic,
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        ...(duration !== undefined ? { duration } : {}),
        supportsStreaming: true,
        localFilePath: media.localFilePath,
        forceUpload: true,
        allowDocumentFallback: false,
        preserveHtmlCaption: true,
      },
    ],
    cleanupPaths: [media.tempDir],
  };
}

async function prepareBilibiliMedia(
  canonicalUrl: string,
  bvid: string,
  page: BilibiliViewPage,
  dependencies: BilibiliDependencies,
): Promise<{
  localFilePath: string;
  tempDir: string;
  width?: number;
  height?: number;
  duration?: number;
}> {
  if (bilibiliMediaBusy) {
    throw new Error("Bilibili media preparation is already in progress");
  }

  bilibiliMediaBusy = true;
  try {
    return await prepareBilibiliMediaWithSlot(
      canonicalUrl,
      bvid,
      page,
      dependencies,
    );
  } finally {
    bilibiliMediaBusy = false;
  }
}

async function prepareBilibiliMediaWithSlot(
  canonicalUrl: string,
  bvid: string,
  page: BilibiliViewPage,
  dependencies: BilibiliDependencies,
): Promise<{
  localFilePath: string;
  tempDir: string;
  width?: number;
  height?: number;
  duration?: number;
}> {
  const runCommand = dependencies.runCommand ?? runCommandWithExecFile;
  const createTempDir =
    dependencies.createTempDir ??
    (() => mkdtemp(join(tmpdir(), BILIBILI_TEMP_DIR_PREFIX)));
  const ytDlpPath = dependencies.ytDlpPath ?? DEFAULT_YT_DLP_PATH;
  const ffmpegPath = dependencies.ffmpegPath ?? DEFAULT_FFMPEG_PATH;
  const tempDir = await createTempDir();
  const mergedPath = join(tempDir, `${bvid}-p${page.page}-merged.mp4`);
  const finalPath = join(tempDir, `${bvid}-p${page.page}.mp4`);

  try {
    const cookieArgs = await buildCookieArgs(dependencies.cookieFile, tempDir);
    const metadataResult = await runCommand(ytDlpPath, [
      "--dump-single-json",
      "--no-download",
      "--no-playlist",
      ...cookieArgs,
      "--",
      canonicalUrl,
    ]);
    const metadata = parseYtDlpMetadata(metadataResult.stdout);
    const selected = selectBilibiliFormats(
      metadata,
      dependencies.telegramLocalMode === true
        ? LOCAL_TELEGRAM_MEDIA_LIMIT
        : OFFICIAL_TELEGRAM_MEDIA_LIMIT,
    );
    await runCommand(ytDlpPath, [
      "--no-playlist",
      "--no-progress",
      "--no-part",
      "--ffmpeg-location",
      ffmpegPath,
      ...cookieArgs,
      "--format",
      `${selected.video.format_id}+${selected.audio.format_id}`,
      "--merge-output-format",
      "mp4",
      "--output",
      mergedPath,
      "--",
      canonicalUrl,
    ]);
    const downloadedPath = await findDownloadedVideo(tempDir, mergedPath);
    await runCommand(ffmpegPath, [
      "-y",
      "-i",
      downloadedPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      finalPath,
    ]);

    return {
      localFilePath: finalPath,
      tempDir,
      ...(selected.video.width !== undefined
        ? { width: selected.video.width }
        : {}),
      ...(selected.video.height !== undefined
        ? { height: selected.video.height }
        : {}),
      ...(metadata.duration !== undefined
        ? { duration: Math.round(metadata.duration) }
        : {}),
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

export async function cleanupStaleBilibiliTempDirs(
  root = tmpdir(),
): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });

  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.startsWith(BILIBILI_TEMP_DIR_PREFIX),
      )
      .map((entry) =>
        rm(join(root, entry.name), { recursive: true, force: true }),
      ),
  );
}

async function buildCookieArgs(
  cookieFile: string | undefined,
  tempDir: string,
): Promise<string[]> {
  if (cookieFile === undefined || cookieFile === "") {
    return [];
  }

  try {
    await access(cookieFile);
    const writableCookieFile = join(tempDir, ".yt-dlp-cookies.txt");
    await copyFile(cookieFile, writableCookieFile);
    return ["--cookies", writableCookieFile];
  } catch {
    return [];
  }
}

function parseYtDlpMetadata(stdout: string): BilibiliYtDlpMetadata {
  try {
    return JSON.parse(stdout) as BilibiliYtDlpMetadata;
  } catch (error) {
    throw new Error(
      `Failed to parse Bilibili yt-dlp metadata: ${String(error)}`,
      {
        cause: error,
      },
    );
  }
}

export function selectBilibiliFormats(
  metadata: BilibiliYtDlpMetadata,
  mediaLimit: number,
): {
  video: BilibiliFormat & { format_id: string };
  audio: BilibiliFormat & { format_id: string };
} {
  const formats = metadata.formats ?? [];
  const audios = formats
    .filter(
      (format): format is BilibiliFormat & { format_id: string } =>
        format.format_id !== undefined &&
        format.vcodec === "none" &&
        format.acodec?.startsWith("mp4a") === true,
    )
    .sort((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0));

  if (audios.length === 0) {
    throw new Error("Bilibili did not provide a compatible AAC audio stream");
  }

  const duration = metadata.duration ?? 0;
  const videos = formats
    .filter(
      (format): format is BilibiliFormat & { format_id: string } =>
        format.format_id !== undefined &&
        format.vcodec?.startsWith("avc1") === true &&
        format.acodec === "none" &&
        (format.height ?? 0) <= 1080,
    )
    .sort(
      (a, b) =>
        (b.height ?? 0) - (a.height ?? 0) ||
        (b.quality ?? 0) - (a.quality ?? 0) ||
        (b.tbr ?? 0) - (a.tbr ?? 0),
    );
  const selected = videos
    .flatMap((video) =>
      audios.map((audio) => ({
        video,
        audio,
        size:
          estimateFormatSize(video, duration) +
          estimateFormatSize(audio, duration),
      })),
    )
    .find((candidate) => candidate.size <= mediaLimit);

  if (selected === undefined) {
    throw new Error(
      "Bilibili did not provide a compatible H.264 video stream within the upload limit",
    );
  }

  return { video: selected.video, audio: selected.audio };
}

function estimateFormatSize(format: BilibiliFormat, duration: number): number {
  return (
    format.filesize ??
    format.filesize_approx ??
    (format.tbr !== undefined && duration > 0
      ? (format.tbr * 1000 * duration) / 8
      : Number.POSITIVE_INFINITY)
  );
}

async function findDownloadedVideo(
  tempDir: string,
  expectedPath: string,
): Promise<string> {
  try {
    await access(expectedPath);
    return expectedPath;
  } catch {
    const entries = await readdir(tempDir, { withFileTypes: true });
    const entry = entries.find(
      (item) => item.isFile() && extname(item.name).toLowerCase() === ".mp4",
    );

    if (entry === undefined) {
      throw new Error("yt-dlp did not produce a Bilibili MP4 file");
    }

    return join(tempDir, entry.name);
  }
}

async function runCommandWithExecFile(
  file: string,
  args: string[],
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: BILIBILI_COMMAND_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(
            new Error(
              `Command failed: ${basename(file)} ${args.join(" ")}\n${stderr || stdout}`,
              { cause: error },
            ),
          );
          return;
        }

        resolve({ stdout, stderr });
      },
    );
  });
}

async function resolveBilibiliUrl(
  source: BilibiliUrl,
  fetcher: Fetcher,
): Promise<Extract<BilibiliUrl, { kind: "direct" }> | null> {
  if (source.kind === "direct") {
    return source;
  }

  const response = await fetchWithRetry(source.url, fetcher, {
    headers: defaultHeaders(),
    redirect: "manual",
  });
  const location = response.headers.get("location");

  await cancelResponseBody(response);

  if (location === null) {
    return null;
  }

  return parseRedirectUrl(new URL(location, source.url).toString());
}

function parseRedirectUrl(
  url: string,
): Extract<BilibiliUrl, { kind: "direct" }> | null {
  const parsed = new URL(url);

  if (
    parsed.hostname !== "bilibili.com" &&
    parsed.hostname !== "www.bilibili.com"
  ) {
    return null;
  }

  const match = parsed.pathname.match(/^\/video\/(BV[0-9A-Za-z]+|av\d+)\/?$/i);

  if (match === null) {
    return null;
  }

  const videoId = match[1];

  if (videoId === undefined) {
    return null;
  }

  const rawPage = Number(parsed.searchParams.get("p"));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  return videoId.toLowerCase().startsWith("av")
    ? {
        kind: "direct",
        url: `${parsed.origin}/video/${videoId}/`,
        page,
        aid: videoId.slice(2),
      }
    : {
        kind: "direct",
        url: `${parsed.origin}/video/${videoId}/`,
        page,
        bvid: videoId,
      };
}

async function fetchJson<T>(
  url: string,
  fetcher: Fetcher,
  headers: Record<string, string>,
): Promise<T> {
  const response = await fetchWithRetry(url, fetcher, { headers });

  if (!response.ok) {
    await cancelResponseBody(response);
    throw new Error(
      `Bilibili API request failed: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as BilibiliApiEnvelope<T>;

  if (payload.code !== 0 || payload.data === undefined) {
    throw new Error(
      `Bilibili API error: ${payload.code} ${payload.message || "unknown error"}`,
    );
  }

  return payload.data;
}

async function fetchWithRetry(
  url: string,
  fetcher: Fetcher,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(BILIBILI_TIMEOUT_MS),
    });
  } catch (error) {
    if (!isNetworkError(error)) {
      throw error;
    }

    return await fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(BILIBILI_TIMEOUT_MS),
    });
  }
}

function buildDescription(
  title: string,
  desc: string,
  page: BilibiliViewPage,
): string {
  const parts = [title];
  const trimmedTitle = title.trim();
  const trimmedPart = page.part.trim();

  if (trimmedPart !== "" && trimmedPart !== trimmedTitle) {
    parts.push(`分P ${page.page}: ${page.part}`);
  }

  const trimmedDesc = desc.trim();

  if (trimmedDesc !== "") {
    parts.push(trimmedDesc);
  }

  return parts.join("\n\n");
}

function defaultHeaders(): Record<string, string> {
  return {
    Referer: "https://www.bilibili.com/",
    "User-Agent": BILIBILI_USER_AGENT,
  };
}

function isNetworkError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === "TimeoutError")
  );
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Ignore cancellation failures on already-closed bodies.
  }
}
