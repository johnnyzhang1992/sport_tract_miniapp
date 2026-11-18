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
#   JPEG → 质量 88 + progressive 重存；体积没变小就不写回
#
# **幂等**（2026-11-18 修）：两个分支都靠 scripts/.images-optimized 记账（相对路径 → sha256）。
#   文件内容没变就跳过，不会出现「跑两次 = 二次有损压缩」。换图后 hash 变化 → 自动重新压。
#
# 判定口径：微信「代码质量」那条规则按**图片总量**卡（不是单文件），所以这里比对 $LIMIT_KB。
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

# 收集图片（排除 miniprogram_npm：那是构建产物，由 build-tdesign.sh 管）
# macOS 自带 bash 3.2 没有 mapfile（bash 4+ 才支持），用 while read 兼容
ALL=()
while IFS= read -r line; do ALL+=("$line"); done < <(find "$IMG_DIR" -type f \
  \( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" \) \
  -not -path "*/miniprogram_npm/*" | sort)

total_kb() { find "$IMG_DIR" -type f \( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" \) \
  -not -path "*/miniprogram_npm/*" -exec ls -l {} \; | awk '{s+=$5} END {printf "%d", s/1024}'; }

MANIFEST="$ROOT/scripts/.images-optimized"
touch "$MANIFEST"

# 记一笔「这版文件已经压过」（相对路径 → sha256）；内容没变就跳过，避免二次有损压缩
mark_optimized() { # $1=相对路径 $2=sha256
  # 先过滤到临时文件、**再把新记录并进去**，最后整体覆盖。
  # （踩过：先 >> 原文件再 mv 临时文件过去，追加的那行会被覆盖掉 → manifest 永远是空的）
  {
    grep -v -F "$1"$'\t' "$MANIFEST" 2>/dev/null || true
    printf '%s\t%s\n' "$1" "$2"
  } > "$MANIFEST.tmp"
  mv "$MANIFEST.tmp" "$MANIFEST"
}
already_optimized() { # $1=相对路径 $2=当前 sha256
  [ "$(grep -F "$1"$'\t' "$MANIFEST" 2>/dev/null | head -1 | cut -f2)" = "$2" ]
}
sha_of() { shasum -a 256 "$1" | awk '{print $1}'; }

BEFORE=$(total_kb)
echo "图片目录：$IMG_DIR"
echo "当前总量：${BEFORE}KB / 上限 ${LIMIT_KB}KB（$( [ "$BEFORE" -le "$LIMIT_KB" ] && echo '✅ 通过' || echo '❌ 超标') ）"

if [ "$MODE" = "check" ]; then
  [ "$BEFORE" -le "$LIMIT_KB" ] || exit 1
  exit 0
fi

# ── PNG：pngquant 有损量化 ──────────────────────────────
command -v pngquant >/dev/null || {
  echo "缺少 pngquant，请先安装：brew install pngquant"
  exit 1
}

PNG_SAVED=0
for f in "${ALL[@]}"; do
  case "$f" in *.png) ;; *) continue ;; esac
  old=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f")
  rel="${f#$IMG_DIR/}"
  h=$(sha_of "$f")
  if [ "$MODE" = "apply" ] && already_optimized "$rel" "$h"; then continue; fi
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
  [ "$MODE" = "apply" ] && mark_optimized "$rel" "$(sha_of "$f")"
done

# ── JPEG：过大则重压（缩放需人工判断，这里只压质量） ──────
#
# 2026-11-18 修三处：
#   1. 先写临时文件、**只有更小才覆盖**（原来无条件 im.save()，体积可能反而变大）
#   2. 压过就记账（manifest），复跑不再二次有损编码
#   3. 保留透明通道：有 alpha 时存 PNG 语义行不通（jpg 不支持 alpha），这里显式转白底
#      而不是让 convert('RGB') 把透明区变黑；同时按 EXIF 方向摆正，避免压完躺倒
JPG_SAVED=0
for f in "${ALL[@]}"; do
  case "$f" in *.jpg|*.jpeg) ;; *) continue ;; esac
  old=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f")
  rel="${f#$IMG_DIR/}"
  h=$(sha_of "$f")
  # 小于 15KB 的 jpg 收益太小，跳过（但仍记账，免得每次来问一遍）
  if [ "$old" -lt 15000 ]; then
    [ "$MODE" = "apply" ] && mark_optimized "$rel" "$h"
    continue
  fi
  [ "$MODE" = "apply" ] && already_optimized "$rel" "$h" && continue
  if [ "$MODE" = "apply" ]; then
    tmp="${f%.*}.tmp.jpg"
    python3 - "$f" "$tmp" <<'PY'
import sys
from PIL import Image, ImageOps
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src)
im = ImageOps.exif_transpose(im)          # 按 EXIF 方向摆正（否则重存后可能歪 90°）
if im.mode in ('RGBA', 'LA', 'P'):
    im = im.convert('RGBA')
    bg = Image.new('RGB', im.size, (255, 255, 255))   # 透明区铺白，避免变黑
    bg.paste(im, mask=im.split()[-1])
    im = bg
else:
    im = im.convert('RGB')
im.save(dst, 'JPEG', quality=88, optimize=True, progressive=True)
PY
    new=$(stat -f%z "$tmp" 2>/dev/null || echo "$old")
    if [ "$new" -lt "$old" ]; then
      mv "$tmp" "$f"
      JPG_SAVED=$((JPG_SAVED + old - new))
    else
      rm -f "$tmp"
    fi
    mark_optimized "$rel" "$(sha_of "$f")"
  else
    tmp="${f%.*}.dry.jpg"
    python3 - "$f" "$tmp" 2>/dev/null <<'PY'
import sys
from PIL import Image, ImageOps
src, dst = sys.argv[1], sys.argv[2]
im = ImageOps.exif_transpose(Image.open(src)).convert('RGB')
im.save(dst, 'JPEG', quality=88, optimize=True, progressive=True)
PY
    new=$( [ -f "$tmp" ] && stat -f%z "$tmp" 2>/dev/null || echo "$old" )
    rm -f "$tmp"
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