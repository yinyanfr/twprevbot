# twprevbot

A Telegram bot that provides rich previews for Twitter/X and Bilibili links sent in chats.

Built with [grammy](https://grammy.dev), `@grammyjs/auto-retry`, and [FxTwitter API v2](https://docs.fxembed.com/api/twitter/).

## Features

- Detects `twitter.com`, `x.com`, `mobile.twitter.com`, and `fxtwitter.com` status links
- Fetches tweet data and full thread chains via FxTwitter API
- Sends previews with tweet text, author (linked), media, and image alt text
- Supports up to 20 media per tweet, sent in order as Telegram albums of at most 10 items
- Only the first batch includes the caption; subsequent batches reply to the preceding batch
- Handles trailing single items and keeps GIF documents separate from photo/video albums
- Thread tweets are sent as a Telegram reply chain from root to end
- Sensitive/NSFW media marked with Telegram spoiler animation
- Uses Telegram HTML formatting with plain-text fallback
- Inline mode: type `@twprevbot <link>` in any chat to send a preview on your behalf
- Bilibili previews use native APIs and bounded streaming downloads, with one ffmpeg stream-copy merge (no yt-dlp fallback)
- Bilibili quality: up to 720p below 20 minutes, up to 480p at or above 20 minutes; availability depends on login and Bilibili
- Bilibili jobs use a global FIFO queue, active-link deduplication, and a two-link limit per chat; media failures fall back to text

## Setup

```bash
git clone https://github.com/yinyanfr/twprevbot.git
cd twprevbot
npm ci
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
node dist/app.js  # run manually
```

The bot listens in chats for Twitter/X status links and Bilibili video links
(BV/AV, `?p=N`, and `b23.tv`) and replies with formatted previews.

Telegram allows 2–10 items per album. A tweet with 20 photos/videos is sent as
two albums of 10; an 11-item tweet becomes an album plus one single-media
message. Media order, spoilers, and alt-text numbering are preserved. Further
thread posts reply to the last batch, while text-only continuations can append
to the first caption as before. If Telegram cannot fetch an album's URLs, the
bot downloads and uploads that batch directly before falling back to text.
Already sent albums are not resent.

Example: <https://twitter.com/pupii_55/status/2121925710239629421>.
All 20 items must be present in the upstream FxTwitter response.

For local Bilibili previews, install `ffmpeg` and optionally configure
`BILIBILI_COOKIE_FILE` with a Netscape cookie export. See `.env.example`.
Production uses Docker Compose and the local Telegram Bot API; see
[DEPLOYMENT.md](DEPLOYMENT.md). PM2 is no longer used or installed.

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

Before deployment, run `npm ci`, `npm audit`, and `npm audit --omit=dev`, then
the checks above. Commit both `package.json` and `package-lock.json` for
reproducible production installs. See [CHANGELOG.md](CHANGELOG.md) for changes.

## Architecture

```
src/
├── app.ts              # bot entrypoint and handlers
├── configs/
│   └── index.ts        # env loading
├── services/
│   ├── fx-twitter.ts   # FxTwitter API v2 client
│   └── bilibili.ts     # native Bilibili APIs, downloads and ffmpeg merge
├── libs/
│   ├── logger.ts       # pino logger
│   ├── html.ts         # Telegram HTML formatters
│   ├── twitter-url.ts  # tweet URL extraction
│   ├── preview.ts      # normalize API responses to preview posts
│   ├── telegram-preview.ts  # build regular chat preview payloads
│   ├── telegram-media-batches.ts # ordered albums, max 10, document separation
│   └── telegram-inline.ts   # build inline query results
├── tests/
│   ├── fx-twitter.test.ts
│   ├── html.test.ts
│   ├── preview.test.ts
│   ├── telegram-preview.test.ts
│   ├── telegram-inline.test.ts
│   └── twitter-url.test.ts
├── eslint.config.mjs
├── .prettierrc
└── tsconfig.json
```

- ESM (`"type": "module"`) + TypeScript `module: nodenext`
- `verbatimModuleSyntax` is on — use `import type` for type-only imports
- Source in `src/`, compiled output in `dist/`
