import type { TelegramMediaGroupItem } from "./telegram-preview.js";

export function getUploadedMediaFallbackTypes(
  mediaType: TelegramMediaGroupItem["type"],
): TelegramMediaGroupItem["type"][] {
  return mediaType === "video" ? ["video", "document"] : [mediaType];
}
