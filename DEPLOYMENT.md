# Docker Deployment

The production checkout lives at `/etc/docker/containers/twprevbot`. Docker
Compose runs both the bot and a local Telegram Bot API server.

## First deployment

1. Clone the `yt` branch into `/etc/docker/containers/twprevbot`.
2. Create `.env` with `TGBOTKEY`, `TGBOTNAME`, `TELEGRAM_API_ID`, and
   `TELEGRAM_API_HASH`.
3. Put the Netscape Bilibili cookie file at
   `.secrets/bilibili.cookies.txt`.
4. Secure the credentials and prepare writable data directories:

   ```bash
   chmod 600 .env .secrets/bilibili.cookies.txt
   chmod 700 .secrets
   mkdir -p data/telegram-bot-api data/telegram-bot-api-tmp data/tmp
   chown -R 101:101 data/telegram-bot-api data/telegram-bot-api-tmp
   chown -R 1000:1000 data/tmp .secrets/bilibili.cookies.txt
   ```

5. Stop the old bot process and call `logOut` once against the public Telegram
   API before starting the local API server.
6. Start the stack:

   ```bash
   docker compose up -d --build
   ```

## Updates

Production updates are performed from Git only. Commit and push the tested
changes to `origin/yt` first; never overwrite server source files using SCP.
PM2 is not used. Before pushing, run `npm ci`, `npm audit`, `npm test`,
`npm run typecheck`, `npm run lint`, and `npm run format:check`.

On `root@cs.yinyan.fr`:

```bash
cd /etc/docker/containers/twprevbot
git pull --ff-only origin yt
docker compose build bot
docker compose up -d --no-deps bot
```

Inspect status and logs with:

```bash
docker compose ps
docker compose logs --tail=200 bot telegram-bot-api
git status --short
git rev-parse --short HEAD
docker inspect -f '{{.RestartCount}}' twprevbot-bot-1
```

Confirm the deployed commit matches `origin/yt`, the worktree is clean, the bot
logs `Bot started`, and the configured Bot API answers `getMe` successfully.
Do not print tokens or cookie contents during checks.

Twitter/X previews with 20 photos/videos are split into two sequential
10-item albums. Validate normalization and batching with the example in the
README; do not send test messages to real chats without choosing a test target.
Bilibili uses native playurl requests and ffmpeg; cookies remain mounted
read-only and are sent only to Bilibili APIs, not media CDNs. The image still
includes yt-dlp solely for the separate, currently unwired YouTube service.

## Returning to the public API

Stop the bot, call `logOut` against the local API, remove the local API root
configuration, and then restart the bot against `https://api.telegram.org`.
