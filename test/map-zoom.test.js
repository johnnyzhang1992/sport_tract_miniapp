/**
 * 点亮地图缩放工具（packageFootprint/utils/map-zoom.js）单测：
 * 读当前 zoom × 系数一次 setOption 落地、夹到 [0.5, 8]、chart 未就绪/残缺时安全返回 null。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { zoomChart, ZOOM_FACTOR, MIN_ZOOM, MAX_ZOOM } = require(path.join(
  __dirname,
  '../miniprogram/packageFootprint/utils/map-zoom.js'
));

/** chart 桩：setOption 里回写 zoom，模拟 echarts 的 getOption/setOption 往返 */
function makeChart(zoom) {
  return {
    zoom,
    calls: [],
    getOption() {
      return { series: [{ zoom: this.zoom }] };
    },
    setOption(o) {
      this.calls.push(o);
      this.zoom = o.series[0].zoom;
    },
  };
}

test('Z1 常量：系数 1.3，边界 0.5–8', () => {
  assert.equal(ZOOM_FACTOR, 1.3);
  assert.equal(MIN_ZOOM, 0.5);
  assert.equal(MAX_ZOOM, 8);
});

test('Z2 缩放按当前值算：+ 放大到 1.3，− 从 1.3 缩回 1（不是回退到固定值）', () => {
  const chart = makeChart(1);
  assert.equal(zoomChart(chart, ZOOM_FACTOR), 1.3);
  assert.deepEqual(chart.calls, [{ series: [{ zoom: 1.3 }] }], '一次 setOption 更新 series.zoom');
  assert.equal(zoomChart(chart, 1 / ZOOM_FACTOR), 1);
  assert.equal(zoomChart(chart, ZOOM_FACTOR), 1.3);
});

test('Z3 上下限夹取：连续放大停在 8，连续缩小停在 0.5', () => {
  const chart = makeChart(1);
  for (let i = 0; i < 20; i++) zoomChart(chart, ZOOM_FACTOR);
  assert.equal(chart.zoom, MAX_ZOOM);
  for (let i = 0; i < 40; i++) zoomChart(chart, 1 / ZOOM_FACTOR);
  assert.equal(chart.zoom, MIN_ZOOM);
});

test('Z4 chart 未就绪或残缺：不抛错、返回 null（首屏响应先于 onReady 时点按钮不炸）', () => {
  assert.equal(zoomChart(null, ZOOM_FACTOR), null);
  assert.equal(zoomChart(undefined, ZOOM_FACTOR), null);
  assert.equal(zoomChart({}, ZOOM_FACTOR), null);
  assert.equal(zoomChart({ setOption() {} }, ZOOM_FACTOR), null, '缺 getOption');
  assert.equal(zoomChart({ getOption() { return {}; } }, ZOOM_FACTOR), null, '缺 setOption');
});

test('Z5 zoom 缺失时按 1 起算（getMapOption 不带 zoom，没缩过就是默认 1）', () => {
  const chart = { getOption: () => ({ series: [{}] }), setOption(o) { this.applied = o.series[0].zoom; } };
  assert.equal(zoomChart(chart, ZOOM_FACTOR), 1.3);
  assert.equal(chart.applied, 1.3);
});
