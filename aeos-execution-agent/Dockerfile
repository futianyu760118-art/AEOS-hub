# AEOS 执行面智能体（Sidecar 容器）
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production

# 健康检查：进程存活即可；业务健康由 /health 由 Hub 心跳体现。
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "process.exit(0)"

CMD ["node", "src/main.js"]
