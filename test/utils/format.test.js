const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatDuration, formatKm, formatPace, formatPaceParts, compact, formatDurationStat } = require('../../miniprogram/utils/format');

test('formatDuration：时分秒进位与兜底', () => {
  assert.equal(formatDuration(2726), '45:26');
  assert.equal(formatDuration(3661), '1:01:01');
  assert.equal(formatDuration(0), '00:00');
  assert.equal(formatDuration(-5), '00:00');
  assert.equal(formatDuration(undefined), '00:00');
  assert.equal(formatDuration(59.6), '01:00', '秒四舍五入进位');
});

test('formatKm / compact', () => {
  assert.equal(formatKm(6571), '6.57');
  assert.equal(compact(999), '999');
  assert.equal(compact(1234), '1.23K');
  assert.equal(compact(1000), '1K', '去尾零');
  assert.equal(compact(23456), '2.35W');
  assert.equal(compact(10000), '1W');
});

test('formatDurationStat：分钟/小时/天三档', () => {
  assert.deepEqual(formatDurationStat(3600), { num: '60', unit: '分钟' });
  assert.deepEqual(formatDurationStat(3600 * 100), { num: '100', unit: '小时' });
  assert.deepEqual(formatDurationStat(3600 * 600), { num: '600', unit: '小时' });
  assert.deepEqual(formatDurationStat(3600 * 1000), { num: '41.7', unit: '天' });
});

test('formatPace / formatPaceParts：负零值兜底与进位', () => {
  assert.equal(formatPace(450), "7'30\" /公里");
  assert.equal(formatPace(0), '—');
  assert.equal(formatPace(-5), '—');
  assert.equal(formatPace(372.5), "6'13\" /公里", '372.5s → 373s → 6\'13"');
  assert.deepEqual(formatPaceParts(372.5), { value: "6'13\"", unit: '/公里' });
  assert.equal(formatPaceParts(0), null);
});
