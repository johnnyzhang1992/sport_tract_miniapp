/**
 * 海拔曲线口径（utils/track-altitude.js）单测。
 * 这条规则同时决定「轨迹线是否按海拔着色」与「详情页是否出现海拔曲线卡片」，
 * 所以收在一个纯函数里测，页面侧只负责接线。
 * 运行：npm test；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ALTITUDE_TYPES, buildAltitudeChart } = require('../miniprogram/utils/track-altitude.js');

/** n 个带海拔的点（altitude 从 base 递增） */
function ptsWithAlt(n, base = 100) {
  return Array.from({ length: n }, (_, i) => ({ lat: 30 + i * 1e-4, lng: 120, altitude: base + i }));
}

test('TA1 只有徒步/爬山出海拔曲线：其余类型即使有海拔也不出', () => {
  assert.deepEqual(ALTITUDE_TYPES, ['hiking', 'mountaineering'], '白名单就是这两类');

  for (const type of ALTITUDE_TYPES) {
    const out = buildAltitudeChart(ptsWithAlt(5), type);
    assert.equal(out.length, 5, `${type} 应出曲线`);
    assert.deepEqual(out[0], { label: '0', value: 100 });
    assert.equal(out[4].value, 104, 'value 就是海拔原值');
  }

  for (const type of ['running', 'walking', 'cycling', 'swimming']) {
    assert.deepEqual(buildAltitudeChart(ptsWithAlt(5), type), [], `${type} 不该出海拔曲线（GPS 逐点海拔噪声大）`);
  }
});

test('TA2 徒步但没采到海拔：不出曲线（空数组，wxml 的 length>1 自然拦掉）', () => {
  assert.deepEqual(buildAltitudeChart([], 'hiking'), []);
  assert.deepEqual(buildAltitudeChart([{ altitude: null }, { altitude: null }], 'hiking'), []);
  assert.deepEqual(buildAltitudeChart(undefined, 'hiking'), []);
  assert.deepEqual(buildAltitudeChart([{ altitude: 120 }], 'hiking').length, 1, '单点仍返回（是否画线交给 wxml 的 length>1）');
});

test('TA3 抽稀上限 60 点：按「有效海拔点」计数，且保序', () => {
  const out = buildAltitudeChart(ptsWithAlt(600), 'hiking');
  assert.ok(out.length <= 60 && out.length >= 50, `600 点应抽到 60 上下，实得 ${out.length}`);
  assert.deepEqual(out[0], { label: '0', value: 100 }, '首点保留');
  assert.equal(out[1].value, 110, 'step=10 时取第 11 个有效点');
  const vals = out.map((p) => p.value);
  assert.deepEqual(vals, vals.slice().sort((a, b) => a - b), '顺序不被抽稀打乱');

  assert.equal(buildAltitudeChart(ptsWithAlt(60), 'hiking').length, 60, '刚好 60 点不抽');
});

test('TA4 抽稀按「过滤后」的长度算：中间夹着的空海拔点不占名额', () => {
  const mixed = [];
  for (let i = 0; i < 120; i++) mixed.push({ altitude: i % 2 === 0 ? 200 + i : null });
  const out = buildAltitudeChart(mixed, 'mountaineering');
  assert.equal(out.length, 60, '60 个有效点（step=1）全保留');
  assert.equal(out[0].value, 200);
  assert.equal(out[59].value, 318, '第 60 个有效点是 i=118');
});

test('TA5 类型缺失/为空串：按「不是徒步也不是爬山」处理', () => {
  assert.deepEqual(buildAltitudeChart(ptsWithAlt(5), undefined), []);
  assert.deepEqual(buildAltitudeChart(ptsWithAlt(5), ''), []);
  assert.deepEqual(buildAltitudeChart(ptsWithAlt(5), 'HIKING'), [], '大小写不匹配即不放行');
});
