FROM node:24-bookworm-slim

WORKDIR /app

# company-control MCP is launched as a local stdio child process, so the
# image needs Python in addition to the Node/Codex runtime.
# The optional bookworm-updates suite is not needed for this image. Use the
# signed Aliyun Debian mirror, which is reachable from this deployment network;
# base and security repositories remain enabled and apt signature verification
# stays on. Retry transient package-transfer failures before failing a clean build.
RUN sed -i -e 's/ bookworm-updates//' \
      -e 's|http://deb.debian.org/debian-security|http://mirrors.aliyun.com/debian-security|g' \
      -e 's|http://deb.debian.org/debian|http://mirrors.aliyun.com/debian|g' \
      /etc/apt/sources.list.d/debian.sources \
  && for attempt in 1 2 3 4 5; do \
       rm -rf /var/lib/apt/lists/*; \
       if apt-get update \
          && apt-get -o Acquire::Retries=5 install -y --no-install-recommends python3 python3-venv; then break; fi; \
       if [ "$attempt" = 5 ]; then exit 1; fi; \
       sleep 3; \
     done \
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
