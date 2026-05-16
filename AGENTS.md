# AGENTS.md

## Commands

```bash
npm run typecheck     # typecheck only
npm run build         # build: src/ → dist/
npm run lint          # eslint
npm run format:check  # prettier check
npm test              # build then run node:test on dist/
node dist/app.js      # run
```

## Architecture

- Telegram bot using [grammy](https://grammy.dev) with `@grammyjs/auto-retry`.
- ESM (`"type": "module"`) + TypeScript `module: nodenext`. Imports must use `.js` extensions.
- `verbatimModuleSyntax` is on — use `import type` for type-only imports.
- `isolatedModules` is on — no cross-module type reliance (e.g. no `const enum` re-exports).

## Environment

Required env vars (loaded via `dotenv`):

| Variable    | Purpose       |
| ----------- | ------------- |
| `TGBOTKEY`  | Bot API token |
| `TGBOTNAME` | Bot username  |

`.env` is gitignored. Use `.env.example` for the template.

## References

- Parent project: https://github.com/yinyanfr/twitter-declowning-bot
