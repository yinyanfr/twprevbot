# Changelog

## 2026-11-19

### Fixed

- If Telegram cannot fetch an album by URL, download and upload that batch
  directly, preserving media order, spoilers, and the first-batch caption.
- Retry X CDN photo URLs that return 404 using the equivalent `format` query
  parameter, then try the `large` variant if the original is still unavailable.

## 2026-11-17

### Added

- Support tweets containing up to 20 media, preserving FxTwitter order.
- Split Telegram albums at 10 items, send batches sequentially, and send trailing
  singletons through the single-media path.
- Separate GIF documents from photo/video albums for Telegram compatibility.
- Regression tests for 1/2/10/11/19/20 media, mixed media, reply chains, captions,
  spoilers, alt text, empty input, and failures in later batches.

### Fixed

- Keep the caption on the first batch only, continue thread replies from the last
  batch, and retain the first caption as the text-continuation append target.
- Preserve media options and spoilers when retrying an album with plain text.
- Refresh npm dependencies and lockfile within existing major versions.
  Full and production-only npm audits report zero known vulnerabilities at
  verification time (previous full audit: 18, including 8 high severity).

### Removed

- Unused PM2 dependency, `serve` script, ecosystem configuration, ESLint exclusion,
  and PM2-only js-yaml override. Production runs exclusively with Docker Compose.

### Documentation

- Update README, agent instructions, and Git/Compose deployment checks.
- Document the existing native Bilibili API/download pipeline and the retained
  yt-dlp dependency of the separate, currently unwired YouTube service.
