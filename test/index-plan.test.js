/**
 * 首页运动计划卡（pages/index/index.js 的 loadPlan）：
 * - 有计划 → planCard 装载（周期文案、当前/目标文本、三环 pct）；
 * - 无计划 → planCard 置 null（wxml 渲染引导卡）；
 * - 接口失败静默（保持上一帧状态）。
 * 运行：node --test test/index-plan.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let planResponse = null;
let shouldFail = false;
const fakeApi = {
  get(p) {
    if (p === '/plan/current') {
      if (shouldFail) return Promise.reject(new Error('down'));
      return Promise.resolve(planResponse);
    }
    return Promise.resolve({});
  },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

global.wx = { nextTick: (cb) => cb(), getSystemInfoSync: () => ({ pixelRatio: 2 }), showToast: () => {} };
let pageDef = null;
global.Page = (d) => { pageDef = d; };
global.getApp = () => ({ hasSession: () => true, globalData: {} });
require('../miniprogram/pages/index/index.js');

function makePage() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch) => Object.assign(p.data, patch);
  p.drawPlanRings = () => {}; // canvas 绘制在页级测试外（node 环境无 canvas），桩掉
  return p;
}

const flush = () => new Promise((r) => setImmediate(r));

test('IP1 有计划：planCard 装载周期文案、当前/目标文本与三环 pct', async () => {
  planResponse = {
    plan: { period: 'weekly', targets: { distanceM: 20000, durationMin: 120, count: 3 }, updatedAt: 1 },
    progress: { distanceM: 25000, durationSec: 7200, count: 4 },
    today: { distanceM: 2000, durationSec: 1200, count: 1 },
    rings: [
      { key: 'distance', value: 25000, target: 20000, pct: 1 },
      { key: 'duration', value: 7200, target: 7200, pct: 1 },
      { key: 'count', value: 4, target: 3, pct: 1 },
    ],
  };
  const p = makePage();
  await p.loadPlan();
  await flush();
  assert.ok(p.data.planCard && p.data.planCard.plan === true);
  assert.equal(p.data.planCard.periodText, '每日', '周计划下线后计划卡恒为每日');
  assert.equal(p.data.planCard.distanceValue, '25.0', '当前值显示实际值（可超额）');
  assert.equal(p.data.planCard.distanceNum, '20.0', '目标值单独下发（单位另出）');
  assert.equal(p.data.planCard.durationValue, '120');
  assert.equal(p.data.planCard.durationNum, '120');
  assert.equal(p.data.planCard.countValue, '4');
  assert.equal(p.data.planCard.countNum, '3');
  assert.deepEqual(p.data.planCard.pcts, [1, 1, 1], 'pct 封顶 1');
  assert.equal(p.data.planCard.todayDistance, '2.0', '今日距离');
  assert.equal(p.data.planCard.todayDuration, '20', '今日时长（分钟）');
});

test('IP2 无计划：planCard 置 null（首页渲染引导卡）', async () => {
  planResponse = { plan: null, progress: { distanceM: 0, durationSec: 0, count: 0 }, rings: [] };
  shouldFail = false;
  const p = makePage();
  p.data.planCard = { plan: true }; // 先有旧值，验证会被清掉
  await p.loadPlan();
  await flush();
  assert.equal(p.data.planCard, null);
});

test('IP3 接口失败：静默保持上一帧，不把卡片打空', async () => {
  shouldFail = true;
  planResponse = { plan: { period: 'daily', targets: { distanceM: 5000, durationMin: 30, count: 1 }, updatedAt: 1 } };
  const p = makePage();
  p.data.planCard = { plan: true, periodText: '每日' };
  await p.loadPlan();
  await flush();
  assert.ok(p.data.planCard && p.data.planCard.periodText === '每日', '失败不清空卡片');
});
