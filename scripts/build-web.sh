#!/usr/bin/env bash
# 构建前端产物（web/dist）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/web"

if [ ! -d node_modules ]; then
  echo "==> 安装依赖"
  corepack pnpm install
fi

echo "==> 构建前端"
# 直接调用 rspack，避免 Windows cmd 下 NODE_ENV= 前缀不生效
NODE_ENV=production node node_modules/@rspack/cli/bin/rspack.js build -c rspack.config.ts

echo "==> 完成：web/dist"
