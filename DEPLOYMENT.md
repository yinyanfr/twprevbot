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

Production updates are performed from Git only:

```bash
git pull --ff-only
docker compose up -d --build --remove-orphans
docker image prune -f
```

Inspect status and logs with:

```bash
docker compose ps
docker compose logs --tail=200 bot telegram-bot-api
```

## Returning to the public API

Stop the bot, call `logOut` against the local API, remove the local API root
configuration, and then restart the bot against `https://api.telegram.org`.
