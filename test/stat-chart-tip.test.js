/**
 * stat-chart 点柱看数（2026-11-08，showTip 开关默认关）：
 * 命中纯函数 + 气泡收边 + tap 分发 + 气泡绘制取证。
 * 运行：node --test test/stat-chart-tip.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let compDef = null;
global.Component = (def) => { compDef = def; };
global.wx = {
  createSelectorQuery: () => ({
    in: () => ({
      select: () => ({
        fields: () => ({ exec: () => {} }),
        boundingClientRect: (cb) => ({ exec: () => cb({ left: 10 }) }),
      }),
    }),
  }),
  getWindowInfo: () => ({ pixelRatio: 2 }),
};
require('../miniprogram/components/stat-chart/stat-chart.js');
const methods = compDef.methods;

test('TIP1 hitSlotIndex：绘图区内按桶宽取整；区外/空桶 null', () => {
  const padLeft = 34;
  const chartW = 296;
  const n = 7;
  const slotW = chartW / n;
  assert.equal(methods.hitSlotIndex(padLeft + slotW * 1.2, padLeft, chartW, n), 1);
  assert.equal(methods.hitSlotIndex(padLeft, padLeft, chartW, n), 0);
  assert.equal(methods.hitSlotIndex(padLeft + chartW - 0.01, padLeft, chartW, n), 6);
  assert.equal(methods.hitSlotIndex(padLeft - 1, padLeft, chartW, n), null);
  assert.equal(methods.hitSlotIndex(padLeft + chartW + 1, padLeft, chartW, n), null);
  assert.equal(methods.hitSlotIndex(padLeft + 10, padLeft, chartW, 0), null);
});

test('TIP2 clampTipX：居中优先，左右收边不越界', () => {
  assert.equal(methods.clampTipX(171, 120, 342), 111);
  assert.equal(methods.clampTipX(10, 120, 342), 4);
  assert.equal(methods.clampTipX(340, 120, 342), 218);
});

test('TIP3 tipValue：≥1万用万、以下千分位（中文数字口径）', () => {
  assert.equal(methods.tipValue(4), '4');
  assert.equal(methods.tipValue(4284), '4,284');
  assert.equal(methods.tipValue(17355), '1.7万');
  assert.equal(methods.tipValue(0), '0');
});

test('TIP4 onChartTap：showTip 关不响应；开则命中/再点收起', () => {
  let rendered = 0;
  const fake = Object.assign({}, methods, {
    data: { showTip: true },
    _layout: { padLeft: 34, chartW: 296, n: 7 },
    _tipIndex: null,
    renderChart: () => { rendered += 1; },
  });
  const x = 10 + 34 + (296 / 7) * 2.5;
  methods.onChartTap.call(fake, { detail: { x } });
  assert.equal(fake._tipIndex, 2);
  assert.equal(rendered, 1);
  methods.onChartTap.call(fake, { detail: { x } });
  assert.equal(fake._tipIndex, null, '再点同一桶收起');
  assert.equal(rendered, 2);

  rendered = 0;
  fake.data.showTip = false;
  methods.onChartTap.call(fake, { detail: { x } });
  assert.equal(rendered, 0, '开关关闭不重画');
});

test('TIP5 数据变化清掉旧 tip（observer 重置）', () => {
  const fake = { _tipIndex: 3, renderChart: () => {} };
  compDef.observers['data, type, series, labels'].call(fake);
  assert.equal(fake._tipIndex, null);
});

test('TIP6 drawGroupedBar 带 tip：画选中底纹 + 气泡含标签与三系列值', () => {
  const texts = [];
  const rects = [];
  const ctx = {
    font: '', textAlign: '', textBaseline: '', fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1,
    measureText: (t) => ({ width: String(t).length * 6 }),
    fillText: (t) => texts.push(String(t)),
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, clearRect() {}, scale() {}, fill() {},
    rect() {}, roundRect() {},
    fillRect(x, y, w, h) { rects.push({ x, y, w, h, style: this.fillStyle }); },
  };
  const series = [
    { name: '新增用户', color: '#2b6cf6', values: [1, 0] },
    { name: '登录UV', color: '#7fa8f9', values: [2, 0] },
    { name: '登录PV', color: '#b6cff8', values: [4, 0] },
  ];
  const fake = Object.assign({}, methods, {
    data: { height: 220, type: 'grouped-bar', labelSlot: 28, unit: '' },
    _tipIndex: 0,
  });
  methods.drawGroupedBar.call(fake, ctx, series, ['11/1', '11/2'], 342);
  assert.ok(texts.includes('11/1'), '气泡含桶标签');
  assert.ok(texts.includes('新增用户 1'), texts.join('|'));
  assert.ok(texts.includes('登录UV 2'));
  assert.ok(texts.includes('登录PV 4'));
  assert.ok(rects.some((r) => r.style === 'rgba(43,108,246,0.06)' && r.h > 100), '选中桶底纹');
});