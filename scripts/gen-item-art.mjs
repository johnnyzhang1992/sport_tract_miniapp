#!/usr/bin/env node
/**
 * gen-item-art.mjs — 积分商城「道具图」（商品卡头图）
 *
 * 为什么用脚本画而不是 AI 生图：道具图要求①色值与小程序一致 ②边缘像素级锐利 ③无水印，
 * 这三项生图都不稳定（实测两版：一版卡片占满画布、一版边缘发虚且中心色偏到 #6d9df3）。
 * 这里把卡片当矢量画，出图仍走本机 Chrome 无头截图（与 gen-category-icons.mjs 同一招），不引新依赖。
 *
 * 用法：
 *   node scripts/gen-item-art.mjs                     # 生成全部道具图
 *   node scripts/gen-item-art.mjs --only=makeup-card  # 只出一张
 *   node scripts/gen-item-art.mjs --w=1792 --h=1024   # 换画布尺寸（默认 16:9）
 *
 * 产物：miniprogram/assets/items/<key>.png —— **透明底**，只画那张道具卡；
 *   商品卡的浅灰底板是页面 CSS 的事，不烧进图里（否则换深色模式/换底色就得重出图）。
 * 文案：ITEMS.label 给了就把字烧进图里（跟着卡片一起倾斜），留空则只出干净的卡，
 *   「补打卡」等文案由端上叠文本节点（改字不用重出图）。两种都留着，看效果挑。
 */
import { writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'miniprogram', 'assets', 'items');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const arg = (name, dflt) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || dflt;
const W = Number(arg('w', 1024));
const H = Number(arg('h', 576));
const ONLY = arg('only', '');

/**
 * 线性字形取自 lucide-static v1.61.0（ISC）：
 *   curl -sL https://unpkg.com/lucide-static@1.61.0/icons/<name>.svg
 * 换图标时把 path 抄进来即可（24×24 viewBox、stroke 描边、fill=none）。
 * accent 是单独上暖色的一笔（补签的「勾」＝把那天补上，用七格 makeup 态的暖金系）。
 */
const GLYPHS = {
  'calendar-check': {
    paths: [
      'M8 2v3',
      'M16 2v3',
      'M3 3h18a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
      'M3 9h18',
    ],
    accent: 'm9 15 2 2 4-4',
  },
};

/** 暖金：七格 makeup 态描边是 #8a5f12（浅底），蓝底上要提亮一档才看得见；
 *  压暗一档后对卡面蓝约 2.2:1（装饰性描线，不按正文文字的 4.5:1 要求） */
const ACCENT = '#f0b64f';

/**
 * 道具规格：一条 = 一张商品图。
 * tilt 让卡片别正着摆（正摆＋直角＝生硬）；gloss 是斜向高光带的角度与浓度；
 * sheen 是顶部高光（压到 .10 以下，否则右上角会从品牌蓝抬到 #5387f4 那种发白）。
 */
const ITEMS = {
  'makeup-card': {
    glyph: 'calendar-check',
    from: '#2465e8',
    to: '#306ef4',
    tilt: -4.5,
    gloss: -22,
    glossAlpha: 0.045,
    sheenAlpha: 0.1,
    iconScale: 0.56,
    iconAlpha: 0.38,
    iconInset: 0.015, // 图标贴右边缘的内缩量（占卡宽比例）
    label: '补打卡', // 留空＝不烧字，交给端上叠文本节点
    labelRatio: 0.24, // 字号占卡高比例
    labelInset: 0.09, // 文案左边距（占卡宽比例）
    labelAlpha: 0.72, // 纯白压在卡面上太扎眼，让卡蓝透出来一点
    shadow: false, // 只出卡片本身：投影在透明底上会糊成一圈深色描边，反而脏
  },
};

const AR = 2.1; // 卡面 2.1:1，比画布更扁
// 画布只留必要的余量：把卡放大到「旋转后的外接框（＋投影）」正好铺满画布，
// 导出图里就没有大片透明边（商品卡容器给多大，卡就显示多大）。
const SHADOW_PAD = { x: 24, top: 16, bottom: 56 }; // feDropShadow dy=18 + 约 2.5σ 的可见扩散
const EDGE_PAD = 1; // 不投影时只留 1px 给抗锯齿，别把卡边裁缺

