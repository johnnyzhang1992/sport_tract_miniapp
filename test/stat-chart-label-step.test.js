/**
 * stat-chart 的 X 轴标签抽稀规则（累计趋势图 / 海拔曲线 / 体重曲线桶数变多时的排字口径）。
 *
 * 只测纯函数 labelStep / labelIndices：绘制本身要 canvas，
 * 「画出来压不压字」由模拟器实测（verify-campaign-trend-long.png）。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let compDef = null;
global.Component = (def) => {
  compDef = def;
};
global.wx = {
  createSelectorQuery: () => ({ in: () => ({ select: () => ({ fields: () => ({ exec: () => {} }) }) }) }),
  getWindowInfo: () => ({ pixelRatio: 2 }),
};
require('../miniprogram/components/stat-chart/stat-chart.js');

const methods = compDef.methods;

/** 一个标签占位（10px 字号的「MM/DD」约 26px + 呼吸）与首格贴边多吃的半格 */
const SLOT = 28;
/** 一年活动的绘图区实测宽（模拟器 390 屏，卡内 canvas 342px 扣掉 Y 轴与右留白） */
const W = 296;

function minGap(indices) {
  let g = Infinity;
  for (let i = 1; i < indices.length; i++) g = Math.min(g, indices[i] - indices[i - 1]);
  return g;
}

test('SC1 labelStep：按像素留位，不是按个数写死', () => {
  // 步长 = ceil(1.5 个标签位 / 每格像素宽)，1.5 倍是因为首格左对齐、末格右对齐，各多吃半格
  assert.equal(methods.labelStep(7, W), 1, '一周活动 7 桶：每格 49px，全画');
  assert.equal(methods.labelStep(8, W), 1, '8 桶每格 42px 刚好够，仍全画');
  assert.equal(methods.labelStep(9, W), 2, '9 桶每格 37px → 隔一个画一个');
  assert.equal(methods.labelStep(53, W), 8, '一年 53 个周桶 → 步长 8');
  assert.equal(methods.labelStep(53, 148), 15, '绘图区只有一半宽（窄屏/小卡）→ 步长几乎翻倍');
});

test('SC2 labelStep：拿不到宽度时退回「最多 8 个」，不炸也不硬画', () => {
  assert.equal(methods.labelStep(53, 0), 7, 'chartW 缺失 → ceil(53/8)');
  assert.equal(methods.labelStep(53), 7, '压根没传');
  assert.equal(methods.labelStep(7, 0), 1);
  assert.equal(methods.labelStep(1, W), 1, '单桶不可能是 0 步长');
  assert.equal(methods.labelStep(-5, W), 1, '负数不能算出 0 或负步长');
  assert.equal(methods.labelStep('abc', W), 1);
});

test('SC3 labelIndices：首尾恒画（首格左对齐贴左缘、末格右对齐贴右缘并压住末点数值）', () => {
  for (const n of [2, 8, 12, 13, 31, 53, 100]) {
    const idx = methods.labelIndices(n, W);
    assert.equal(idx[0], 0, `n=${n} 首格必须画`);
    assert.equal(idx[idx.length - 1], n - 1, `n=${n} 末格必须画且排在最后`);
  }
  assert.deepEqual(methods.labelIndices(7, W), [0, 1, 2, 3, 4, 5, 6], '不抽稀时按原序全画');
  assert.deepEqual(methods.labelIndices(0, W), [], '空桶没有标签');
  assert.deepEqual(methods.labelIndices(undefined, W), []);
  assert.deepEqual(methods.labelIndices(-5, W), []);
});

test('SC4 labelIndices：相邻间距恒 ≥ 1.5 个标签位——这条治的就是首格贴边挤字', () => {
  // 上一版只按个数封顶（≤8 个），一年 53 桶算出步长 7：
  // 首格左对齐占掉 0–26px，第二格中心落在 7×5.7=39.8px、自身占 26.8–52.8px → 两格只差 0.8px，
  // 模拟器截图里就是「10-1812-06」糊成一串。所以留位必须按像素算，且按最严的首格算。
  for (const n of [9, 12, 13, 17, 25, 31, 40, 53, 60, 100, 366]) {
    const idx = methods.labelIndices(n, W);
    const seg = W / (n - 1);
    const gapPx = minGap(idx) * seg;
    assert.ok(
      gapPx >= SLOT * 1.5 - 1e-6,
      `n=${n} 最小间距只有 ${gapPx.toFixed(1)}px，应 ≥ ${(SLOT * 1.5).toFixed(0)}px：${JSON.stringify(idx)}`,
    );
  }
});

test('SC5 labelIndices：末格会把离它太近的那一格挤掉，不会自己叠自己', () => {
  const d = methods.labelIndices(53, W);
  assert.equal(d[d.length - 1], 52);
  assert.ok(52 - d[d.length - 2] >= methods.labelStep(53, W), '末格与前一格至少隔一个步长');
  assert.ok(!d.includes(48), '步长 8 时 48 会被末格 52 挤掉（52−48=4 < 8）');
  assert.equal(d[d.length - 2], 40, '挤掉后末格前一个是 40');
});

test('SC6 三条绘制路径（柱 / 单系列折线 / 多系列折线）共用同一套抽稀，写死口径不能复活', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../miniprogram/components/stat-chart/stat-chart.js'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // 海拔曲线 / 体重曲线点数常上百，旧规则「>12 每 3 画一个」比趋势图更容易压字；
  // 柱状图月视图也踩过——末格右对齐，前一格只隔 4 个槽位，截图里就是「10-19 10-23」贴在一起
  assert.ok(!/i % 3/.test(src), '不能再出现写死的「每 3 个画一个」');
  assert.ok(!/n <= 12/.test(src), '不能再出现写死的「≤12 全画」');
  assert.ok(!/maxLabels/.test(src), '柱状图那份独立的「上限 7 个」要并进来，别留第二套口径');
  assert.equal((src.match(/this\.labelIndices\(/g) || []).length, 3, '三条绘制路径各调一次');
  // 漏传宽度不会报错——它会安静退回「按个数封顶」，把刚修的像素留位悄悄降级，所以要在源码上钉住
  assert.equal(
    (src.match(/this\.labelIndices\([^)]*,\s*axis\.chartW\)/g) || []).length,
    3,
    '三条路径都要把绘图区宽度传进来（漏一个就静默走兜底）',
  );
});
