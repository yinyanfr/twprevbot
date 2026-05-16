import pino from "pino";

export const logger = pino({
  name: "twprevbot",
  level: process.env.LOG_LEVEL ?? "info",
});
