/**
 * 报告页步数展示纯函数：概况四项、月趋势标签、两条纪录。
 * 运行：node --test test/step-report-view.test.js。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildStepSummary,
  buildStepMonths,
  buildStepRecords,
  monthCn,
} = require('../miniprogram/utils/step-report-view.js');

const REPORT = {
  overview: {
    totalStep: 23000,
    avgStep: 4600,
    bestDate: '2026-02-10',
    bestStep: 12000,
    syncedDays: 5,
    days: 62,
  },
  months: [
    { month: '2026-01', step: 8000 },
    { month: '2026-02', step: 12000 },
  ],
  bestMonth: { month: '2026-02', step: 12000 },
};

test('SRV-1 概况：总/日均/最多步数日（完整日期）/同步天数', () => {
  assert.deepEqual(buildStepSummary(REPORT.overview), {
    hasData: true,
    totalText: '2.3万',
    avgText: '4,600',
    bestText: '1.2万',
    bestDateText: '2026/02/10',
    syncedDays: 5,
  });
});

test('SRV-2 无记录：hasData=false，最多步数日给占位且无日期', () => {
  assert.deepEqual(buildStepSummary({ totalStep: 0, avgStep: 0, bestStep: 0, bestDate: '', syncedDays: 0 }), {
    hasData: false,
    totalText: '0',
    avgText: '0',
    bestText: '—',
    bestDateText: '',
    syncedDays: 0,
  });
  assert.equal(buildStepSummary(null).hasData, false);
});

test('SRV-3 月趋势：年度短标签 vs 跨年完整标签、留位不同', () => {
  assert.deepEqual(buildStepMonths(REPORT.months, 'short'), {
    data: [
      { label: '1月', value: 8000 },
      { label: '2月', value: 12000 },
    ],
    labelSlot: 28,
  });
  assert.deepEqual(buildStepMonths(REPORT.months, 'full'), {
    data: [
      { label: '2026/01', value: 8000 },
      { label: '2026/02', value: 12000 },
    ],
    labelSlot: 36,
  });
  assert.deepEqual(buildStepMonths(null, 'short'), { data: [], labelSlot: 28 });
});

test('SRV-4 两条纪录：文案、完整日期/中文月份、复用现有图标', () => {
  const records = buildStepRecords(REPORT);
  assert.deepEqual(records, [
    {
      key: 'step-day',
      label: '最多步数日',
      value: '1.2万 步',
      sub: '2026/02/10',
      icon: '/assets/icons/lucide-footprints.png',
    },
    {
      key: 'step-month',
      label: '步数最多月份',
      value: '1.2万 步',
      sub: '2026年2月',
      icon: '/assets/icons/lucide-calendar-blue.png',
    },
  ]);
  assert.equal(monthCn('2026-02'), '2026年2月');
});

test('SRV-5 无同步记录时不给纪录卡', () => {
  assert.deepEqual(buildStepRecords(null), []);
  assert.deepEqual(buildStepRecords({ overview: { syncedDays: 0 } }), []);
  assert.deepEqual(buildStepRecords({ overview: { syncedDays: 0, bestStep: 0 }, bestMonth: null }), []);
});
