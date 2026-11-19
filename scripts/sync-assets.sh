#!/usr/bin/env bash
# 把前端产物同步到安卓工程的 assets 目录
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/web/dist"
DST="$ROOT/ds-app/app/src/main/assets/www"

if [ ! -f "$SRC/index.html" ]; then
  echo "未找到 $SRC/index.html，请先运行 scripts/build-web.sh" >&2
  exit 1
fi

rm -rf "$DST"
mkdir -p "$(dirname "$DST")"
cp -r "$SRC" "$DST"
echo "==> 已同步到 $DST（$(find "$DST" -type f | wc -l) 个文件）"
