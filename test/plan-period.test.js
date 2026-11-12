/**
 * 周计划概况卡标题：日期范围 + 本期第几天。
 * 运行：npm test（node --test 自动发现）。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { formatPeriodTitle } = require('../miniprogram/utils/plan-period.js');

const DAY = 86_400_000;
// 东八区 2026-11-12 00:00 ~ 11-19 00:00
const START = Date.UTC(2026, 10, 12, 0) - 8 * 3600_000;
const END = START + 7 * DAY;

test('PPT1 第一天：日期范围 + 第 1/7 天', () => {
  assert.equal(formatPeriodTitle(START, END, START + 10 * 3600_000), '11.12–11.18（第 1/7 天）');
});

test('PPT2 中间天数按东八区整天推进', () => {
  assert.equal(formatPeriodTitle(START, END, START + 2 * DAY), '11.12–11.18（第 3/7 天）');
  assert.equal(formatPeriodTitle(START, END, START + 6 * DAY + 23 * 3600_000), '11.12–11.18（第 7/7 天）');
});

test('PPT3 天数夹在 [1, 7]，越界不出现 0 或 8', () => {
  assert.equal(formatPeriodTitle(START, END, START - DAY), '11.12–11.18（第 1/7 天）');
  assert.equal(formatPeriodTitle(START, END, END + DAY), '11.12–11.18（第 7/7 天）');
});

test('PPT4 缺窗口数据时回落「本期」', () => {
  assert.equal(formatPeriodTitle(0, END), '本期');
  assert.equal(formatPeriodTitle(START, 0), '本期');
});
