FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true

# Runtime packages:
# - chromium + fonts: required by node-html-to-image / puppeteer-core fallback paths
# - git: optional, used by getVersionInfo(); failures are non-fatal if .git is absent
# - python3/make/g++: allows sqlite3 native dependency to build if no prebuild is available
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        chromium \
        fonts-noto-cjk \
        git \
        python3 \
        make \
        g++ \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

COPY package.json ./

RUN pnpm install --prod --no-frozen-lockfile

COPY . .

RUN chmod +x /app/deploy/zeabur/entrypoint.sh \
    && mkdir -p /app/data /app/logs \
    && chown -R node:node /app

USER node

# This project is a Discord bot / background worker. It does not expose an HTTP port.
ENTRYPOINT ["/app/deploy/zeabur/entrypoint.sh"]
CMD ["pnpm", "start"]
