const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calcPerfScore, perfLevel } = require('../../miniprogram/utils/perf-score');

/**
 * 表现分单测：公式/常量与服务端 sport_track_api/src/utils/perf-score.ts 同源
 * （TrailCraft commit5 refit），锚点场景与 API 端 test/perf-crs-kind.test.ts 对齐。
 */

test('TrailCraft 平地锚点回归：92km/186m 爬升/12.75h → 361 中等', () => {
  const r = calcPerfScore('running', 92000, 186, 12.75 * 3600);
  assert.ok(r);
  assert.ok(Math.abs(r.score - 361) <= 2, `应 ~361，实际 ${r.score}`);
  assert.equal(r.level, '中等');
});

test('UTMB 级：精英级且远离 1000 封顶', () => {
  const r = calcPerfScore('running', 174000, 10000, 19.32 * 3600);
  assert.ok(r);
  assert.equal(r.level, '精英级');
  assert.ok(r.score > 680 && r.score < 850);
});

test('真实轨迹：6.57km/0 爬升/45:26 → 275 中等', () => {
  assert.deepEqual(calcPerfScore('running', 6571, 0, 2726), { score: 275, level: '中等' });
});

test('不适用类型与数据不足', () => {
  assert.equal(calcPerfScore('cycling', 50000, 500, 3600), null);
  assert.equal(calcPerfScore('swimming', 3000, 0, 3600), null);
  assert.equal(calcPerfScore('running', 800, 10, 600), null);
  assert.equal(calcPerfScore('running', 5000, 50, 120), null);
  assert.equal(calcPerfScore('running', 0, 0, 0), null);
});

test('等级线边界（680/500/380/200）', () => {
  assert.equal(perfLevel(1000), '精英级');
  assert.equal(perfLevel(680), '精英级');
  assert.equal(perfLevel(679), '优秀');
  assert.equal(perfLevel(500), '优秀');
  assert.equal(perfLevel(499), '良好');
  assert.equal(perfLevel(380), '良好');
  assert.equal(perfLevel(379), '中等');
  assert.equal(perfLevel(200), '中等');
  assert.equal(perfLevel(199), '入门');
  assert.equal(perfLevel(0), '入门');
});
