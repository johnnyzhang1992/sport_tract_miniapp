#!/bin/bash
# 按需重建 tdesign miniprogram_npm（clone 后 / 依赖更新后运行一次）
# 只保留用到的组件 + common/mixins 公共目录 + 被引用的 npm 依赖（tslib 等），避免全量 5MB 打包
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/node_modules/tdesign-miniprogram/miniprogram_dist"
DST="$ROOT/miniprogram/miniprogram_npm"

if [ ! -d "$SRC" ]; then
  echo "未找到 $SRC，请先 npm install"
  exit 1
fi

# 用到的组件（含间接依赖：badge/image/loading/overlay/sticky）
COMPONENTS="avatar badge button cell cell-group dialog icon image loading overlay popup sticky swipe-cell switch tab-panel tabs tag"
# 公共目录：所有组件 js 里 `from "../xxx"` 引用的共享代码（common=公共工具，mixins=混入）
SHARED="common mixins"
# tdesign 内部 npm 依赖（组件 import 'tslib' 等，需提升到 miniprogram_npm 根）
DEPS="tslib dayjs tinycolor2 marked"

rm -rf "$DST"
mkdir -p "$DST/tdesign-miniprogram"

for c in $COMPONENTS $SHARED; do
  if [ -d "$SRC/$c" ]; then
    cp -r "$SRC/$c" "$DST/tdesign-miniprogram/$c"
  fi
done

for d in $DEPS; do
  if [ -d "$SRC/miniprogram_npm/$d" ]; then
    cp -r "$SRC/miniprogram_npm/$d" "$DST/$d"
  fi
done

echo "✅ tdesign 按需构建完成：$(du -sh "$DST" | cut -f1)"
