#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

mapfile -t env_files < <(find . -maxdepth 1 -type f -name '.env.*' ! -name '.env.web' ! -name '*.backup*' -printf '%f\n' | sort)

for env_file in "${env_files[@]}"; do
  if [[ -f "$env_file" ]]; then
    ENV_FILE="$env_file" node src/report.js
    ENV_FILE="$env_file" node src/taxExport.js
  fi
done
