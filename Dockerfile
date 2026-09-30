FROM node:24-bookworm-slim

WORKDIR /app

# company-control MCP is launched as a local stdio child process, so the
# image needs Python in addition to the Node/Codex runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY docker/requirements.txt ./docker/requirements.txt
RUN python3 -m venv /app/.venv \
  && /app/.venv/bin/pip install --no-cache-dir -r /app/docker/requirements.txt \
  && /app/.venv/bin/pip check

COPY . ./
RUN mkdir -p /app/data/artifacts /app/.codex-home/generated_images \
  && chown -R node:node /app/data /app/.codex-home \
  && sed -i 's/\r$//' /app/docker/entrypoint.sh \
  && chmod 755 /app/docker/entrypoint.sh

USER node
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz', {signal: AbortSignal.timeout(4000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["node", "src/server.ts"]
