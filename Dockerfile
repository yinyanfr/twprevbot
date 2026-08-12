FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ARG YT_DLP_VERSION=2026.06.09
ARG YT_DLP_SHA256=e5d57466682cfa9d61e9cf7c8a4f09b00f4a62af37d3bbdc4bcffdf63615feac

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates curl ffmpeg python3 \
  && curl --fail --location --silent --show-error \
    "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp" \
    --output /usr/local/bin/yt-dlp \
  && printf '%s  %s\n' "${YT_DLP_SHA256}" /usr/local/bin/yt-dlp | sha256sum --check - \
  && chmod 0755 /usr/local/bin/yt-dlp \
  && apt-get purge --yes --auto-remove curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node

CMD ["node", "dist/app.js"]
