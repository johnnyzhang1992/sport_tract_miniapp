#!/bin/bash
# optimize-images.sh — 图片资源压缩与合规检查
#
# 背景：微信「代码质量」扫描有硬性规则「图片和音频资源大小应不超过 200 K」，
# 超了就是“未通过”。2026-11-17 首次触发时资源总量 245KB，手工压到 124KB。
# 之后新增图片若忘了压缩，很容易再次超标 —— 所以固化成脚本。
#
# 用法：
#   bash scripts/optimize-images.sh              # 压缩 + 检查（默认）
#   bash scripts/optimize-images.sh --check      # 只检查不压缩（CI / 提交前用）
#   bash scripts/optimize-images.sh --dry-run    # 看会省多少，不写文件
#
# 做什么：
#   PNG  → pngquant（有损量化，人眼不可辨），已是压缩过的会跳过（体积不变就不写回）
#   JPEG → 超过上限长度的自动降采样 + 质量 88 重存
#
# 不做的事（重要）：
#   不改图片尺寸。分辨率该多大由使用场景决定（如分享海报里的码按 44px 绘制，
#   132px 就够），脚本无法推断，看到超大图会**提示**而不是擅自缩小。
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMG_DIR="$ROOT/miniprogram"
LIMIT_KB=200

MODE="apply"
case "${1:-}" in
  --check) MODE="check" ;;
  --dry-run) MODE="dry" ;;
  "") ;;
  *) echo "未知参数：$1（可用 --check / --dry-run）"; exit 1 ;;
esac

command -v pngquant >/dev/null || {
  echo "缺少 pngquant，请先安装：brew install pngquant"
  exit 1
}

# 收集图片（排除 miniprogram_npm：那是构建产物，由 build-tdesign.sh 管）
# macOS 自带 bash 3.2 没有 mapfile（bash 4+ 才支持），用 while read 兼容
ALL=()
while IFS= read -r line; do ALL+=("$line"); done < <(find "$IMG_DIR" -type f \
  \( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" \) \
  -not -path "*/miniprogram_npm/*" | sort)

total_kb() { find "$IMG_DIR" -type f \( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" \) \
  -not -path "*/miniprogram_npm/*" -exec ls -l {} \; | awk '{s+=$5} END {printf "%d", s/1024}'; }

BEFORE=$(total_kb)
echo "图片目录：$IMG_DIR"
echo "当前总量：${BEFORE}KB / 上限 ${LIMIT_KB}KB（$( [ "$BEFORE" -le "$LIMIT_KB" ] && echo '✅ 通过' || echo '❌ 超标') ）"

if [ "$MODE" = "check" ]; then
  [ "$BEFORE" -le "$LIMIT_KB" ] || exit 1
  exit 0
fi

# ── PNG：pngquant 有损量化 ──────────────────────────────
PNG_SAVED=0
for f in "${ALL[@]}"; do
  case "$f" in *.png) ;; *) continue ;; esac
  old=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f")
  if [ "$MODE" = "apply" ]; then
    pngquant --quality=70-92 --force --skip-if-larger --output "$f" "$f" 2>/dev/null
    new=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f")
  else
    # dry-run：压到临时文件量一下，不覆盖原图
    tmp="${f%.png}.q.png"
    pngquant --quality=70-92 --force --skip-if-larger --output "$tmp" "$f" 2>/dev/null
    new=$( [ -f "$tmp" ] && stat -f%z "$tmp" 2>/dev/null || echo "$old" )
    rm -f "$tmp"
  fi
  [ "$new" -lt "$old" ] && PNG_SAVED=$((PNG_SAVED + old - new))
done

# ── JPEG：过大则重压（缩放需人工判断，这里只压质量） ──────
JPG_SAVED=0
for f in "${ALL[@]}"; do
  case "$f" in *.jpg|*.jpeg) ;; *) continue ;; esac
  old=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f")
  # 小于 15KB 的 jpg 收益太小，跳过
  [ "$old" -lt 15000 ] && continue
  if [ "$MODE" = "apply" ]; then
    python3 - "$f" <<'PY'
import sys
from PIL import Image
p = sys.argv[1]
im = Image.open(p).convert('RGB')
im.save(p, 'JPEG', quality=88, optimize=True, progressive=True)
PY
    new=$(stat -f%z "$f")
    [ "$new" -lt "$old" ] && JPG_SAVED=$((JPG_SAVED + old - new))
  fi
done

AFTER=$(total_kb)
echo "压缩完成：PNG 省 $((PNG_SAVED / 1024))KB，JPEG 省 $((JPG_SAVED / 1024))KB"
echo "现在总量：${AFTER}KB / 上限 ${LIMIT_KB}KB（$( [ "$AFTER" -le "$LIMIT_KB" ] && echo '✅ 通过' || echo '❌ 仍超标') ）"

# ── 提示：超大尺寸的图 ────────────────────────────────
# 脚本不擅自缩尺寸（分辨率由使用场景决定），但把明显的浪费点出来
python3 - "$IMG_DIR" <<'PY'
import os, sys, glob
from PIL import Image
root = sys.argv[1]
big = []
for p in glob.glob(root + '/**/*', recursive=True):
    if 'miniprogram_npm' in p or not p.lower().endswith(('.png','.jpg','.jpeg')): continue
    try: w, h = Image.open(p).size
    except Exception: continue
    # 超过 512px 边长的静态图，小程序里几乎用不到（除非是地图/海报底图）
    if max(w, h) > 512:
        big.append((max(w, h), p.replace(root + '/', ''), os.path.getsize(p) / 1024))
if big:
    print("\n提示：以下图片尺寸较大（脚本不会自动缩，请按实际使用场景判断）：")
    for side, name, kb in sorted(big, reverse=True):
        print(f"  {side:4d}px  {kb:6.1f}KB  {name}")
PY

[ "$AFTER" -le "$LIMIT_KB" ] || exit 1