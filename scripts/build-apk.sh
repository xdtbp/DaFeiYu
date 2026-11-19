#!/usr/bin/env bash
# 构建 debug APK：构建前端 -> 同步资源 -> gradle 打包
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash "$ROOT/scripts/build-web.sh"
bash "$ROOT/scripts/sync-assets.sh"

if [ -z "${ANDROID_HOME:-}" ]; then
  echo "请先设置 ANDROID_HOME 指向 Android SDK" >&2
  exit 1
fi

cd "$ROOT/ds-app"
./gradlew assembleDebug

echo "==> 产物：ds-app/app/build/outputs/apk/debug/app-debug.apk"
