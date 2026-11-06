/**
 * 运动报告页步数区：结构 + 按周期取数 + 周/月不画月趋势。
 * 桩：api / login-gate / loading 就地注入；页面真实 fetch 与纯函数参与断言。
 * 运行：node --test test/report-step.test.js。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('RP-S1 结构：微信步数卡、四项概况、月度步数图', () => {
  const w = read('miniprogram/pages/report/report.wxml');
  assert.match(w, /class="section-title">微信步数/);
  assert.match(w, /总步数/);
  assert.match(w, /日均步数/);
  assert.match(w, /最多步数日/);
  assert.match(w, /同步天数/);
  assert.match(w, /月度步数/);
  assert.match(w, /unit="step"/);
  assert.match(w, /wx:if="\{\{step && step.hasData\}\}"/);
});

/* ------------------------------- 桩 ------------------------------- */

let apiCalls = [];
let stepReport = null;
const fakeApi = {
  get(p) {
    apiCalls.push(p);
    if (p.indexOf('/werun/report') === 0) return Promise.resolve(stepReport);
    if (p.indexOf('/overview') === 0) {
      return Promise.resolve({ count: 1, tracks: [], dateSummary: { title: '按天', label: '日期', rows: [] } });
    }
    return Promise.resolve(null);
  },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const loginPath = require.resolve('../miniprogram/utils/login-gate.js');
require.cache[loginPath] = {
  id: loginPath, filename: loginPath, loaded: true,
  exports: { ensureLogin: async () => true }, children: [], paths: [],
};
const loadingPath = require.resolve('../miniprogram/utils/loading.js');
require.cache[loadingPath] = {
  id: loadingPath, filename: loadingPath, loaded: true,
  exports: { show() {}, hide() {} }, children: [], paths: [],
};

global.wx = { showToast() {}, nextTick: (cb) => cb(), switchTab() {}, navigateTo() {} };
global.getApp = () => ({
  globalData: { loggedIn: true, userInfo: {} },
  hasSession: () => false,
});
let pageDef = null;
global.Page = (d) => { pageDef = d; };
require('../miniprogram/pages/report/report.js');

function boot(activeRange, from, to) {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.data.activeRange = activeRange;
  p._period = activeRange === 'all' ? null : { from, to };
  p.setData = (patch) => Object.assign(p.data, patch || {});
  return p;
}

/* ------------------------------- 用例 ------------------------------- */

const FROM = Date.UTC(2026, 0, 1) - 8 * 3600000;
const TO = Date.UTC(2027, 0, 1) - 8 * 3600000;

test('RP-S2 年维度：按周期取步数，四项概况 + 12 个月短标签趋势', async () => {
  apiCalls = [];
  stepReport = {
    overview: { totalStep: 23000, avgStep: 4600, bestDate: '2026-02-10', bestStep: 12000, syncedDays: 5, days: 365 },
    months: [
      { month: '2026-01', step: 8000 },
      { month: '2026-02', step: 15000 },
    ],
    bestMonth: { month: '2026-02', step: 15000 },
  };
  const p = boot('year', FROM, TO);
  await p.fetch();
  assert.ok(apiCalls.includes(`/werun/report?from=${FROM}&to=${TO}`), apiCalls.join(','));
  assert.equal(p.data.step.totalText, '2.3万');
  assert.equal(p.data.step.avgText, '4,600');
  assert.equal(p.data.step.bestText, '1.2万');
  assert.equal(p.data.step.bestDateText, '2026/02/10');
  assert.equal(p.data.showStepChart, true);
  assert.deepEqual(p.data.stepChartData, [
    { label: '1月', value: 8000 },
    { label: '2月', value: 15000 },
  ]);
});

test('RP-S3 周/月维度：不画月趋势（只有 1 根柱）；全部维度用跨年标签', async () => {
  stepReport = {
    overview: { totalStep: 1000, avgStep: 1000, bestDate: '2026-11-01', bestStep: 1000, syncedDays: 1, days: 7 },
    months: [{ month: '2026-11', step: 1000 }],
    bestMonth: { month: '2026-11', step: 1000 },
  };
  const week = boot('week', FROM, FROM + 7 * 86400000);
  await week.fetch();
  assert.equal(week.data.showStepChart, false);

  const month = boot('month', FROM, TO);
  await month.fetch();
  assert.equal(month.data.showStepChart, false);

  apiCalls = [];
  const all = boot('all');
  await all.fetch();
  assert.ok(apiCalls.includes('/werun/report'), '全部时间不带范围参数');
  assert.equal(all.data.showStepChart, true);
  assert.deepEqual(all.data.stepChartData, [{ label: '2026/11', value: 1000 }]);
  assert.equal(all.data.stepChartSlot, 36);
});

test('RP-S4 步数接口失败：报告页照常渲染，步数卡隐藏', async () => {
  const realGet = fakeApi.get;
  fakeApi.get = (p) => (p.indexOf('/werun/report') === 0 ? Promise.reject(new Error('down')) : realGet(p));
  try {
    const p = boot('year', FROM, TO);
    await p.fetch();
    assert.equal(p.data.step.hasData, false);
    assert.equal(p.data.summary.count, 1, '运动报告主体不受影响');
  } finally {
    fakeApi.get = realGet;
  }
});
