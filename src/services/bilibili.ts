import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
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
  owner: { name: string };
  dimension?: { width?: number; height?: number };
  pages: BilibiliViewPage[];
};

export type BilibiliDashStream = {
  id?: number;
  baseUrl?: string;
  base_url?: string;
  backupUrl?: string[];
  backup_url?: string[];
  bandwidth?: number;
  mimeType?: string;
  mime_type?: string;
  codecs?: string;
  width?: number;
  height?: number;
  codecid?: number;
};

export type BilibiliPlayInfo = {
  timelength?: number;
  dash?: {
    duration?: number;
    video?: BilibiliDashStream[];
    audio?: BilibiliDashStream[];
  };
};

type SelectedBilibiliStreams = {
  video: BilibiliDashStream;
  audio: BilibiliDashStream;
  estimatedBytes: number;
};

type CommandResult = { stdout: string; stderr: string };

export type BilibiliCommandRunner = (
  file: string,
  args: string[],
) => Promise<CommandResult>;

export type BilibiliStreamDownloader = (
  urls: readonly string[],
  destination: string,
  headers: Record<string, string>,
  maxBytes: number,
  fetcher: Fetcher,
) => Promise<number>;

export type BilibiliDependencies = {
  runCommand?: BilibiliCommandRunner;
  downloadStream?: BilibiliStreamDownloader;
  createTempDir?: () => Promise<string>;
  cookieFile?: string;
  ffmpegPath?: string;
  telegramLocalMode?: boolean;
};

const API_BASE_URL = "https://api.bilibili.com";
const BILIBILI_TIMEOUT_MS = 10_000;
const BILIBILI_DOWNLOAD_TIMEOUT_MS = 60 * 60_000;
const BILIBILI_COMMAND_TIMEOUT_MS = 60 * 60_000;
const OFFICIAL_TELEGRAM_MEDIA_LIMIT = 47 * 1024 * 1024;
const LOCAL_TELEGRAM_MEDIA_LIMIT = 1900 * 1024 * 1024;
const DEFAULT_FFMPEG_PATH = "ffmpeg";
const BILIBILI_TEMP_DIR_PREFIX = "twprevbot-bilibili-";
const LONG_VIDEO_DURATION_SECONDS = 20 * 60;
const DEFAULT_MAX_VIDEO_HEIGHT = 720;
const LONG_VIDEO_MAX_HEIGHT = 480;
const BILIBILI_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

