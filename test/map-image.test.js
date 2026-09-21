/**
 * 地图导出模块（packageFootprint/utils/map-image.js）单测：
 * 足迹页分享与统计页分享图共用这一段导出逻辑，重点验：
 * ① 组件未就绪直接 reject（不触碰 canvas）；② 带统计行时白底 + 地图下移 + 原生 ctx 画标题；
 * ③ canvasToTempFilePath 必须按整 buffer（物理像素）传尺寸（真机不传会被裁剪）；
 * ④ 截完恢复透明背景与原布局。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { exportChartImage } = require('../miniprogram/packageFootprint/utils/map-image.js');

let exportCalls = [];
global.wx = {
  getWindowInfo: () => ({ pixelRatio: 2 }),
  canvasToTempFilePath: (o) => {
    exportCalls.push(o);
    if (o.success) o.success({ tempFilePath: 'wxfile://tmp/map.png' });
    if (o.complete) o.complete();
  },
};

/** 假 ec-canvas 组件：node（2d canvas）+ chart（可断言 setOption/flush） */
function makeComp() {
  const calls = { setOption: [], flush: 0, fillText: [] };
  const ctx = {
    setTransform() {},
    set font(v) {},
    set fillStyle(v) {},
    set textAlign(v) {},
    set textBaseline(v) {},
    fillText: (text, x, y) => calls.fillText.push({ text, x, y }),
  };
  const node = { width: 780, height: 1560, getContext: () => ctx };
  const chart = {
    setOption: (o) => calls.setOption.push(o),
    getZr: () => ({ flush: () => { calls.flush++; } }),
  };
  return { comp: { canvasNode: node, chart }, node, calls };
}

function resetEnv() {
  exportCalls = [];
}

test('M1 组件未就绪：reject「地图尚未就绪」且不触碰 canvas', async () => {
  resetEnv();
  await assert.rejects(() => exportChartImage(null), /地图尚未就绪/);
  await assert.rejects(() => exportChartImage({}), /地图尚未就绪/);
  await assert.rejects(() => exportChartImage({ chart: {} }), /地图尚未就绪/);
  assert.equal(exportCalls.length, 0, '未就绪时不应发起导出');
});

test('M2 带统计行：白底 + 地图下移 + 画标题 + 整 buffer 导出 + 恢复原布局', async () => {
  resetEnv();
  const { comp, node, calls } = makeComp();
  const opts = {
    statsText: '2026年9月 · 足迹 12 · 省份 8 · 城市 10',
    layoutCenter: ['50%', '62%'],
    layoutSize: '96%',
    restoreLayout: { layoutCenter: ['50%', '52%'], layoutSize: '108%' },
  };
  const p = exportChartImage(comp, opts);
  assert.equal(calls.setOption.length, 1, '同步先铺白底并下移地图');
  assert.deepEqual(calls.setOption[0], {
    backgroundColor: '#ffffff',
    animation: false,
    series: [{ layoutCenter: ['50%', '62%'], layoutSize: '96%' }],
  });
  assert.equal(calls.flush, 1, 'setOption 走 zrender 异步 rAF，必须 flush 一帧');
  assert.equal(calls.fillText.length, 1);
  assert.equal(calls.fillText[0].text, opts.statsText);
  assert.equal(calls.fillText[0].x, node.width / 2, '标题画在画布水平居中');
  assert.equal(calls.fillText[0].y, 14 * 2, '顶部留白按 dpr 折算（物理像素）');

  const path0 = await p;
  assert.equal(path0, 'wxfile://tmp/map.png');
  assert.equal(exportCalls.length, 1);
  const o = exportCalls[0];
  assert.deepEqual(
    { x: o.x, y: o.y, width: o.width, height: o.height, destWidth: o.destWidth, destHeight: o.destHeight, fileType: o.fileType },
    { x: 0, y: 0, width: 780, height: 1560, destWidth: 780, destHeight: 1560, fileType: 'png' },
    '显式按整 buffer 导出（不传尺寸真机可能按逻辑尺寸截取 → 裁剪）',
  );
  assert.equal(o.canvas, node);
  assert.equal(calls.setOption.length, 2, '截完恢复');
  assert.deepEqual(calls.setOption[1], {
    backgroundColor: 'transparent',
    animation: true,
    series: [opts.restoreLayout],
  });
  assert.equal(calls.flush, 2);
});

test('M3 不带统计行（省份图）：只铺白底与恢复透明，不画标题、不动作布局', async () => {
  resetEnv();
  const { comp, calls } = makeComp();
  await exportChartImage(comp);
  assert.deepEqual(calls.setOption[0], { backgroundColor: '#ffffff', animation: false });
  assert.equal(calls.fillText.length, 0, '没有统计行就不画标题');
  assert.deepEqual(calls.setOption[1], { backgroundColor: 'transparent', animation: true });
  assert.equal(exportCalls.length, 1);
});
