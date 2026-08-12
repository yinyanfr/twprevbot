import "dotenv/config";

export type AppConfig = {
  botToken: string;
  botName: string;
  ytDlpPath?: string;
  ffmpegPath?: string;
  bilibiliCookieFile?: string;
  telegramApiRoot?: string;
  telegramLocalMode: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const botToken = env.TGBOTKEY;
  const botName = env.TGBOTNAME;
  const ytDlpPath = env.YTDLP_PATH?.trim();
  const ffmpegPath = env.FFMPEG_PATH?.trim();
  const bilibiliCookieFile =
    env.BILIBILI_COOKIE_FILE?.trim() || ".secrets/bilibili.cookies.txt";
  const telegramApiRoot = env.TELEGRAM_API_ROOT?.trim();
  const telegramLocalMode =
    env.TELEGRAM_LOCAL_MODE?.trim().toLowerCase() === "true";

  if (botToken === undefined || botToken.length === 0) {
    throw new Error("Missing required environment variable TGBOTKEY");
  }

  if (botName === undefined || botName.length === 0) {
    throw new Error("Missing required environment variable TGBOTNAME");
  }

  return {
    botToken,
    botName,
    ...(ytDlpPath !== undefined && ytDlpPath !== "" ? { ytDlpPath } : {}),
    ...(ffmpegPath !== undefined && ffmpegPath !== "" ? { ffmpegPath } : {}),
    bilibiliCookieFile,
    ...(telegramApiRoot !== undefined && telegramApiRoot !== ""
      ? { telegramApiRoot: telegramApiRoot.replace(/\/$/, "") }
      : {}),
    telegramLocalMode,
  };
}
