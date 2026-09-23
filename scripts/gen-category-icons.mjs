#!/usr/bin/env node
/**
 * gen-category-icons.mjs — 生成 lucide 字形的小程序 PNG（足迹分类图标 + 浮层按钮字形 + 运动类型图标）
 *
 * 为什么要脚本：地图 marker 的 iconPath 只吃打进包里的静态图片（运行时离屏 canvas 画 Path2D
 * 在微信侧没验证过），而 lucide 官方只发 SVG，所以这里做一次「拉 SVG → 包白圆底 → 光栅化 PNG」，
 * 产物提交进 assets/icons，脚本本身也留着（改配色/加分类时重跑）。
 *
 * 光栅化用本机 Google Chrome 无头截图（--default-background-color=00000000 出透明底），
 * 不引新依赖。试过 macOS 自带 qlmanage，它会把 SVG 内容缩到画布左上角，出图不可控。
 *
 * 用法：
 *   node scripts/gen-category-icons.mjs            # 生成全部
 *   node scripts/gen-category-icons.mjs --size=128 # 换出图尺寸
 *
 * 产物：
 *   fp-cat-<key>.png       透明底黑字形（表单 chips、列表/详情标签用，底色交给 CSS）
 *   fp-cat-<key>-chip.png  白圆底黑字形（地图 marker iconPath 用）
 *   lucide-<name>.png      浮层按钮字形（PLAIN 组，含 -red 等配色变体）
 *   activity-<type>.png    运动类型图标（ACTIVITY 组，144px，见 config.ACTIVITY_TYPES）
 *   tab-<name>-<灰|蓝>.png tabBar 图标（TAB 组，81px，色值跟 app.json 的 color/selectedColor）
 */
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'miniprogram', 'assets', 'icons');
const SIZE = Number((process.argv.find((a) => a.startsWith('--size=')) || '').split('=')[1] || 96);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const STROKE = '#1f2329'; // 与页面主文字色一致
const LUCIDE = 'https://cdn.jsdelivr.net/npm/lucide-static@latest/icons';

/** 分类 key → lucide 图标名（与 API src/utils/footprint-category.ts 的 key 一一对应） */
const CATEGORIES = {
  scenic: 'ticket',
  mountain: 'mountain-snow',
  park: 'tree-pine',
  heritage: 'castle',
  museum: 'landmark',
  street: 'store',
  food: 'coffee',
  camp: 'tent',
  other: 'circle-dot',
};

/** 地图页浮层按钮用的字形（黑色透明底，按钮白底由 CSS 给；search 覆盖掉早期的灰版资产） */
const PLAIN = ['sliders-horizontal', 'plus', 'search', 'layers', 'pencil', 'trash-2', 'map-pinned', 'building-2'];
/** 逐字形的额外内缩（CSS px，SIZE=96 口径）：lucide 各家字形在 24 网格里占位不同，
 *  统一 inset 0 会让「占格多的」在按钮里明显大一号。实测墨迹宽：sliders/justify 80px、plus 64px，
 *  layers 的菱形盘、pencil 的斜杆都跨 22 格 → 满幅出到 88px，故各内缩 4.5 拉回 80px 与同排一致
 *  （building-2 同理，跨 22 格 → 内缩 4） */
const PLAIN_INSET = { layers: 4.5, pencil: 4.5, 'building-2': 4, 'map-pinned': 4.5 };
/** 图标不带文字时颜色是唯一的语义载体：删除走危险红，出文件名加 -red 后缀（同仓里 *-blue/-white 的变体命名） */
const PLAIN_STROKE = { 'trash-2': { color: '#e54d42', suffix: '-red' } };

/** 运动类型图标（config/index.js 的 ACTIVITY_TYPES[].iconImg）：144px 画布，与既有 activity-*.png 同尺寸。
 *  inset 逐字形给：这一族老资产的墨迹从 54% 到 100% 都有（本来就没校准过），拿「跑步 96px」当基准，
 *  lucide mountain 的盘跨 20 网格 → inset 14 出到约 97px，与同排齐 */
const ACTIVITY = [
  // strokeWidth 2.7：lucide 原生 2 在 48rpx 渲染下只有 ~1.6 CSS px，用户要求线条再粗一点
  { out: 'activity-mountaineering', icon: 'mountain', inset: 14, size: 144, strokeWidth: 2.7 },
];

/** tabBar 图标（app.json 的 iconPath / selectedIconPath）：81px 画布与同排三个 tab 图标同尺寸，
 *  两版颜色就是 app.json 的 color(#999999) / selectedColor(#2b6cf6)；
 *  同排墨迹实测 67~69px（我的 55px），故按 ink 目标算 inset，别用满幅 */
