/**
 * 运动计划接入报告两页（2026-11-19）：
 * - 年报页：新「运动计划」卡（计划天数/全达成/达成率/最长连续 + 徽章解锁行）+ 海报新段
 * - 运动报告页：汇总卡底部「计划·徽章」行（周期区间共用 /plan/report）
 * 运行：node --test test/report-plan.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/* ------------------------------- 结构断言 ------------------------------- */

test('RP-S1 年报结构：运动计划卡四格 + 徽章解锁行，数据源 /plan/report', () => {
  const w = read('miniprogram/pages/year-report/year-report.wxml');
  assert.match(w, /section-title">运动计划/);
  assert.match(w, /计划天数/);
  assert.match(w, /全达成天数/);
  assert.match(w, /达成率/);
  assert.match(w, /最长连续/);
  assert.match(w, /今年解锁徽章 \{\{planReport\.badges\.unlockedInRange\}\} 座/);
  const js = read('miniprogram/pages/year-report/year-report.js');
  assert.match(js, /\/plan\/report/, '年报要拉区间计划报告');
  assert.match(js, /planReport: null/);
  // 区间内既无计划也无新解锁时整卡不展示
  assert.match(js, /snapshotDays > 0 \|\| planReport\.badges\.unlockedInRange > 0/);
});

test('RP-S2 年报海报：运动计划段两行 + 海报高度预算计入 planCount', () => {
  const js = read('miniprogram/pages/year-report/year-report.js');
  assert.match(js, /startSection\('运动计划'\)/);
  assert.match(js, /计划 \$\{pr\.plan\.snapshotDays\} 天/);
  assert.match(js, /解锁徽章 \$\{pr\.badges\.unlockedInRange\} 座/);
  assert.match(js, /planCount: this\.data\.planReport \? 2 : 0/);
  const layout = read('miniprogram/utils/poster-layout.js');
  assert.match(layout, /planCount/, 'yearPosterHeight 要为计划段留高度');
});

test('RP-S3 运动报告结构：汇总卡计划·徽章行 + 区间取数 + 跳转运动计划页', () => {
  const w = read('miniprogram/pages/report/report.wxml');
  assert.match(w, /class="plan-line"/);
  assert.match(w, /计划达成 \{\{planReport\.plan\.achievedDays\}\}\/\{\{planReport\.plan\.snapshotDays\}\} 天/);
  assert.match(w, /解锁徽章 \{\{planReport\.badges\.unlockedInRange\}\} 座/);
  const js = read('miniprogram/pages/report/report.js');
  assert.match(js, /\/plan\/report\?from=/);
  assert.match(js, /goPlanPage/, '点击行跳运动计划页');
  assert.match(js, /plan-history\/plan-history/);
});

/* ------------------------------- 行为桩（年报 fetch） ------------------------------- */

const apiPath = require.resolve('../miniprogram/services/api.js');
const calls = [];
let planReport = null;
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
      if (p.indexOf('/plan/report') === 0) return Promise.resolve(planReport);
      if (p.indexOf('/overview') === 0) return Promise.resolve(overview);
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

test('RP-B1 年报取数：/plan/report 结果落到 planReport，卡片数据齐', async () => {
  calls.length = 0;
  planReport = {
    plan: { snapshotDays: 120, achievedDays: 96, achievedRate: 80, bestStreak: 21, planDistanceKm: 180.5 },
    badges: { unlockedInRange: 5, unlockedTotal: 23, total: 34 },
  };
  const p = boot();
  await p.fetch();

  // 与步数同区间：东八区自然年
  const from = Date.UTC(2026, 0, 1) - 8 * 3600000;
  const to = Date.UTC(2027, 0, 1) - 8 * 3600000;
  assert.ok(calls.includes(`/plan/report?from=${from}&to=${to}`), calls.join(','));
  assert.equal(p.data.planReport.plan.snapshotDays, 120);
  assert.equal(p.data.planReport.plan.achievedRate, 80);
  assert.equal(p.data.planReport.badges.unlockedInRange, 5);
  assert.equal(p.data.planReport.badges.unlockedTotal, 23);
});

test('RP-B2 区间内无计划且无新解锁：planReport 置空整卡隐藏', async () => {
  planReport = {
    plan: { snapshotDays: 0, achievedDays: 0, achievedRate: 0, bestStreak: 0, planDistanceKm: 0 },
    badges: { unlockedInRange: 0, unlockedTotal: 23, total: 34 },
  };
  const p = boot();
  await p.fetch();
  assert.equal(p.data.planReport, null, '整卡不展示（避免一堆 0 打扰）');
});

test('RP-B3 计划接口失败：年度报告主体照常', async () => {
  const realGet = require.cache[apiPath].exports.get;
  require.cache[apiPath].exports.get = (p) => (
    p.indexOf('/plan/report') === 0 ? Promise.reject(new Error('down')) : realGet(p)
  );
  try {
    const p = boot();
    await p.fetch();
    assert.equal(p.data.planReport, null);
    assert.equal(p.data.summary.count, 1, '主体不受影响');
  } finally {
    require.cache[apiPath].exports.get = realGet;
  }
});