/** 由画布尺寸反推卡片尺寸（倾斜后外接框要正好塞进画布） */
function cardSize(spec) {
  const pad = spec.shadow === false ? { x: EDGE_PAD, top: EDGE_PAD, bottom: EDGE_PAD } : SHADOW_PAD;
  const rad = (Math.abs(spec.tilt) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cw = Math.round(
    Math.min((W - pad.x * 2) / (cos + sin / AR), (H - pad.top - pad.bottom) / (sin + cos / AR)),
  );
  return { cw, ch: Math.round(cw / AR) };
}

function svgFor(spec) {
  const { cw, ch } = cardSize(spec);
  const r = Math.round(ch * 0.2);
  const g = GLYPHS[spec.glyph];
  const paths = g.paths.map((d) => `<path d="${d}"/>`).join('');
  const iconSize = Math.round(ch * spec.iconScale);
  const iconK = iconSize / 24;
  // 画面靠右：图标贴着卡的右边缘，左半留给「补打卡」文案（由端上叠字）
  const iconX = cw - iconSize - Math.round(cw * spec.iconInset);
  const iconY = Math.round((ch - iconSize) / 2);
  const uid = spec.glyph.replace(/[^a-z]/g, '');
  const lift = spec.shadow === false ? '' : ` filter="url(#lift-${uid})"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="face-${uid}" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="${spec.from}"/>
      <stop offset="1" stop-color="${spec.to}"/>
    </linearGradient>
    <linearGradient id="sheen-${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="${spec.sheenAlpha}"/>
      <stop offset=".55" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="shade-${uid}" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#0d2a6b" stop-opacity=".22"/>
      <stop offset=".5" stop-color="#0d2a6b" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="gloss-${uid}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/>
      <stop offset=".5" stop-color="#fff" stop-opacity="${spec.glossAlpha}"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="clip-${uid}"><rect x="0" y="0" width="${cw}" height="${ch}" rx="${r}"/></clipPath>
    <filter id="lift-${uid}" x="-25%" y="-25%" width="150%" height="170%">
      <feDropShadow dx="0" dy="18" stdDeviation="14" flood-color="#16224a" flood-opacity=".26"/>
    </filter>
  </defs>
  <g transform="translate(${W / 2} ${H / 2}) rotate(${spec.tilt}) translate(${-cw / 2} ${-ch / 2})"${lift}>
    <rect x="0" y="0" width="${cw}" height="${ch}" rx="${r}" fill="url(#face-${uid})"/>
    <g clip-path="url(#clip-${uid})">
      <rect x="0" y="0" width="${cw}" height="${ch}" fill="url(#sheen-${uid})"/>
      <rect x="0" y="0" width="${cw}" height="${ch}" fill="url(#shade-${uid})"/>
      <g transform="translate(${cw / 2} ${ch / 2}) rotate(${spec.gloss}) translate(${-cw} ${-ch * 0.4})">
        <rect x="0" y="0" width="${cw * 2}" height="${ch * 0.8}" fill="url(#gloss-${uid})"/>
      </g>
      <g transform="translate(${iconX} ${iconY}) scale(${iconK})" fill="none" stroke="#fff" stroke-opacity="${spec.iconAlpha}" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round">
        ${paths}
        <path d="${g.accent}" stroke="${ACCENT}" stroke-opacity="1" stroke-width="1.6"/>
      </g>
      ${
        spec.label
          ? `<text x="${Math.round(cw * spec.labelInset)}" y="${ch / 2}" fill="#fff" fill-opacity="${spec.labelAlpha ?? 1}" font-family="PingFang SC, Hiragino Sans GB, sans-serif" font-size="${Math.round(ch * spec.labelRatio)}" font-weight="600" letter-spacing="${Math.round(ch * spec.labelRatio * 0.06)}" dominant-baseline="central">${spec.label}</text>`
          : ''
      }
    </g>
  </g>
</svg>`;
}

const work = mkdtempSync(join(tmpdir(), 'item-art-'));
mkdirSync(OUT_DIR, { recursive: true });
for (const [key, spec] of Object.entries(ITEMS)) {
  if (ONLY && ONLY !== key) continue;
  const htmlPath = join(work, `${key}.html`);
  writeFileSync(htmlPath, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0}svg{display:block}</style>${svgFor(spec)}`);
  const out = join(OUT_DIR, `${key}.png`);
  // --default-background-color=00000000 → 出透明底（和 gen-category-icons.mjs 同一招）
  execFileSync(CHROME, ['--headless', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000', `--window-size=${W},${H}`, `--screenshot=${out}`, `file://${htmlPath}`], { stdio: 'pipe' });
  if (!existsSync(out)) throw new Error(`Chrome 没出图：${out}`);
  console.log(`✓ ${key}.png  画布 ${W}×${H} / 卡片 ${cardSize(spec).cw}×${cardSize(spec).ch}  倾斜 ${spec.tilt}°  文案「${spec.label || '（不烧字）'}」`);
}