const TAB = [
  { out: 'tab-footprint-gray', icon: 'footprints', color: '#999999', inset: 0, size: 81 },
  { out: 'tab-footprint-blue', icon: 'footprints', color: '#2b6cf6', inset: 0, size: 81 },
];

/** 取 <svg> 的内部标记：lucide 的文件是 width/height/viewBox 固定的 24 网格图标 */
async function lucideInner(name) {
  const res = await fetch(`${LUCIDE}/${name}.svg`);
  if (!res.ok) throw new Error(`拉取 ${name}.svg 失败：HTTP ${res.status}（${LUCIDE}/${name}.svg）`);
  const svg = await res.text();
  // 文件头有一行 <!-- @license --> 注释，注释里就带 ">"：锚点必须从 <svg 之后找，
  // 否则截出来的片段会含一个没闭合的 <svg> 开标签，WebKit 渲染时顶部会多出错误提示条
  const open = svg.indexOf('<svg');
  const inner = svg.slice(svg.indexOf('>', open) + 1, svg.lastIndexOf('</svg>')).replace(/<!--[\s\S]*?-->/g, '');
  if (!inner.trim()) throw new Error(`${name}.svg 解析不到内部标记，检查一下文件结构`);
  return inner;
}

/** 24 网格字形 → SIZE 画布：scale 让字形占满 inset 留白后的区域，描边按同比例缩放 */
function compose(inner, size, inset, withCircle, stroke, strokeWidth) {
  const scale = (size - inset * 2) / 24;
  const circle = withCircle
    ? `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1}" fill="#ffffff" stroke="rgba(31,35,41,.10)" stroke-width="1"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${circle}<g transform="translate(${inset},${inset}) scale(${scale.toFixed(4)})" fill="none" stroke="${stroke || STROKE}" stroke-width="${strokeWidth || 2}" stroke-linecap="round" stroke-linejoin="round">${inner}</g></svg>`;
}

const work = mkdtempSync(join(tmpdir(), 'fp-icons-'));

/** SVG 包进零边距 HTML，Chrome 无头按 window-size 精确出图（透明底） */
function rasterize(svgPath, outPng, size) {
  const htmlPath = `${svgPath}.html`;
  writeFileSync(htmlPath, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0}svg{display:block}</style>${readFileSync(svgPath, 'utf8')}`);
  execFileSync(
    CHROME,
    ['--headless', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000', `--window-size=${size},${size}`, `--screenshot=${outPng}`, `file://${htmlPath}`],
    { stdio: 'pipe' },
  );
  if (!existsSync(outPng)) throw new Error(`Chrome 没出图：${outPng}`);
}

function emit(name, inner, inset, withCircle, stroke, size = SIZE, strokeWidth) {
  const svgPath = join(work, `${name}.svg`);
  writeFileSync(svgPath, compose(inner, size, inset, withCircle, stroke, strokeWidth));
  emitFromSvg(name, svgPath, size);
}

function emitFromSvg(name, svgPath, size) {
  const out = join(OUT_DIR, `${name}.png`);
  rasterize(svgPath, out, size);
  console.log(`✓ ${name}.png`);
}

for (const [key, icon] of Object.entries(CATEGORIES)) {
  const inner = await lucideInner(icon);
  emit(`fp-cat-${key}`, inner, SIZE * 0.18, false);
  emit(`fp-cat-${key}-chip`, inner, SIZE * 0.26, true);
}
for (const icon of PLAIN) {
  // inset 0 = 字形铺满画布：与既有的 lucide-text-align-justify 等老资产同一口径
  // （实测老资产墨迹占宽 83%、描边 8px；用 0.14 内缩出来的只有 5.8px，混在一排按钮里明显偏细偏小）
  const tint = PLAIN_STROKE[icon];
  emit(`lucide-${icon}${tint ? tint.suffix : ''}`, await lucideInner(icon), PLAIN_INSET[icon] || 0, false, tint && tint.color);
}
for (const a of ACTIVITY) {
  emit(a.out, await lucideInner(a.icon), a.inset, false, a.stroke, a.size, a.strokeWidth);
}
for (const t of TAB) {
  emit(t.out, await lucideInner(t.icon), t.inset, false, t.color, t.size, t.strokeWidth);
}
console.log(`\n共 ${Object.keys(CATEGORIES).length * 2 + PLAIN.length} 张，尺寸 ${SIZE}px → ${OUT_DIR}`);
console.log('注意：白圆底那组是给地图 marker 用的，字形留白比透明底那组大，视觉重量才和 24px 参考图一致。');
