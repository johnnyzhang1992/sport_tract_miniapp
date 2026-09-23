/**
 * 配速格式化回归（miniprogram/utils/format.js）
 *
 * 背景：单段明细/运动数据里的配速显示出现过 `10'60"`——原实现先 floor 取分、再 round 取秒，
 * 秒数落在 59.5~59.99 时会舍成 60 而不是进位到分。兄弟函数 track-pace.js#formatPaceShort
 * 一直是对的（有 59.6 → 1'00" 的用例），这里补齐同一口径。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatPace, formatPaceParts } = require('../miniprogram/utils/format');

test('秒数需进位到分：不得出现 10\'60"', () => {
  assert.equal(formatPace(659.6), `11'00" /公里`);
  assert.equal(formatPaceParts(659.6).value, `11'00"`);
  assert.equal(formatPace(59.6), `1'00" /公里`);
  assert.equal(formatPaceParts(3599.6).value, `60'00"`);
});

test('常规与边界值不变', () => {
  assert.equal(formatPace(300), `5'00" /公里`);
  assert.equal(formatPaceParts(333.33).value, `5'33"`);
  assert.equal(formatPaceParts(333.33).unit, '/公里');
  assert.equal(formatPace(0), '—');
  assert.equal(formatPaceParts(0), null);
  assert.equal(formatPaceParts(null), null);
});
