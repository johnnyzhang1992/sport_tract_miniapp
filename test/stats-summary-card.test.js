/**
 * 统计页「累计数据」卡 + 首页累计区撤除（2026-11-04 用户指定）：
 * - 统计页首行与首页累计数据同四项同顺序（轨迹 / 公里 / 点亮省份 / 点亮城市）；
 * - 其余指标（时长 / 爬升 / 千卡 / 运动类型）排在下一行；活跃天数已移到运动日历的四张卡；
 * - 运动日历上方固定四张卡（当前连续 / 最长连续 / 超越迹路者 / 活跃天数）；
 * - 公里格式化与首页同一口径（formatCompactCn），两页数字不许差一分钱；
 * - 首页累计数据整块删除（日历卡保留，仍可重试）。
 * 运行：node --test test/stats-summary-card.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  showToast: () => {},
  stopPullDownRefresh: () => {},
};
global.getApp = () => ({ globalData: { loggedIn: true, user: null }, hasSession: () => true, login: async () => {} });

const fakeApi = { get: async () => ({}), post: async () => ({}), put: async () => ({}), del: async () => ({}) };
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const loginGatePath = require.resolve('../miniprogram/utils/login-gate.js');
require.cache[loginGatePath] = {
  id: loginGatePath, filename: loginGatePath, loaded: true,
  exports: { ensureLogin: async () => true },
  children: [], paths: [],
};

let pageDef = null;
global.Page = (d) => { pageDef = d; };
require('../miniprogram/pages/stats/stats.js');
assert.ok(pageDef, 'stats.js 应通过 Page() 交出页面对象');

function makePage() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch) => Object.assign(p.data, patch || {});
  return p;
}

/** 取统计页顶部累计卡的 WXML 段（到运动日历注释为止） */
function summaryBlock() {
  const w = read('miniprogram/pages/stats/stats.wxml');
  const start = w.indexOf('<view class="section-title">累计数据</view>');
  assert.ok(start > 0, '统计页顶部标题要改成「累计数据」');
  const end = w.indexOf('<!-- 运动日历', start);
  assert.ok(end > start, '累计卡后面应紧跟运动日历卡');
  return w.slice(start, end);
}

test('SS1 首行与首页同四项同顺序，其余四项排下一行，不再重复「次数」「活跃天数」', () => {
  const block = summaryBlock();
  const labels = [];
  const re = />([^<>{}]+)</g;
  let m;
  while ((m = re.exec(block))) {
    const t = m[1].trim();
    if (t) labels.push(t);
  }
  const expected = ['累计数据', '轨迹', '公里', '点亮省份', '点亮城市', '时长', '爬升 m', '千卡', '运动类型'];
  assert.deepEqual(labels, expected, '首行四项与首页一致，其余按原相对顺序排下一行');
  assert.equal((block.match(/class="ov-item"/g) || []).length, 8, '首行 4 格 + 次行 4 格');
  assert.ok(!block.includes('活跃天数'), '活跃天数已移到运动日历上方的四张卡');
});

test('SS5 运动日历上方固定四张卡：文案简写，活跃天数并入', () => {
  const w = read('miniprogram/pages/stats/stats.wxml');
  const start = w.indexOf('<view class="streak-row">');
  assert.ok(start > 0, '应有 streak-row');
  const end = w.indexOf('<!-- 运动日历', start);
  assert.ok(end > start);
  const block = w.slice(start, end);

  const labels = [];
  const re = />([^<>{}]+)</g;
  let m;
  while ((m = re.exec(block))) {
    const t = m[1].trim();
    if (t) labels.push(t);
  }
  assert.deepEqual(labels, ['当前连续', '最长连续', '活跃天数', '超越迹路者'], '三张旧卡简写 + 活跃天数（排在分位前）');
  assert.equal((block.match(/class="streak-item"/g) || []).length, 4, '固定四张卡');
  assert.ok(block.includes('overview.total.activeDays'), '活跃天数取累计概览同字段');
  assert.ok(!block.includes('wx:if="{{percentile}}"'), '人数不足时也占位（—），不能缩回三张');
  assert.ok(block.includes("percentile ? percentile.percentile + '%' : '—'"), '分位缺失时显示 —');
});

test('SS2 省市两数都由点亮地图组件回传（同一次 /stats/footprint，不重复请求）', () => {
  const p = makePage();
  p.onLitMapLoaded({ detail: { provinceCount: 2, cityCount: 3 } });
  assert.equal(p.data.provinceCount, 2);
  assert.equal(p.data.cityCount, 3);
  assert.ok('cityCount' in pageDef.data, 'data 里要有 cityCount 初始值');
});

test('SS3 累计公里与首页同一格式化口径（399.15 而不是 399.14）', () => {
  const p = makePage();
  const ov = {
    week: { distance: 0, duration: 0 },
    month: { distance: 0, duration: 0 },
    year: { distance: 0, duration: 0 },
    total: {
      distance: 399145, duration: 0, count: 82, calories: 0, elevationGain: 0,
      activeDays: 68, streakCurrent: 0, streakLongest: 0,
    },
  };
  const d = p.decorateOverview(ov);
  assert.equal(d.total.distanceKm, '399.15', '与首页 formatCompactCn 同值');
  assert.equal(d.total.count, 82);
});

test('SS4 首页累计数据整块撤除：卡片/请求字段/跳转处理都不再存在，日历卡保留', () => {
  const w = read('miniprogram/pages/index/index.wxml');
  assert.ok(!w.includes('>累计数据<'), '首页不再渲染累计数据区块（注释里提到不算）');
  assert.ok(!w.includes('totalOverview'), '累计卡的数据字段要清干净');
  assert.ok(!w.includes('goStats'), '累计卡是唯一跳统计页的入口，处理函数一并移除');
  assert.ok(w.includes('retryHeat'), '日历卡的重试入口保留');
  assert.ok(w.includes('运动日历'), '日历卡本身不能误删');

  const js = read('miniprogram/pages/index/index.js');
  assert.ok(!js.includes('totalOverview'), '脚本里不再处理累计数据');
  assert.ok(!js.includes('goStats'), '脚本里不再保留跳统计页的方法');
  assert.ok(!js.includes('overviewError') && !js.includes('footprintError'), '累计卡的两条失败提示一并移除');
});
