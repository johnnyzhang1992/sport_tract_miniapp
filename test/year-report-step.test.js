/**
 * 年度报告步数区：结构、按年取数、两卡片、最佳记录追加两条步数纪录。
 * 运行：node --test test/year-report-step.test.js。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('YR-S1 结构：微信步数汇总、独立月度步数卡、最佳记录复用', () => {
  const w = read('miniprogram/pages/year-report/year-report.wxml');
  assert.match(w, /class="section-title">微信步数/);
  assert.match(w, /总步数/);
  assert.match(w, /日均步数/);
  assert.match(w, /同步天数/);
  assert.match(w, /月度步数/);
  assert.match(w, /unit="step"/);
  assert.match(w, /wx:if="\{\{item.id\}\}"> ›/, '步数纪录没有轨迹可跳，不显示箭头');
  const js = read('miniprogram/pages/year-report/year-report.js');
  assert.match(js, /\/werun\/report/);
  assert.match(js, /buildStepRecords/);
});

/* ------------------------------- 桩 ------------------------------- */

const apiPath = require.resolve('../miniprogram/services/api.js');
const calls = [];
let stepReport = null;
const overview = {
  count: 1,
  totalDistanceKm: 5,
  totalDurationSec: 1800,
  totalCalories: 300,
  totalElevationGain: 50,
  tracks: [{
    id: 't1', type: 'running', startTime: new Date(2026, 8, 29, 8).getTime(),
    distance: 5000, duration: 1800, fastestKm: 300, elevationGain: 50,
  }],
};
require.cache[apiPath] = {
  id: apiPath, filename: apiPath, loaded: true,
  exports: {
    get(p) {
      calls.push(p);
      if (p.indexOf('/werun/report') === 0) return Promise.resolve(stepReport);
      if (p.indexOf('/overview') === 0) return Promise.resolve(overview);
      if (p.indexOf('/stats/year-milestones') === 0) return Promise.resolve(null);
      return Promise.resolve(null);
    },
  },
  children: [], paths: [],
};
const loadingPath = require.resolve('../miniprogram/utils/loading.js');
require.cache[loadingPath] = {
  id: loadingPath, filename: loadingPath, loaded: true,
  exports: { show() {}, hide() {} }, children: [], paths: [],
};

global.wx = { showToast() {}, navigateTo() {} };
global.getApp = () => ({ globalData: { loggedIn: true, userInfo: {} }, hasSession: () => false });
let pageDef = null;
global.Page = (d) => { pageDef = d; };
require('../miniprogram/pages/year-report/year-report.js');

function boot() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.data.year = 2026;
  p.setData = (patch) => Object.assign(p.data, patch || {});
  return p;
}

/* ------------------------------- 用例 ------------------------------- */

test('YR-S2 年度取数：汇总 + 12 个月步数 + 两条步数纪录追加在最佳记录末尾', async () => {
  calls.length = 0;
  stepReport = {
    overview: { totalStep: 23000, avgStep: 4600, bestDate: '2026-02-10', bestStep: 12000, syncedDays: 5, days: 365 },
    months: Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, '0')}`,
      step: i === 1 ? 15000 : 0,
    })),
    bestMonth: { month: '2026-02', step: 15000 },
  };
  const p = boot();
  await p.fetch();

  // 期望值必须按**东八区**自然年算：原先用 new Date(2026,0,1) 是设备本地时区，
  // 在非 +8 设备上跑这条用例会红（正是本次修正的时区问题，2026-11-06）
  const from = Date.UTC(2026, 0, 1) - 8 * 3600000;
  const to = Date.UTC(2027, 0, 1) - 8 * 3600000;
  assert.ok(calls.includes(`/werun/report?from=${from}&to=${to}`), calls.join(','));

  assert.equal(p.data.step.hasData, true);
  assert.equal(p.data.step.totalText, '2.3万');
  assert.equal(p.data.step.avgText, '4,600');
  assert.equal(p.data.step.syncedDays, 5);
  assert.equal(p.data.stepChartData.length, 12);
  assert.equal(p.data.stepChartData[0].label, '1月');
  assert.equal(p.data.stepChartData[1].value, 15000);

  const stepRows = p.data.highlights.slice(-2);
  assert.deepEqual(stepRows.map((r) => r.label), ['最多步数日', '步数最多月份']);
  assert.equal(stepRows[0].value, '1.2万 步');
  assert.equal(stepRows[0].sub, '2026/02/10');
  assert.equal(stepRows[1].sub, '2026年2月');
  assert.equal(stepRows[0].id, '', '步数纪录没有轨迹可跳');
});

test('YR-S3 步数接口失败：年度报告主体与最佳记录照常', async () => {
  const realGet = require.cache[apiPath].exports.get;
  require.cache[apiPath].exports.get = (p) => (
    p.indexOf('/werun/report') === 0 ? Promise.reject(new Error('down')) : realGet(p)
  );
  try {
    const p = boot();
    await p.fetch();
    assert.equal(p.data.step.hasData, false);
    assert.ok(p.data.highlights.length >= 4, '运动相关最佳记录仍在');
    assert.ok(!p.data.highlights.some((r) => r.key.indexOf('step-') === 0));
  } finally {
    require.cache[apiPath].exports.get = realGet;
  }
});
