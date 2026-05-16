import "dotenv/config";

export type AppConfig = {
  botToken: string;
  botName: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const botToken = env.TGBOTKEY;
  const botName = env.TGBOTNAME;

  if (botToken === undefined || botToken.length === 0) {
    throw new Error("Missing required environment variable TGBOTKEY");
  }

  if (botName === undefined || botName.length === 0) {
    throw new Error("Missing required environment variable TGBOTNAME");
  }

  return { botToken, botName };
}
