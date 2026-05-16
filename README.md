# twprevbot

A Telegram bot that provides rich previews for Twitter/X links sent in chats.

Built with [grammy](https://grammy.dev), `@grammyjs/auto-retry`, and [FxTwitter API v2](https://docs.fxembed.com/api/twitter/).

## Features

- Detects `twitter.com`, `x.com`, `mobile.twitter.com`, and `fxtwitter.com` status links
- Fetches tweet data and full thread chains via FxTwitter API
- Sends previews with tweet text, author (linked), media, and image alt text
- Thread tweets are sent as a Telegram reply chain from root to end
- Uses Telegram HTML formatting with plain-text fallback
- Inline mode: type `@twprevbot <link>` in any chat to send a preview on your behalf

## Setup

```bash
git clone https://github.com/yinyanfr/twprevbot.git
cd twprevbot
npm install
```

Copy `.env.example` to `.env` and fill in your bot credentials:

```env
TGBOTKEY=<your-bot-token>
TGBOTNAME=<your-bot-username>
```

## Usage

### Chat Mode

```bash
npm run build     # compile TypeScript (src/ → dist/)
node dist/app.js  # run the bot
```

The bot listens in chats for Twitter/X status links and replies with formatted previews.

### Inline Mode

In any chat, type `@twprevbot <link>` to send a preview as if from you:

- Single tweet with photo or video → inline media result with caption
- Single tweet without media → inline text result with HTML preview
- Thread tweets or multiple media → fxtwitter.com link (let FxTwitter generate the preview)

Inline mode must be enabled in [@BotFather](https://t.me/BotFather) with `/setinline`.

## Scripts

| Command                | Description                 |
| ---------------------- | --------------------------- |
| `npm run build`        | Compile TypeScript          |
| `npm run typecheck`    | Type-check without emitting |
| `npm run lint`         | Lint with ESLint            |
| `npm run format`       | Format with Prettier        |
| `npm run format:check` | Check formatting            |
| `npm test`             | Build then run node:test    |

## Architecture

- ESM (`"type": "module"`) + TypeScript `module: nodenext`
- `verbatimModuleSyntax` is on — use `import type` for type-only imports
- Source in `src/`, compiled output in `dist/`
