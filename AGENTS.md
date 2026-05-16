# AGENTS.md

## Commands

```bash
npm run typecheck     # typecheck only
npm run build         # build: src/ → dist/
npm run lint          # eslint
npm run format:check  # prettier check
npm test              # build then run node:test on dist/
node dist/app.js      # run
npm run serve          # build & start via pm2
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
  - `libs/telegram-inline.ts` — build inline query results (article/photo/video)
  - `app.ts` — bot wiring and runtime
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
