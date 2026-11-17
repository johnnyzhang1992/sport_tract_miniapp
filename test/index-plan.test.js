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
const apiCalls = [];
const fakeApi = {
  get(p) {
    apiCalls.push(p);
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
// loggedIn 默认 true：loadPlan 会先判断登录态（游客不请求 /plan/current）
const appGlobalData = { loggedIn: true };
global.getApp = () => ({ hasSession: () => true, globalData: appGlobalData });
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

/* 游客态（2026-11-17）：/plan/current 需要登录，未登录请求必然 401。
   首页不该在游客态发这次请求（控制台报错 + 白跑一次）。 */
test('IDX-P1 游客态不请求 /plan/current，且 planCard 置 null', async () => {
  appGlobalData.loggedIn = false;
  apiCalls.length = 0;
  try {
    const p = makePage();
    await p.loadPlan();
    await flush();
    assert.equal(apiCalls.length, 0, `游客态不该发起请求，实际：${apiCalls.join(',')}`);
    assert.equal(p.data.planCard, null, '游客态计划卡应为空（wxml 渲染引导）');
  } finally {
    appGlobalData.loggedIn = true;
  }
});

test('IDX-P2 已登录仍正常请求并装载计划卡（防止守卫写宽了）', async () => {
  shouldFail = false; // IP3 残留了失败开关
  planResponse = {
    plan: { targets: { distanceM: 3000, durationMin: 30, count: 1 } },
    progress: { distanceM: 1500, durationSec: 600, count: 1 },
    today: { distanceM: 1500, durationSec: 600 },
    rings: [{ pct: 0.5 }],
  };
  const p = makePage();
  apiCalls.length = 0;
  await p.loadPlan();
  await flush();
  assert.deepEqual(apiCalls, ['/plan/current'], `应请求一次，实际：${JSON.stringify(apiCalls)}`);
  assert.ok(p.data.planCard && p.data.planCard.plan, '登录态应装载计划卡');
});

/* 时序（2026-11-17）：冷启动时静默登录是异步的，而 loadPlan 走 nextTick 批次，
   可能赶在登录完成之前执行。原实现直接读 globalData.loggedIn 会误判成游客，
   导致「运动计划卡有时加载不出来」。现在必须先 await 静默登录再判断。 */
test('IDX-P3 静默登录未完成时：loadPlan 等待登录后仍能装载计划卡', async () => {
  planResponse = {
    plan: { targets: { distanceM: 3000, durationMin: 30, count: 1 } },
    progress: { distanceM: 1500, durationSec: 600, count: 1 },
    today: { distanceM: 1500, durationSec: 600 },
    rings: [{ pct: 0.5 }],
  };
  // 模拟：有 token 但还没登录完（loggedIn=false），login() 稍后把它置 true
  let loggedIn = false;
  let loginCalls = 0;
  global.getApp = () => ({
    hasSession: () => true,
    globalData: { get loggedIn() { return loggedIn; } },
    login: () => {
      loginCalls += 1;
      return new Promise((r) => setTimeout(() => { loggedIn = true; r(); }, 30));
    },
  });
  try {
    const p = makePage();
    await p.loadPlan(); // 必须内部 await 登录，否则 assert 会看到 planCard=null
    await flush();
    assert.equal(loginCalls, 1, '应发起一次静默登录');
    assert.ok(p.data.planCard && p.data.planCard.plan, '登录完成后应装载计划卡');
  } finally {
    global.getApp = () => ({ hasSession: () => true, globalData: appGlobalData });
  }
});

test('IDX-P4 没有本地 token（真游客）：不调 login、不发请求', async () => {
  let loginCalls = 0;
  global.getApp = () => ({
    hasSession: () => false,
    globalData: { loggedIn: false },
    login: () => { loginCalls += 1; return Promise.resolve(); },
  });
  apiCalls.length = 0;
  try {
    const p = makePage();
    await p.loadPlan();
    await flush();
    assert.equal(loginCalls, 0, '真游客不该触发登录');
    assert.deepEqual(apiCalls, [], '真游客不该发请求');
    assert.equal(p.data.planCard, null);
  } finally {
    global.getApp = () => ({ hasSession: () => true, globalData: appGlobalData });
  }
});
