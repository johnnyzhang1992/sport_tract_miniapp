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
let profileRespond = () => Promise.resolve({ uid: 1004, nickname: '会员甲', avatarUrl: '', avatarPreset: '', joinDays: 85, memberActive: true, total: { count: 82, distance: 399145, duration: 279000, elevationGain: 4860, calories: 26223, typeCount: 3 }, footprint: { provinceCount: 2, cityCount: 3 } });
const fakeApi = {
  get(p) {
    apiCalls.push(p);
    // 前缀判序：leaderboard-type-counts / leaderboard-regions 都以前缀 /stats/leaderboard 开头
    if (p.startsWith('/stats/leaderboard-type-counts')) return countsRespond(p);
    if (p.startsWith('/stats/leaderboard-regions')) return regionsRespond(p);
    if (p.startsWith('/geo/china-map')) return Promise.resolve({ type: 'FeatureCollection', features: [] });
    if (p.startsWith('/stats/profile/')) return profileRespond(p);
    return boardRespond(p);
  },
  // 页面改为走 api.getChinaMap（进程内缓存），测试桩保持同一路径计数
  getChinaMap() {
    return this.get('/geo/china-map');
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

test('LB7 占位圆首字按码点取：emoji 开头的昵称不出乱码方块', async () => {
  boardRespond = () =>
    Promise.resolve({
      top: [best('u1', 10000, { name: '🏃跑者' }), best('u2', 9000, { name: '' })],
      me: null,
      best: [],
    });
  const p = makePage();
  await p.fetchBoard();

  assert.equal(p.data.board.top[0].avatarText, '🏃', '码元下标会留下半个代理对');
  assert.equal(p.data.board.top[1].avatarText, '迹', '空昵称走缺省字');
});

const read = (rel) => require('node:fs').readFileSync(require('node:path').join(__dirname, '..', rel), 'utf8');

test('LB-MB 会员徽标：top / me / best 行按 memberActive 挂 member 标记', async () => {
  const row = (over) => Object.assign({
    rank: 1, name: '会员甲', gender: 1, avatarUrl: '', avatarPreset: '',
    distanceKm: 1, count: 1, durationSec: 60, paceSecPerKm: 60, memberActive: false,
  }, over);
  boardRespond = () => Promise.resolve({
    top: [row({ memberActive: true })],
    me: row({ memberActive: false }),
    best: [best('farthest', 1000, { memberActive: true })],
  });
  const p = makePage();
  await p.fetchBoard();
  assert.equal(p.data.board.top[0].member, true);
  assert.equal(p.data.board.me.member, false);
  assert.equal(p.data.board.best[0].member, true);
  const wxml = read('miniprogram/pages/leaderboard/leaderboard.wxml');
  assert.match(wxml, /class="rank-avatar-wrap"[\s\S]*member-badge\.png/, 'TOP10 头像挂徽标');
  assert.match(wxml, /class="me-avatar-wrap"[\s\S]*member-badge\.png/, '我的排名头像挂徽标');
});


test('LB-UP 点榜单用户：拉公开资料并格式化累计八项', async () => {
  const row = {
    rank: 1, uid: 1004, name: '会员甲', gender: 1, avatarUrl: '', avatarPreset: 'p1',
    distanceKm: 75.15, count: 19, durationSec: 3600, paceSecPerKm: 300, memberActive: true,
  };
  boardRespond = () => Promise.resolve({ top: [row], me: null, best: [] });
  profileRespond = () => Promise.resolve({
    uid: 1004, nickname: '会员甲', avatarUrl: '', avatarLargeUrl: 'https://oss.example.com/u/a-large.jpg', avatarPreset: 'p1', joinDays: 85, memberActive: true,
    total: { count: 82, distance: 399145, duration: 279000, elevationGain: 4860, calories: 26223, typeCount: 3 },
    footprint: { provinceCount: 2, cityCount: 3 },
  });
  const p = makePage();
  await p.fetchBoard();
  assert.equal(p.data.board.top[0].uid, 1004, '榜单行要带公开 uid');
  const wxml = read('miniprogram/pages/leaderboard/leaderboard.wxml');
  assert.match(wxml, /class="rank-row"[\s\S]{0,200}data-uid="\{\{item\.uid\}\}"[\s\S]{0,80}bindtap="openUserSheet"/, '榜单行点击要带 uid');

  apiCalls.length = 0;
  await p.openUserSheet({ currentTarget: { dataset: { uid: 1004 } } });
  assert.deepEqual(apiCalls, ['/stats/profile/1004']);
  const s = p.data.userSheet;
  assert.equal(s.visible, true);
  assert.equal(s.loading, false);
  assert.equal(s.name, '会员甲');
  assert.equal(s.uid, 1004);
  assert.equal(s.joinDays, 85);
  assert.equal(s.member, true);
  assert.equal(s.avatarSrc, '/assets/avatars/p1.png');
  assert.equal(s.avatarLargeUrl, 'https://oss.example.com/u/a-large.jpg');
  assert.deepEqual(s.stats, {
    trackCount: 82,
    distanceText: '399.15',
    provinceCount: 2,
    cityCount: 3,
    durationText: '77.5小时',
    elevationText: '4,860',
    caloriesText: '26,223',
    typeCount: 3,
  });

  p.previewSheetAvatar();
  assert.equal(p.data.avatarViewer.visible, true);
  assert.equal(p.data.avatarViewer.src, 'https://oss.example.com/u/a-large.jpg');
  p.closeAvatarViewer();
  assert.equal(p.data.avatarViewer.visible, false);

  p.previewSheetAvatar();
  p.closeUserSheet();
  assert.equal(p.data.userSheet.visible, false);
  assert.equal(p.data.avatarViewer.visible, false, '关资料卡也要收起大图');

  const w = read('miniprogram/pages/leaderboard/leaderboard.wxml');
  assert.match(w, /class="u-avatar-wrap"[^>]*bindtap="previewSheetAvatar"/, '点资料卡头像开大图');
  assert.match(w, /class="avatar-viewer" wx:if="\{\{avatarViewer\.visible\}\}"/, '全屏预览层存在');
});

test('LB-UP2 资料加载失败可重试；八项顺序与统计页累计卡一致', async () => {
  profileRespond = () => Promise.reject(new Error('down'));
  const p = makePage();
  await p.openUserSheet({ currentTarget: { dataset: { uid: 1004 } } });
  assert.equal(p.data.userSheet.error, true);
  assert.equal(p.data.userSheet.loading, false);

  profileRespond = () => Promise.resolve({
    uid: 1004, nickname: '会员甲', avatarUrl: '', avatarPreset: '', joinDays: 1, memberActive: false,
    total: { count: 1, distance: 1000, duration: 60, elevationGain: 0, calories: 0, typeCount: 1 },
    footprint: { provinceCount: 1, cityCount: 1 },
  });
  await p.retryUserSheet();
  assert.equal(p.data.userSheet.error, false);
  assert.equal(p.data.userSheet.visible, true);

  const w = read('miniprogram/pages/leaderboard/leaderboard.wxml');
  const labels = [...w.matchAll(/class="u-label">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(labels, ['轨迹', '公里', '点亮省份', '点亮城市', '时长', '爬升 m', '千卡', '运动类型']);
});

test('LB-UP3 对方关闭展示：资料卡八项置为占位文案，不渲染数字', async () => {
  profileRespond = () => Promise.resolve({
    uid: 1004, nickname: '会员甲', avatarUrl: '', avatarLargeUrl: '', avatarPreset: '',
    joinDays: 85, memberActive: false, showSportData: false, total: null, footprint: null,
  });
  const p = makePage();
  await p.openUserSheet({ currentTarget: { dataset: { uid: 1004 } } });
  assert.equal(p.data.userSheet.statsHidden, true);
  assert.equal(p.data.userSheet.stats, null);
  const w = read('miniprogram/pages/leaderboard/leaderboard.wxml');
  assert.ok(w.includes('已关闭运动数据展示'));
  assert.match(w, /wx:if="\{\{userSheet\.statsHidden\}\}" class="u-stats-hidden">已关闭运动数据展示/);
});
