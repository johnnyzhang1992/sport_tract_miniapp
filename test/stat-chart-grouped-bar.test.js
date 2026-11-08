/**
 * stat-chart grouped-bar（2026-11-08 运营趋势三系列分组柱）：
 * 布局纯函数 + 0 基线刻度 + 绘制分发。绘制用 mock ctx 取证（柱数/颜色/不越界）。
 * 运行：node --test test/stat-chart-grouped-bar.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let compDef = null;
global.Component = (def) => { compDef = def; };
global.wx = {
  createSelectorQuery: () => ({ in: () => ({ select: () => ({ fields: () => ({ exec: () => {} }) }) }) }),
  getWindowInfo: () => ({ pixelRatio: 2 }),
};
require('../miniprogram/components/stat-chart/stat-chart.js');
const methods = compDef.methods;

test('SCG1 groupedBarLayout：每桶 s 根柱、互不重叠、不越绘图区右缘', () => {
  for (const [n, s, W] of [[7, 3, 296], [30, 3, 296], [26, 3, 296], [5, 3, 148]]) {
    const rects = methods.groupedBarLayout(n, s, W);
    assert.equal(rects.length, n * s);
    assert.ok(rects.every((r) => r.w > 0), '柱宽必须为正');
    for (let i = 1; i < rects.length; i++) {
      assert.ok(rects[i].x >= rects[i - 1].x + rects[i - 1].w - 1e-9, `第 ${i} 根不压前一根`);
    }
    const last = rects[rects.length - 1];
    assert.ok(last.x + last.w <= W + 1e-9, '末柱不出右缘');
    assert.ok(rects[0].x >= 0);
  }
});

test('SCG2 grouped-bar 刻度 0 基线（计数可加量，同 step 口径）', () => {
  const fake = { data: { type: 'grouped-bar' } };
  assert.deepEqual(methods.axisLabels.call(fake, [3, 10]), [10, 8, 5, 3, 0], '计数刻度取整');
});

test('SCG3 drawGroupedBar：柱数=n×s、颜色按系列循环、高度按全局 max 归一', () => {
  const rects = [];
  const colors = [];
  const ctx = {
    font: '', textAlign: '', textBaseline: '', fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1,
    measureText: () => ({ width: 10 }),
    fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, clearRect() {}, scale() {}, fill() {},
    rect() {}, roundRect() {},
    fillRect(x, y, w, h) { rects.push({ x, y, w, h }); colors.push(this.fillStyle); },
  };
  const series = [
    { name: '新增用户', color: '#2b6cf6', values: [1, 0] },
    { name: '登录UV', color: '#7fa8f9', values: [2, 0] },
    { name: '登录PV', color: '#b6cff8', values: [4, 0] },
  ];
  const fake = Object.assign({}, methods, {
    data: { height: 220, type: 'grouped-bar', labelSlot: 28 },
  });
  methods.drawGroupedBar.call(fake, ctx, series, ['11/1', '11/2'], 342);
  assert.equal(rects.length, 6, '2 桶 × 3 系列');
  assert.deepEqual(colors.slice(0, 3), ['#2b6cf6', '#7fa8f9', '#b6cff8'], '颜色按系列顺序');
  const maxH = Math.max(...rects.map((r) => r.h));
  const pvFirst = rects[2];
  assert.equal(pvFirst.h, maxH, '全局最大值（PV=4）柱最高');
  assert.ok(rects.every((r) => r.y + r.h <= 220 - 26 + 1e-9), '柱底落在 X 标签区上缘');
});

test('SCG4 renderChart 分发：grouped-bar 全零 → hasData=false 不画', () => {
  let painted = null;
  const fake = {
    data: { type: 'grouped-bar', series: [{ name: 'a', color: '#111111', values: [0, 0] }], labels: ['x', 'y'], height: 200 },
    setData(p) { Object.assign(this.data, p); painted = p; },
  };
  methods.renderChart.call(fake);
  assert.equal(fake.data.hasData, false);
  assert.equal(painted.hasData, false);
});