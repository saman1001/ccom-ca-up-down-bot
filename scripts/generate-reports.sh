#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

for env_file in .env.cro-usd .env.btc-usd; do
  if [[ -f "$env_file" ]]; then
    ENV_FILE="$env_file" node src/report.js
  fi
done
