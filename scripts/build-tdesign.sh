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

# 裁剪运行时用不到的东西（2026-11-17，依据开发者工具「代码依赖分析」报告逐项核实）：
#   1. .d.ts 类型声明 —— 小程序运行时不读（≈52KB）
#   2. common/shared 下 calendar/color-picker/qrcode —— 项目未用这些组件（≈33KB）
#   3. 各组件下的 index.js + type.js —— 命令式 API 入口（dialog.confirm() 这类），
#      项目全用声明式 <t-dialog>/<t-popup>，组件自身 js/json 均不引用它们（≈104KB）
#
# ⚠️ 不要删 badge/image/loading/overlay/sticky：UI 里虽没直接写 t-badge 等，
#    但被 avatar/cell/button/popup/tabs **间接依赖**，删了组件编译报错。
# ⚠️ 也不要删 marked/dayjs/tinycolor2：它们是 tdesign 声明的依赖，删了可能影响
#    未来重建（当前虽无引用，但体积由依赖完整性保证，避免升级组件库时踩坑）。
find "$DST" -name "*.d.ts" -delete
find "$DST/tdesign-miniprogram" -mindepth 2 -maxdepth 2 \( -name "index.js" -o -name "type.js" \) -delete
rm -rf "$DST/tdesign-miniprogram/common/shared/calendar" \
       "$DST/tdesign-miniprogram/common/shared/color-picker" \
       "$DST/tdesign-miniprogram/common/shared/qrcode"

echo "✅ tdesign 按需构建完成：$(du -sh "$DST" | cut -f1)"

# 裁剪 tdesign 图标样式：删除 icon.wxss 中未使用的图标类（112KB → ~0.8KB）
node "$ROOT/scripts/tree-shake-icons.mjs"