export async function fetchBilibiliPreview(
  source: BilibiliUrl,
  fetcher: Fetcher = fetch,
  dependencies: BilibiliDependencies = {},
): Promise<PreviewPost | null> {
  const resolved = await resolveBilibiliUrl(source, fetcher);

  if (resolved === null) {
    return null;
  }

  const cookie = await readCookieHeader(dependencies.cookieFile);
  const headers = defaultHeaders(cookie);
  const viewQuery =
    resolved.bvid !== undefined
      ? `bvid=${resolved.bvid}`
      : `aid=${resolved.aid}`;
  const view = await fetchJson<BilibiliViewData>(
    `${API_BASE_URL}/x/web-interface/view?${viewQuery}`,
    fetcher,
    headers,
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
      headers,
      fetcher,
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
  headers: Record<string, string>,
  fetcher: Fetcher,
  dependencies: BilibiliDependencies,
): Promise<{
  localFilePath: string;
  tempDir: string;
  width?: number;
  height?: number;
  duration?: number;
}> {
  const runCommand = dependencies.runCommand ?? runCommandWithExecFile;
  const downloadStream = dependencies.downloadStream ?? downloadBoundedStream;
  const createTempDir =
    dependencies.createTempDir ??
    (() => mkdtemp(join(tmpdir(), BILIBILI_TEMP_DIR_PREFIX)));
  const ffmpegPath = dependencies.ffmpegPath ?? DEFAULT_FFMPEG_PATH;
  const mediaLimit =
    dependencies.telegramLocalMode === true
      ? LOCAL_TELEGRAM_MEDIA_LIMIT
      : OFFICIAL_TELEGRAM_MEDIA_LIMIT;
  const duration = page.duration;
  const maxHeight =
    (duration ?? 0) >= LONG_VIDEO_DURATION_SECONDS
      ? LONG_VIDEO_MAX_HEIGHT
      : DEFAULT_MAX_VIDEO_HEIGHT;
  const playUrl = new URL(`${API_BASE_URL}/x/player/playurl`);
  playUrl.searchParams.set("bvid", bvid);
  playUrl.searchParams.set("cid", String(page.cid));
  playUrl.searchParams.set("qn", maxHeight === 720 ? "64" : "32");
  playUrl.searchParams.set("fnver", "0");
  playUrl.searchParams.set("fnval", "16");
  playUrl.searchParams.set("fourk", "0");
  playUrl.searchParams.set("platform", "web");
  const playInfo = await fetchJson<BilibiliPlayInfo>(
    playUrl.toString(),
    fetcher,
    headers,
  );
  const effectiveDuration =
    duration ??
    playInfo.dash?.duration ??
    (playInfo.timelength !== undefined
      ? playInfo.timelength / 1000
      : undefined);
  const selected = selectBilibiliFormats(
    playInfo,
    effectiveDuration,
    mediaLimit,
  );
  const tempDir = await createTempDir();
  const videoPath = join(tempDir, `${bvid}-p${page.page}-video.m4s`);
  const audioPath = join(tempDir, `${bvid}-p${page.page}-audio.m4s`);
  const finalPath = join(tempDir, `${bvid}-p${page.page}.mp4`);
  const downloadHeaders = {
    "User-Agent": BILIBILI_USER_AGENT,
    Referer: canonicalUrl,
    Origin: "https://www.bilibili.com",
  };

  try {
    const audioBytes = await downloadStream(
      streamUrls(selected.audio),
      audioPath,
      downloadHeaders,
      mediaLimit,
      fetcher,
    );
    await downloadStream(
      streamUrls(selected.video),
      videoPath,
      downloadHeaders,
      mediaLimit - audioBytes,
      fetcher,
    );
    await runCommand(ffmpegPath, [
      "-y",
      "-loglevel",
      "error",
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      finalPath,
    ]);

    const finalSize = (await stat(finalPath)).size;
    if (finalSize > mediaLimit) {
      throw new Error("Prepared Bilibili media exceeds the upload limit");
    }

    return {
      localFilePath: finalPath,
      tempDir,
      ...(selected.video.width !== undefined
        ? { width: selected.video.width }
        : {}),
      ...(selected.video.height !== undefined
        ? { height: selected.video.height }
        : {}),
      ...(effectiveDuration !== undefined
        ? { duration: Math.round(effectiveDuration) }
        : {}),
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

export function selectBilibiliFormats(
  playInfo: BilibiliPlayInfo,
  duration: number | undefined,
  mediaLimit: number,
): SelectedBilibiliStreams {
  const maxVideoHeight =
    (duration ?? 0) >= LONG_VIDEO_DURATION_SECONDS
      ? LONG_VIDEO_MAX_HEIGHT
      : DEFAULT_MAX_VIDEO_HEIGHT;
  const audios = (playInfo.dash?.audio ?? [])
    .filter(
      (stream) =>
        streamBaseUrl(stream) !== undefined &&
        streamCodecs(stream).startsWith("mp4a") &&
        streamMimeType(stream) === "audio/mp4",
    )
    .sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0));
  const videos = (playInfo.dash?.video ?? [])
    .filter(
      (stream) =>
        streamBaseUrl(stream) !== undefined &&
        (streamCodecs(stream).startsWith("avc1") || stream.codecid === 7) &&
        streamMimeType(stream) === "video/mp4" &&
        stream.height !== undefined &&
        stream.height <= maxVideoHeight,
    )
    .sort(
      (a, b) =>
        (b.height ?? 0) - (a.height ?? 0) ||
        (b.bandwidth ?? 0) - (a.bandwidth ?? 0),
    );

  if (audios.length === 0) {
    throw new Error("Bilibili did not provide a compatible AAC audio stream");
  }

  const selected = videos
    .flatMap((video) =>
      audios.map((audio) => ({
        video,
        audio,
        estimatedBytes:
          estimateStreamSize(video, duration) +
          estimateStreamSize(audio, duration),
      })),
    )
    .find((candidate) => candidate.estimatedBytes <= mediaLimit);

  if (selected === undefined) {
    throw new Error(
      "Bilibili did not provide a compatible H.264 video stream within the upload limit",
    );
  }

  return selected;
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

async function downloadBoundedStream(
  urls: readonly string[],
  destination: string,
  headers: Record<string, string>,
  maxBytes: number,
  fetcher: Fetcher,
): Promise<number> {
  let lastError: unknown;

  for (const url of urls) {
    try {
      const response = await fetcher(url, {
        headers,
        signal: AbortSignal.timeout(BILIBILI_DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok || response.body === null) {
        await cancelResponseBody(response);
        throw new Error(
          `Bilibili media download failed: ${response.status} ${response.statusText}`,
        );
      }

      const declaredSize = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
        await cancelResponseBody(response);
        throw new Error("Bilibili media stream exceeds the upload limit");
      }

      let bytes = 0;
      const body = response.body as unknown as AsyncIterable<Uint8Array>;
      const source = Readable.from(
        (async function* () {
          for await (const chunk of body) {
            bytes += chunk.byteLength;
            if (bytes > maxBytes) {
              throw new Error("Bilibili media stream exceeds the upload limit");
            }
            yield chunk;
          }
        })(),
      );
      await pipeline(source, createWriteStream(destination, { mode: 0o600 }));
      return bytes;
    } catch (error) {
      lastError = error;
      await rm(destination, { force: true });
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Bilibili did not provide a media URL", { cause: lastError });
}

async function readCookieHeader(
  cookieFile: string | undefined,
): Promise<string | undefined> {
  if (cookieFile === undefined || cookieFile === "") {
    return undefined;
  }

  try {
    const now = Date.now() / 1000;
    const cookies = (await readFile(cookieFile, "utf8"))
      .split(/\r?\n/)
      .map((line) =>
        line.startsWith("#HttpOnly_") ? line.slice("#HttpOnly_".length) : line,
      )
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => line.split("\t"))
      .filter(
        (fields) =>
          fields.length >= 7 &&
          (Number(fields[4]) === 0 || Number(fields[4]) > now),
      )
      .map((fields) => `${fields[5]}=${fields[6]}`);
    return cookies.length > 0 ? cookies.join("; ") : undefined;
  } catch {
    return undefined;
  }
}

function estimateStreamSize(
  stream: BilibiliDashStream,
  duration: number | undefined,
): number {
  return stream.bandwidth !== undefined &&
    duration !== undefined &&
    duration > 0
    ? (stream.bandwidth * duration) / 8
    : Number.POSITIVE_INFINITY;
}

function streamBaseUrl(stream: BilibiliDashStream): string | undefined {
  return stream.baseUrl ?? stream.base_url;
}

function streamUrls(stream: BilibiliDashStream): string[] {
  const primary = streamBaseUrl(stream);
  return primary === undefined
    ? []
    : [primary, ...(stream.backupUrl ?? stream.backup_url ?? [])];
}

function streamMimeType(stream: BilibiliDashStream): string {
  return stream.mimeType ?? stream.mime_type ?? "";
}

function streamCodecs(stream: BilibiliDashStream): string {
  return stream.codecs ?? "";
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
  return location === null
    ? null
    : parseRedirectUrl(new URL(location, source.url).toString());
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
  const videoId = match?.[1];
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

function defaultHeaders(cookie?: string): Record<string, string> {
  return {
    Referer: "https://www.bilibili.com/",
    "User-Agent": BILIBILI_USER_AGENT,
    ...(cookie !== undefined ? { Cookie: cookie } : {}),
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
