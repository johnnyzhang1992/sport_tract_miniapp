const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchBest } = require('../../miniprogram/utils/best-records');

/**
 * 个人最佳匹配（best-records）单测：
 * 口径与 API 端 /stats/best（保持者链 distancePbChain）对齐，场景与
 * sport_track_api/test/perf-crs-kind.test.ts 同源。
 */

const BEST = {
  maxDistanceByType: [{ type: 'running', id: 'a1', distance: 6571 }],
  minPaceByType: [{ type: 'running', id: 'other', fastestKm: 372.5 }],
  maxDurationByType: [{ type: 'running', id: 'a1', duration: 2726 }],
  maxElevationByType: [],
  fastestDistanceByKm: [{ type: 'running', km: 5, sec: 1480, id: 'a1' }],
  distancePbChain: [
    { type: 'running', km: 5, id: 'a1', sec: 1480, isCurrent: true, heldDays: 0 },
    { type: 'running', km: 5, id: 'a2', sec: 1502, isCurrent: false, heldDays: 12 },
  ],
};

const ACT = { type: 'running', distance: 6571, fastestKm: 372.5, duration: 2726, elevationGain: 0 };

test('当前保持者：命中多项（最远距离 + 最长时长 + 当前 5 公里 PB），保持中不显示文案', () => {
  const hits = matchBest({ ...ACT, id: 'a1', pbMarks: [{ km: 5, sec: 1480 }] }, BEST);
  assert.equal(hits.length, 3);
  assert.deepEqual(
    hits.map((h) => h.label),
    ['最远距离', '最长时长', '5 公里 PB'],
  );
  const pb = hits.find((h) => h.label === '5 公里 PB');
  assert.equal(pb.value, '24:40');
  assert.equal(pb.former, false);
  assert.equal(pb.heldText, '');
});

test('前纪录：命中链中已刷新项，former + 保持天数', () => {
  const hits = matchBest({ ...ACT, id: 'a2', pbMarks: [{ km: 5, sec: 1502 }] }, BEST);
  const pb = hits.find((h) => h.label === '5 公里 PB');
  assert.ok(pb);
  assert.equal(pb.former, true);
  assert.equal(pb.value, '25:02');
  assert.equal(pb.heldText, '保持12天');
});

test('降级：服务端无保持者链时退回 fastestDistanceByKm（全按当前纪录）', () => {
  const hits = matchBest({ ...ACT, id: 'a1', pbMarks: [{ km: 5, sec: 1480 }] }, {
    ...BEST,
    distancePbChain: undefined,
  });
  const pb = hits.find((h) => h.label === '5 公里 PB');
  assert.ok(pb && pb.former === false);
});

test('未命中 / 空数据边界', () => {
  assert.deepEqual(matchBest({ ...ACT, id: 'zzz', pbMarks: [] }, BEST), []);
  assert.deepEqual(matchBest({ ...ACT, id: 'a1', pbMarks: [] }, BEST).length, 2, '无 pbMarks 不产生距离 PB 命中');
  assert.deepEqual(matchBest({ ...ACT, id: 'a1' }, BEST).length, 2);
  assert.deepEqual(matchBest(null, BEST), []);
  assert.deepEqual(matchBest({ ...ACT, id: 'a1' }, null), []);
  assert.deepEqual(matchBest({ ...ACT, id: 'a1', pbMarks: [{ km: 5, sec: 1480 }] }, {}).length, 0);
});

test('最大爬升：有爬升才参与（0 爬升不命中）', () => {
  const best = { maxElevationByType: [{ type: 'hiking', id: 'h1', elevationGain: 326 }] };
  assert.equal(matchBest({ id: 'h1', type: 'hiking', distance: 0, fastestKm: 0, duration: 0, elevationGain: 326 }, best).length, 1);
  assert.equal(matchBest({ id: 'h1', type: 'hiking', distance: 0, fastestKm: 0, duration: 0, elevationGain: 0 }, best).length, 0);
});
