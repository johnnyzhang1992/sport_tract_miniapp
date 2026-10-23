const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatDuration, formatKm, formatPace, formatPaceParts, formatDurationStat, formatThousands, formatCompactCn } = require('../../miniprogram/utils/format');

test('formatDuration：时分秒进位与兜底', () => {
  assert.equal(formatDuration(2726), '45:26');
  assert.equal(formatDuration(3661), '1:01:01');
  assert.equal(formatDuration(0), '00:00');
  assert.equal(formatDuration(-5), '00:00');
  assert.equal(formatDuration(undefined), '00:00');
  assert.equal(formatDuration(59.6), '01:00', '秒四舍五入进位');
});

test('formatKm', () => {
  assert.equal(formatKm(6571), '6.57');
});

test('formatCompactCn：万/亿与千分位，不再出现 K/W', () => {
  assert.equal(formatCompactCn(999), '999');
  assert.equal(formatCompactCn(1000), '1,000');
  assert.equal(formatCompactCn(5472), '5,472');
  assert.equal(formatCompactCn(9999), '9,999');
  assert.equal(formatCompactCn(10000), '1万');
  assert.equal(formatCompactCn(16982), '1.7万');
  assert.equal(formatCompactCn(123456), '12.3万');
  assert.equal(formatCompactCn(100000000), '1亿');
  assert.equal(formatCompactCn(1500.25), '1,500.25');
  assert.equal(formatCompactCn(0.65), '0.65');
  assert.equal(formatCompactCn(null), '0');
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

test('formatThousands：千分位分组', () => {
  assert.equal(formatThousands(0), '0');
  assert.equal(formatThousands(999), '999');
  assert.equal(formatThousands(5472), '5,472');
  assert.equal(formatThousands(16982), '16,982');
  assert.equal(formatThousands(null), '0');
  assert.equal(formatThousands(1234567), '1,234,567');
});
