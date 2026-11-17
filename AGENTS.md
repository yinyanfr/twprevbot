# AGENTS.md

## Commands

```bash
npm run typecheck     # typecheck only
npm run build         # build: src/ → dist/
npm run lint          # eslint
npm run format:check  # prettier check
npm test              # build then run node:test on dist/
node dist/app.js      # run
docker compose up -d --build # production runtime (no PM2)
```

## Architecture

- Telegram bot using [grammy](https://grammy.dev) with `@grammyjs/auto-retry`.
- ESM (`"type": "module"`) + TypeScript `module: nodenext`. Imports must use `.js` extensions.
- `verbatimModuleSyntax` is on — use `import type` for type-only imports.
- `isolatedModules` is on — no cross-module type reliance (e.g. no `const enum` re-exports).
- FxTwitter API v2 at `https://api.fxtwitter.com/2/thread/{id}`. One silent retry on network `TypeError`; HTTP/API errors are not retried.
- Source modules:
  - `configs/index.ts` — env loading
  - `libs/twitter-url.ts` — extract tweet IDs from message text
  - `services/fx-twitter.ts` — FxTwitter API client + types
  - `libs/preview.ts` — normalize API responses into `PreviewPost[]`
  - `libs/html.ts` — Telegram HTML formatting helpers
  - `libs/telegram-preview.ts` — build send payloads (text / mediaGroup)
  - `libs/telegram-media-batches.ts` — ordered batches of at most 10, document separation, sequential sends and reply chaining
  - `libs/telegram-inline.ts` — build inline query results (article/photo/video)
  - `app.ts` — bot wiring and runtime
- Tweets can contain up to 20 media; preserve API order and never truncate.
  Telegram albums allow 2–10 items. Send trailing singletons separately, keep
  documents out of photo/video albums, and caption only the first batch.
  Reply chains continue from the last batch; caption append targets stay on the first.
- Bilibili uses native view/playurl APIs, bounded streaming downloads and one
  ffmpeg stream-copy merge, not yt-dlp. Keep its FIFO queue and request limits.
- Production uses Git (`yt`) and Docker Compose in
  `/etc/docker/containers/twprevbot`; see `DEPLOYMENT.md`. No PM2 or SCP source updates.
- Tests in `src/tests/` (`*.test.ts`) use `node:test` + `node:assert/strict`. Run via `npm test`.

## Environment

Required env vars (loaded via `dotenv`):

| Variable    | Purpose       |
| ----------- | ------------- |
| `TGBOTKEY`  | Bot API token |
| `TGBOTNAME` | Bot username  |

`.env` is gitignored. Use `.env.example` for the template.

## References

- Parent project: https://github.com/yinyanfr/twitter-declowning-bot
