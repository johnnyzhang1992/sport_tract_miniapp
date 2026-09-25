/**
 * 运动榜页（pages/leaderboard/leaderboard.js）页级回归：
 * 1) 本榜最佳的「最长距离」要在值后面带上这条纪录的运动时长（`12.34 km · 1:23:45`），
 *    没有可信时长（缺字段/0）就只显示距离，别编出个 0:00。
 * 2) chips 按计数重排后，没人点过时默认必须落在排第一的类型上（不能把页面默认的散步当成用户选择保住），
 *    且首屏只发一次榜单请求、请求的 type 就是那个默认类型；用户点过之后才反过来保住他的选择。
 * 运行：npm test；桩：wx / Page / getApp 就地 stub，services/api 用 require.cache 注入假实现。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

/* ---------------------------------- 环境桩 ---------------------------------- */

const apiCalls = [];
let boardRespond = () => Promise.resolve({ top: [], me: null, best: [] });
let countsRespond = () => Promise.resolve({ types: [] });
let regionsRespond = () => Promise.resolve({ provinces: [], cities: [], totalUsers: 0 });
const fakeApi = {
  get(p) {
    apiCalls.push(p);
    // 前缀判序：leaderboard-type-counts / leaderboard-regions 都以前缀 /stats/leaderboard 开头
    if (p.startsWith('/stats/leaderboard-type-counts')) return countsRespond(p);
    if (p.startsWith('/stats/leaderboard-regions')) return regionsRespond(p);
    if (p.startsWith('/geo/china-map')) return Promise.resolve({ type: 'FeatureCollection', features: [] });
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
  // canvas 节点查不到即可：refresh 只要不抛就行，地图渲染不是这里的被测对象
  p.createSelectorQuery = () => ({ select: () => ({ fields: () => ({ exec: (cb) => cb([null]) }) }) });
  return p;
}

/** onLoad() 不 return refresh 的 promise，测试要等它跑完就得把这次调用截下来 */
async function boot(p) {
  let done = Promise.resolve();
  p.refresh = (...a) => {
    done = pageDef.refresh.apply(p, a);
    return done;
  };
  p.onLoad();
  await done;
  return p;
}

/** 本接口拉到的榜单请求（按发出顺序） */
const boardCalls = () => apiCalls.filter((p) => p.startsWith('/stats/leaderboard?'));

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

/* ------------------------- chips 默认选中 = 排名第一 ------------------------- */
/* 用户没点过时，页面默认的 config 首位（散步）不该被当成"已有选择"在重排后保住 */

test('LB4 首次进入：默认选中排在第一的类型，榜单请求就是它', async () => {
  apiCalls.length = 0;
  boardRespond = () => Promise.resolve({ top: [], me: null, best: [] });
  countsRespond = () =>
    Promise.resolve({ types: [{ type: 'cycling', count: 90 }, { type: 'walking', count: 10 }, { type: 'running', count: 5 }] });
  const p = await boot(makePage());

  assert.equal(p.data.types[0].type, 'cycling', '骑行计数最多，该排第一'); // 先证明重排真的落地了
  assert.equal(p.curType(), 'cycling', '没人点过时，高亮的必须就是排第一的那个');
  assert.equal(p.data.typeIndex, 0);
  assert.equal(boardCalls().length, 1, `首次进入只该拉一次榜单，实际 ${boardCalls().join(' | ')}`);
  assert.ok(boardCalls()[0].includes('type=cycling'), `榜单要按默认选中的类型拉，实际 ${boardCalls()[0]}`);
});

test('LB5 计数回来前用户已经点过：保住用户的选择，不被第一名抢走', async () => {
  apiCalls.length = 0;
  boardRespond = () => Promise.resolve({ top: [], me: null, best: [] });
  let releaseCounts;
  countsRespond = () => new Promise((resolve) => { releaseCounts = resolve; });
  const p = makePage();
  const booted = boot(p);
  await new Promise((r) => setImmediate(r)); // 让 refresh 走到"已发出 counts 请求"
  p.onTypeTap({ currentTarget: { dataset: { index: 2 } } }); // 用户点了徒步（config 第 3 格）
  releaseCounts({ types: [{ type: 'cycling', count: 90 }, { type: 'walking', count: 10 }] });
  await booted;

  assert.equal(p.data.types[0].type, 'cycling', '顺序仍按计数重排');
  assert.equal(p.curType(), 'hiking', '用户点过的徒步必须还高亮');
});

test('LB6 计数拉不到：chips 退回 config 顺序、默认仍是首位，且降级有日志', async () => {
  apiCalls.length = 0;
  boardRespond = () => Promise.resolve({ top: [], me: null, best: [] });
  countsRespond = () => Promise.reject(new Error('network down'));
  const warned = [];
  const realWarn = console.warn;
  console.warn = (...a) => warned.push(a[0]);
  let p;
  try {
    p = await boot(makePage());
  } finally {
    console.warn = realWarn;
  }

  assert.ok(warned.some((m) => String(m).includes('类型计数')), '静默降级也要留一条日志');
  assert.equal(p.data.types[0].type, 'walking', '拿不到计数就不该动顺序');
  assert.equal(p.curType(), 'walking');
  assert.equal(boardCalls().length, 1);
  assert.ok(boardCalls()[0].includes('type=walking'));
});
