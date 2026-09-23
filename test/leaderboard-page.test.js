/**
 * 运动榜页（pages/leaderboard/leaderboard.js）页级回归：
 * 本榜最佳的「最长距离」要在值后面带上这条纪录的运动时长（`12.34 km · 1:23:45`），
 * 没有可信时长（缺字段/0）就只显示距离，别编出个 0:00。
 * 运行：npm test；桩：wx / Page / getApp 就地 stub，services/api 用 require.cache 注入假实现。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

/* ---------------------------------- 环境桩 ---------------------------------- */

const apiCalls = [];
let boardRespond = () => Promise.resolve({ top: [], me: null, best: [] });
const fakeApi = {
  get(p) {
    apiCalls.push(p);
    return boardRespond(p);
  },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const toasts = [];
global.wx = {
  showToast: (o) => toasts.push(o && o.title),
  getResourcePath: (p) => p,
};
let pageDef = null;
global.Page = (def) => { pageDef = def; };
global.getApp = () => ({ globalData: { api: fakeApi, loggedIn: true }, hasSession: () => true });

require('../miniprogram/pages/leaderboard/leaderboard.js');
assert.ok(pageDef, 'leaderboard.js 应通过 Page() 交出页面对象');

/* --------------------------------- 页面装配 --------------------------------- */

function applyPath(target, keyPath, value) {
  const keys = keyPath.split('.');
  let o = target;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

function makePage() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch = {}) => Object.keys(patch).forEach((k) => applyPath(p.data, k, patch[k]));
  return p;
}

/** 一条本榜最佳行（后端下发形态：只有原始数值） */
function best(key, value, extra = {}) {
  return Object.assign({ key, value, name: '运动用户', gender: 1, avatarUrl: '', avatarPreset: '' }, extra);
}

/* ---------------------------------- 用例 ---------------------------------- */

test('LB1 最长距离带时长：值后面接 · 运动时长', async () => {
  boardRespond = () =>
    Promise.resolve({
      top: [],
      me: null,
      best: [best('farthest', 12340, { durationSec: 5025 })], // 12.34 km / 1:23:45
    });
  const p = makePage();
  await p.fetchBoard();

  const [row] = p.data.board.best;
  assert.equal(row.label, '最长距离');
  assert.equal(row.valueText, '12.34 km · 1:23:45', '距离后面要能看出这条纪录跑了多久');
});

test('LB2 没有可信时长就只显示距离（不下发 0:00）', async () => {
  boardRespond = () => Promise.resolve({ top: [], me: null, best: [best('farthest', 5000)] }); // 无 durationSec
  const p = makePage();
  await p.fetchBoard();
  assert.equal(p.data.board.best[0].valueText, '5.00 km');

  boardRespond = () => Promise.resolve({ top: [], me: null, best: [best('farthest', 5000, { durationSec: 0 })] });
  await p.fetchBoard();
  assert.equal(p.data.board.best[0].valueText, '5.00 km', '0 时长不展示');
});

test('LB3 其它指标不受影响（爬升只有数值、配速仍带单位）', async () => {
  boardRespond = () =>
    Promise.resolve({
      top: [],
      me: null,
      best: [best('farthest', 10000, { durationSec: 3600 }), best('maxClimb', 812), best('fastestKm', 240)],
    });
  const p = makePage();
  await p.fetchBoard();

  const byKey = Object.fromEntries(p.data.board.best.map((b) => [b.key, b.valueText]));
  assert.equal(byKey.farthest, '10.00 km · 1:00:00');
  assert.equal(byKey.maxClimb, '812 m');
  assert.equal(byKey.fastestKm, `4'00"`);
});
