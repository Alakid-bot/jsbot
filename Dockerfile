FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true

# Runtime packages:
# - chromium + fonts: required by node-html-to-image / puppeteer-core fallback paths
# - git: optional, used by getVersionInfo(); failures are non-fatal if .git is absent
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        chromium \
        fonts-noto-cjk \
        git \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./

RUN npm install --omit=dev --no-audit --no-fund

COPY . .

RUN chmod +x /app/deploy/zeabur/entrypoint.sh \
    && mkdir -p /app/data /app/logs \
    && chown -R node:node /app

USER node

# The supervisor exposes the protected web configuration page and manages the bot process.
EXPOSE 8080

ENTRYPOINT ["/app/deploy/zeabur/entrypoint.sh"]
CMD ["node", "src/supervisor.js"]
