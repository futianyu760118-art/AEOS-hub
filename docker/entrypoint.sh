#!/bin/sh
set -eu

# A fresh named volume has no model section.  This optional bootstrap keeps
# the existing Web configuration workflow intact while making a first Docker
# start usable when DEEPSEEK_API_KEY is injected at runtime.
if [ ! -f /app/.codex-home/config.toml ] && [ -n "${DEEPSEEK_API_KEY:-}" ]; then
  mkdir -p /app/.codex-home
  printf '%s\n' \
    'model = "deepseek-chat"' \
    'model_provider = "deepseek"' \
    '' \
    '[model_providers.deepseek]' \
    'name = "deepseek"' \
    'base_url = "https://api.deepseek.com/v1"' \
    'env_key = "DEEPSEEK_API_KEY"' \
    'wire_api = "responses"' \
    > /app/.codex-home/config.toml
fi

# These bootstraps are idempotent. They establish the Harbor identities and
# bindings required for dashboard dispatch before the web service accepts work.
# Keeping them here also repairs existing Docker volumes created before the
# quality and material-kitting squads were added.
node /app/scripts/ensure-material-kitting-agents.ts
node /app/scripts/ensure-quality-agents.ts
node /app/scripts/ensure-production-agents.ts

exec "$@"
