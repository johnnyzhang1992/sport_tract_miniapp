/**
 * 活动详情页（pages/campaign-detail/campaign-detail.js）页级回归。
 *
 * 需求里详情页是**唯一**能把「非 joined 身份」说清楚的地方（R23/R27）：列表 DTO 没有 myState，
 * 「已退出 / 已被移出」只能进详情页才看到。所以这里按 myState 逐态断言：
 *   - 只有 `joined` 才请求 `GET /campaigns/:id/leaderboard`（非成员服务端 403，§5 总则）；
 *   - 非 members 的总结/成员列表一律不下发（data.panel / data.members 必须为空），屏上不能出现成员数据；
 *   - pending / removed / left 各有一句身份说明行（stateNote）。
 * 另外守住两条外部输入的边界：畸形 `scene`（decodeURIComponent 抛 URIError）不能崩页面；
 * 并发刷新（onShow 与下拉重叠）要有 `_seq` 守卫，晚到的旧响应必须丢弃（R25）。
 *
 * 终审收尾（M1/M2）：
 *   - 无 token 的游客（扫码 / 分享卡落地的新用户）一个请求都不发（GET /campaigns/:id 必 401）——
 *     屏上出**游客态**（登录引导 + 按钮），不是错误态；登录闸门走触点级（点按钮才 ensureLogin），
 *     游客态本身安静渲染；
 *   - 非发起人成员有「退出活动」：先 wx.showModal 二次确认（取消＝零请求），确认后 POST /:id/leave，
 *     刷新即转「你已退出该活动」+「重新加入」；发起人看不到该入口。
 *
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 * 桩：wx / Page / getApp 就地 stub；services/api 与 utils/login-gate 用 require.cache 注入假实现
 *     （绕开 config/storage 的真实 wx 依赖），respond 钩子按需改写这一轮返回什么。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

/* ---------------------------------- 环境桩 ---------------------------------- */

const apiCalls = [];
/** 用例内改写的响应钩子：(path, body) => Promise<data> */
let respond = () => Promise.resolve({});
const fakeApi = {
  get(p) {
    apiCalls.push({ method: 'GET', path: p });
    return respond(p);
  },
  post(p, body) {
    apiCalls.push({ method: 'POST', path: p, body });
    return respond(p, body);
  },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const toasts = [];
const navs = []; // navigateTo 的 url（「编辑活动」入口跳转用）
const modals = []; // 每次 showModal 的入参（核对「退出活动」的二次确认）
let modalResult = { confirm: true }; // 用例控制的用户选择
global.wx = {
  showToast: (o) => toasts.push(o && o.title),
  navigateTo: (o) => navs.push(o && o.url),
  showModal: (o) => {
    modals.push(o);
    if (o && typeof o.success === 'function') o.success(modalResult);
  },
  stopPullDownRefresh: () => {},
};

const appStub = {
  globalData: { loggedIn: true, userInfo: null },
  _session: false, // 本地是否有 token（用例改 true 模拟「老用户会话待恢复」）
  hasSession() {
    return !!appStub._session;
  },
  login() {
    appStub.globalData.loggedIn = true;
    if (!appStub.globalData.userInfo) appStub.globalData.userInfo = { id: 'u-viewer' };
    return Promise.resolve({});
  },
};
global.getApp = () => appStub;

/* 「登录后查看」按钮必须走 utils/login-gate 的 ensureLogin（触点级闸门，不在 onLoad 自动弹）。
   这里用 require.cache 注入 spy：通过（true）时模拟真实闸门的效果 —— app.login() 落地。 */
const gateCalls = [];
let gateResult = true; // 用例控制：true＝用户确认且登录成功；false＝取消/失败
const gatePath = require.resolve('../miniprogram/utils/login-gate.js');
require.cache[gatePath] = {
  id: gatePath,
  filename: gatePath,
  loaded: true,
  exports: {
    ensureLogin() {
      gateCalls.push(1);
      if (!gateResult) return Promise.resolve(false);
      appStub.globalData.loggedIn = true;
      appStub.globalData.userInfo = { id: 'u-viewer' };
      return Promise.resolve(true);
    },
  },
  children: [],
  paths: [],
};

let pageDef = null;
global.Page = (def) => { pageDef = def; };

require('../miniprogram/pages/campaign-detail/campaign-detail.js');
assert.ok(pageDef, 'campaign-detail.js 应通过 Page() 交出页面对象');

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
  p.setData = (patch, cb) => {
    Object.keys(patch).forEach((k) => applyPath(p.data, k, patch[k]));
    if (cb) cb();
  };
  return p;
}

function resetEnv() {
  apiCalls.length = 0;
  toasts.length = 0;
  navs.length = 0;
  modals.length = 0;
  modalResult = { confirm: true };
  gateCalls.length = 0;
  gateResult = true;
  respond = () => Promise.resolve({});
  appStub.globalData.loggedIn = true;
  appStub.globalData.userInfo = null;
  appStub._session = false;
}

/** 让挂起的 Promise 链跑完（setImmediate 在微任务队列排空之后执行） */
const flush = () => new Promise((r) => setImmediate(r));

/**
 * 静音 console.warn / console.error：生产代码在「畸形 scene」「加载失败」「404」这几条路径上
 * 确实会打日志（campaign-detail.js 的 resolveId / refresh catch），但测试输出要 pristine。
 * 只在本用例体内 stub，用完还原（不动生产代码去迎合测试）。
 */
async function withSilencedConsole(fn) {
  const warn = console.warn;
  const error = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.warn = warn;
    console.error = error;
  }
}

/* ---------------------------------- 夹具 ---------------------------------- */

/** 两条分支都带的公共字段；startAt/endAt 用东八区 10-01 ~ 10-07（远期，与运行日期无关） */
const BASE = {
  id: 'c1',
  title: '周末一起去徒步',
  description: '走西湖群山',
  visibility: 'private',
  allowedTypes: ['hiking'],
  memberLimit: 10,
  startAt: Date.UTC(2026, 8, 30, 16, 0, 0),
  endAt: Date.UTC(2026, 9, 7, 16, 0, 0),
  status: 'active',
  creatorId: 'u-owner',
  myState: 'none',
  canJoin: true,
};

/** 非成员：**没有** totals / members / myPanel（服务端不下发） */
function nonMember(o = {}) {
  return Object.assign({}, BASE, o);
}

/** 成员：多出 totals / members / myPanel */
function member(o = {}) {
  return Object.assign({}, BASE, {
    myState: 'joined',
    canJoin: false,
    totals: { count: 5, distance: 25000, duration: 7200 },
    members: [
      { userId: 'u1', role: 'owner', name: '阿迹', avatarUrl: '', avatarPreset: 'face', joinedAt: 0, count: 3, distance: 15000, duration: 3600 },
      { userId: 'u2', role: 'member', name: '小迹', avatarUrl: '', avatarPreset: 'face', joinedAt: 0, count: 2, distance: 10000, duration: 3600 },
    ],
    myPanel: { count: 2, streak: 3, distance: 10000, duration: 3600 },
  }, o);
}

const BOARD = {
  rows: [
    { userId: 'u1', name: '阿迹', avatarUrl: '', avatarPreset: 'face', distance: 15000, count: 3, duration: 3600, rank: 1 },
    { userId: 'u2', name: '小迹', avatarUrl: '', avatarPreset: 'face', distance: 10000, count: 2, duration: 3600, rank: 2 },
  ],
  // 与 GET /:id/leaderboard 的真实响应同形：分页三件套缺一不可，
  // 少了 total 就等于「夹具说谎」——端上「加载更多」的判据正好挂在这个字段上。
  total: 2,
  page: 1,
  pageSize: 20,
};

/** 排行榜行夹具：名次从 from 起共 n 行（距离按名次递减，与真实排序同向） */
function boardRows(from, n) {
  return Array.from({ length: n }, (_, i) => ({
    userId: `u-${from + i}`,
    name: `成员${from + i}`,
    avatarUrl: '',
    avatarPreset: 'face',
    distance: (100 - from - i) * 1000,
    count: 1,
    duration: 600,
    rank: from + i,
  }));
}

/** 详情页进页：mock 好「详情 + 成员时的排行榜」两跳 */
function mockDetail(detail, board = BOARD) {
  respond = (path) => {
    // 端上现在带 query（?page=1&pageSize=20），不能再按「以 /leaderboard 结尾」匹配
    if (/\/leaderboard(\?|$)/.test(path)) return Promise.resolve(board);
    return Promise.resolve(detail);
  };
}

/* ---------------------------------- 用例 ---------------------------------- */

test('CDP1 非成员：只请求详情，一个成员数据都不请求、也不下发', async () => {
  resetEnv();
  mockDetail(nonMember({ myState: 'none', canJoin: true }));
  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();

  assert.equal(apiCalls.length, 1, '非成员只请求 /campaigns/:id');
  assert.equal(apiCalls[0].path, '/campaigns/c1');
  // 非成员视角：屏上只有标题/时间/可见性 + 加入入口
  assert.equal(page.data.isMember, false);
  assert.equal(page.data.head.title, '周末一起去徒步');
  assert.equal(page.data.head.rangeText, '2026/10/01 ~ 2026/10/07');
  assert.equal(page.data.cta.text, '申请加入'); // private + canJoin → 申请加入
  assert.deepEqual(page.data.members, [], '非成员不能有成员列表');
  assert.equal(page.data.panel, null, '非成员不能有底部「我的」面板');
  assert.equal(page.data.totals, null, '非成员不能有全队汇总');
});

test('CDP2 成员：额外请求排行榜，汇总/成员列表/底部面板齐备', async () => {
  resetEnv();
  mockDetail(member());
  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();

  assert.equal(apiCalls.length, 2, '成员要拉详情 + 排行榜');
  assert.equal(apiCalls[0].path, '/campaigns/c1');
  assert.equal(apiCalls[1].path, '/campaigns/c1/leaderboard?page=1&pageSize=20', '排行榜首屏固定要第 1 页');
  assert.equal(page.data.isMember, true);
  // 全队汇总三格
  assert.deepEqual(page.data.totals, {
    countText: '5',
    streakText: '0', // totals 没有 streak，fmtPanel 归 0（汇总三格不展示这一项）
    distanceText: '25.00',
    durationText: '2h0m',
  });
  // 成员列表＝排行榜行（名次 / 头像 / 昵称 / 距离 / 次数 / 时长）
  assert.equal(page.data.members.length, 2);
  assert.equal(page.data.members[0].rank, 1);
  assert.equal(page.data.members[0].name, '阿迹');
  assert.equal(page.data.members[0].distanceText, '15.00');
  assert.equal(page.data.members[0].countText, '3');
  assert.equal(page.data.members[0].durationText, '1h0m');
  assert.equal(page.data.members[0].medalIcon, '/assets/icons/rank-medal-1.png');
  // 底部悬浮面板：myPanel 经 fmtPanel（次数 / 连续 N 天 / 距离 / 时长）
  assert.equal(page.data.panel.streakText, '3');
  assert.equal(page.data.panel.distanceText, '10.00');
  assert.equal(page.data.panel.countText, '2');
  assert.equal(page.data.panel.durationText, '1h0m');
  assert.equal(page.data.cta, null, '成员没有加入按钮');
  assert.equal(page.data.stateNote, '');
});

test('CDP3 scene 参数（小程序码）→ 解出 campaignId', async () => {
  resetEnv();
  mockDetail(nonMember());
  const page = makePage();
  await page.onLoad({ scene: encodeURIComponent('abc123') });
  await flush();

  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].path, '/campaigns/abc123', '小程序码走 scene，要解出 id');
});

test('CDP4 畸形 scene（裸 %）→ decodeURIComponent 抛 URIError 也不能崩，走「活动不存在」态', async () => {
  resetEnv();
  await withSilencedConsole(async () => {
    const page = makePage();
    // decodeURIComponent('%E4%') 抛 URIError：若不用 try/catch 包住，这里会直接把页面崩掉（onLoad 抛出）
    await page.onLoad({ scene: '%E4%' });
    await flush();

    assert.equal(page.data.notFound, true, '畸形 scene 应退回「活动不存在」态');
    assert.equal(page.data.loading, false);
    assert.equal(apiCalls.length, 0, 'id 解不出来时一个请求都不发');
  });
});

test('CDP5 pending：身份说明行说「等待发起人同意」，按钮禁用且不请求排行榜', async () => {
  resetEnv();
  mockDetail(nonMember({ myState: 'pending', canJoin: false }));
  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();

  assert.equal(apiCalls.length, 1, '待审批不是成员 → 不请求排行榜（服务端 403）');
  assert.equal(page.data.isMember, false);
  assert.match(page.data.stateNote, /等待发起人同意/);
  assert.deepEqual(page.data.cta, { text: '等待发起人同意', disabled: true });
  assert.equal(page.data.panel, null);
});

test('CDP6 removed：身份说明行说清「已被移出」，按钮禁用', async () => {
  resetEnv();
  mockDetail(nonMember({ myState: 'removed', canJoin: false }));
  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();

  assert.match(page.data.stateNote, /移出该活动/);
  assert.equal(page.data.cta.disabled, true);
  assert.equal(page.data.cta.text, '你已被移出该活动');
});

test('CDP7 left 且可再参加：身份说明行说「已退出」+ 按钮「重新加入 / 重新申请」', async () => {
  resetEnv();
  mockDetail(nonMember({ myState: 'left', canJoin: true, visibility: 'public' }));
  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();
  assert.match(page.data.stateNote, /已退出该活动/);
  assert.deepEqual(page.data.cta, { text: '重新加入', disabled: false });

  // 隐私活动：措辞换成「重新申请」（只是文案，可参加性不变）
  resetEnv();
  mockDetail(nonMember({ myState: 'left', canJoin: true, visibility: 'private' }));
  const page2 = makePage();
  await page2.onLoad({ id: 'c1' });
  await flush();
  assert.deepEqual(page2.data.cta, { text: '重新申请', disabled: false });
});

test('CDP8 并发刷新：晚到的旧响应必须被丢弃（_seq 守卫，R25）', async () => {
  resetEnv();
  // 首屏正常进来，之后模拟 onShow 与下拉刷新重叠（两次 refresh 都在途）
  mockDetail(nonMember({ title: '标题' }));
  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();

  const pending = [];
  respond = () => new Promise((resolve) => pending.push(resolve));
  const p1 = page.refresh(true); // 老一轮
  const p2 = page.refresh(true); // 新一轮
  await flush();
  assert.equal(pending.length, 2, '两次刷新各发一次详情请求');

  pending[1](nonMember({ title: '新标题' })); // 新一轮先回来
  await p2;
  pending[0](nonMember({ title: '旧标题' })); // 老一轮后回来
  await p1;

  assert.equal(page.data.head.title, '新标题', '晚到的旧响应不能盖住新状态');
});

test('CDP9 首屏加载失败 → 整页错误态 + 可重试，静默不弹 toast', async () => {
  resetEnv();
  await withSilencedConsole(async () => {
    respond = () => Promise.reject(new Error('网络请求失败，请检查后端服务是否启动'));
    const page = makePage();
    await page.onLoad({ id: 'c1' });
    await flush();

    assert.equal(page.data.loading, false);
    assert.equal(page.data.notFound, false);
    assert.match(page.data.error, /网络请求失败/);
    assert.equal(toasts.length, 0, '加载失败静默：走屏上错误态，不用 toast 打断');

    // 重试：网络恢复后能正常渲染
    mockDetail(nonMember());
    page.retry();
    await flush();
    assert.equal(page.data.error, '');
    assert.equal(page.data.head.title, '周末一起去徒步');
  });
});

test('CDP10 服务端 404 → 「活动不存在」态（不显示错误重试）', async () => {
  resetEnv();
  await withSilencedConsole(async () => {
    respond = () => Promise.reject(Object.assign(new Error('活动不存在'), { statusCode: 404 }));
    const page = makePage();
    await page.onLoad({ id: 'c1' });
    await flush();

    assert.equal(page.data.notFound, true);
    assert.equal(page.data.error, '');
    assert.equal(page.data.loading, false);
  });
});

test('CDP13 成员态下拉刷新遇 404 → 成员专属字段被清零，不残留旧成员视图', async () => {
  resetEnv();
  await withSilencedConsole(async () => {
    mockDetail(member());
    const page = makePage();
    await page.onLoad({ id: 'c1' });
    await flush();

    // 先确实进入成员态（否则后面的断言是空转）
    assert.equal(page.data.isMember, true, '先进入成员态');
    assert.ok(page.data.panel, '先得有底部「我的运动」面板');
    assert.equal(page.data.members.length, 2, '先得有两行成员');

    // 打开成员抽屉，再下拉刷新拿到 404（会话内活动被删 / 被清）
    page.openMember({ currentTarget: { dataset: { idx: 0 } } });
    assert.equal(page.data.sheetVisible, true, '抽屉先得是开着的');
    respond = () => Promise.reject(Object.assign(new Error('活动不存在'), { statusCode: 404 }));
    await page.refresh(true);
    await flush();

    assert.equal(page.data.notFound, true, '刷新拿到 404 → 进「活动不存在」态');
    assert.equal(page.data.isMember, false, '成员态必须清零');
    assert.equal(page.data.panel, null, '「我的运动」条不能残留上一次的数字');
    assert.deepEqual(page.data.members, [], '成员列表必须清空');
    assert.equal(page.data.totals, null, '全队汇总必须清空');
    assert.equal(page.data.sheetVisible, false, '成员抽屉必须被关掉');
    assert.equal(page.data.sheetMember, null, '抽屉数据不能残留');
  });
});

test('CDP11 加入按钮：可点时 POST /campaigns/:id/join 并刷新，禁用时点了也不发请求', async () => {
  resetEnv();
  // pending：按钮禁用 → 点了不发任何请求
  mockDetail(nonMember({ myState: 'pending', canJoin: false }));
  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();
  apiCalls.length = 0;
  await page.onJoin();
  await flush();
  assert.equal(apiCalls.length, 0, '禁用按钮不响应点击');

  // 可加入：点了 POST join，成功后重新拉详情（状态变成成员）
  resetEnv();
  let state = nonMember({ myState: 'none', canJoin: true });
  respond = (path) => {
    if (path === '/campaigns/c1/join') {
      state = member();
      return Promise.resolve({ myState: 'joined' });
    }
    if (/\/leaderboard$/.test(path)) return Promise.resolve(BOARD);
    return Promise.resolve(state);
  };
  const page2 = makePage();
  await page2.onLoad({ id: 'c1' });
  await flush();
  apiCalls.length = 0;
  await page2.onJoin();
  await flush();

  assert.equal(apiCalls[0].method, 'POST');
  assert.equal(apiCalls[0].path, '/campaigns/c1/join');
  assert.equal(page2.data.isMember, true, '加入成功后要刷新成成员视角');
  assert.equal(toasts.length, 1, '用户主动点击：成功后给一次提示');
});

/* ------------------------------ 终端收尾：游客登录闸门（M1） ------------------------------ */

test('CDP14 无 token 游客：渲染游客态（不是错误态），一个请求都不发', async () => {
  resetEnv();
  appStub.globalData.loggedIn = false; // 全新用户：本地无 token（hasSession() 为 false）
  mockDetail(nonMember()); // 误发请求会拿到 200 —— 断言「零请求」才说明真的没发
  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();

  assert.equal(apiCalls.length, 0, '游客一个请求都不发（GET /campaigns/:id 必 401）');
  assert.equal(page.data.loading, false);
  assert.equal(page.data.error, '', '游客态不是错误态（不许出「未授权 + 重试」死屏）');
  assert.equal(page.data.notFound, false);
  assert.equal(page.data.loggedIn, false, 'WXML 据此渲染游客态（登录引导 + 「登录后查看」按钮）');
  assert.equal(page.data.head, null, '游客没有详情数据');
  assert.equal(gateCalls.length, 0, '进页不自动弹登录：闸门只走触点级（用户点按钮才拉）');
});

test('CDP15 老用户（本地有 token）：refresh 补一次静默登录后照常渲染，不弹登录弹窗', async () => {
  resetEnv();
  appStub.globalData.loggedIn = false; // 会话恢复在途/失败
  appStub._session = true; // 本地有 token
  mockDetail(nonMember());
  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();

  assert.equal(appStub.globalData.loggedIn, true, '有 token 的老用户：refresh 应补一次静默登录（同列表页口径）');
  assert.equal(apiCalls.length, 1, '恢复后照常请求详情');
  assert.equal(page.data.head.title, '周末一起去徒步');
  assert.equal(modals.length, 0, '静默恢复不弹登录弹窗');
});

test('CDP16 游客点「登录后查看」→ ensureLogin：取消零请求留在游客态；通过后重新拉详情', async () => {
  resetEnv();
  appStub.globalData.loggedIn = false;
  mockDetail(nonMember());
  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();
  assert.equal(page.data.loggedIn, false, '先处在游客态');

  // ① 闸门未过（用户取消 / 登录失败）：零请求、留在游客态
  gateResult = false;
  await page.guestLogin();
  await flush();
  assert.equal(gateCalls.length, 1, '点按钮必须走 utils/login-gate 的 ensureLogin');
  assert.equal(apiCalls.length, 0, '闸门未过：一个请求都不发');
  assert.equal(page.data.loggedIn, false, '留在游客态（按钮可再点）');

  // ② 闸门通过：重新请求详情，页面转正常内容态
  gateResult = true;
  await page.guestLogin();
  await flush();
  assert.equal(gateCalls.length, 2);
  assert.equal(apiCalls.length, 1, '登录成功后重新请求详情');
  assert.equal(apiCalls[0].path, '/campaigns/c1');
  assert.equal(page.data.head.title, '周末一起去徒步');
  assert.equal(page.data.loggedIn, true, '渲染路径翻到内容态');
});

/* ------------------------------ 终端收尾：退出活动（M2） ------------------------------ */

test('CDP17 非发起人成员：退出活动二次确认；取消零请求；确认 POST /leave 后转「已退出 + 重新加入」', async () => {
  resetEnv();
  appStub.globalData.userInfo = { id: 'u-viewer' }; // 普通成员（≠ creatorId u-owner）
  let state = member();
  respond = (path) => {
    if (path === '/campaigns/c1/leave') {
      state = nonMember({ myState: 'left', canJoin: true, visibility: 'public' });
      return Promise.resolve({});
    }
    if (/\/leaderboard$/.test(path)) return Promise.resolve(BOARD);
    return Promise.resolve(state);
  };
  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();
  assert.equal(page.data.isMember, true);
  assert.equal(page.data.canLeave, true, '非发起人成员：WXML 渲染「退出活动」入口');

  // ① 取消：零请求
  modalResult = { confirm: false };
  page.onLeave();
  await flush();
  assert.equal(modals.length, 1, '必须先弹二次确认');
  assert.equal(modals[0].title, '退出活动');
  assert.equal(modals[0].content, '确定退出该活动？退出后可重新加入。');
  assert.equal(apiCalls.filter((c) => c.path === '/campaigns/c1/leave').length, 0, '点取消不能发请求');

  // ② 确认：POST /leave → refresh(true) → 「你已退出该活动」+「重新加入」
  modalResult = { confirm: true };
  page.onLeave();
  await flush();
  const leaves = apiCalls.filter((c) => c.path === '/campaigns/c1/leave');
  assert.equal(leaves.length, 1);
  assert.equal(leaves[0].method, 'POST');
  assert.deepEqual(toasts, ['已退出活动']);
  assert.equal(page.data.isMember, false);
  assert.equal(page.data.stateNote, '你已退出该活动');
  assert.deepEqual(page.data.cta, { text: '重新加入', disabled: false });
  assert.equal(page.data.canLeave, false, '退出后入口消失');
  assert.equal(page.data.panel, null, '退出后不能再有「我的运动」面板');
});

test('CDP18 发起人：没有「退出活动」入口，onLeave 点了也不弹窗不请求', async () => {
  resetEnv();
  appStub.globalData.userInfo = { id: 'u-owner' }; // == creatorId：发起人
  mockDetail(member());
  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();
  assert.equal(page.data.isCreator, true, '先确认处在发起人视角');
  assert.equal(page.data.canLeave, false, '发起人不能退出自己的活动（出路是解散）');

  const calls = apiCalls.length;
  page.onLeave();
  await flush();
  assert.equal(modals.length, 0, '发起人没有入口：连确认弹窗都不出现');
  assert.equal(apiCalls.length, calls, '发起人点不出任何请求');
});

test('CDP19 成员排行昵称最多展示 5 个字：6 个字截断补省略号，正好 5 个字不动', async () => {
  resetEnv();
  const long = '字'.repeat(6);
  mockDetail(member(), {
    rows: [
      { userId: 'u1', name: long, avatarUrl: '', avatarPreset: 'face', distance: 15000, count: 3, duration: 3600, rank: 1 },
      { userId: 'u2', name: '字'.repeat(5), avatarUrl: '', avatarPreset: 'face', distance: 10000, count: 2, duration: 3600, rank: 2 },
      { userId: 'u3', name: '阿迹', avatarUrl: '', avatarPreset: 'face', distance: 100, count: 1, duration: 60, rank: 3 },
    ],
    total: 3,
    page: 1,
    pageSize: 50,
  });
  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();

  assert.equal(page.data.members[0].name, '字'.repeat(5) + '...', '6 个字 → 展示前 5 个 + 「...」');
  assert.equal(page.data.members[1].name, '字'.repeat(5), '正好 5 个字不加省略号');
  assert.equal(page.data.members[2].name, '阿迹', '短昵称不受影响');
});

test('CDP20 「移出」按钮在昵称之后、距离/次数之前（结构顺序钉在 wxml 源里）', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../miniprogram/pages/campaign-detail/campaign-detail.wxml'),
    'utf8',
  );
  const iName = src.indexOf('rank-name');
  const iKick = src.indexOf('rank-kick');
  const iMeta = src.indexOf('rank-meta');
  const iDist = src.indexOf('rank-dist');
  assert.ok(iKick > iName, '「移出」应排在昵称之后');
  assert.ok(iKick < iMeta, '「移出」应排在次数/时长之前（不再是行尾）');
  assert.ok(iKick < iDist, '「移出」应排在距离之前');
  assert.match(
    src.slice(iKick - 200, iKick + 200),
    /catchtap="onKickTap"/,
    '仍是 catchtap：不能冒泡到整行的 openMember，否则点「移出」会先弹出成员汇总',
  );
});

test('CDP21 全队汇总三格是「标签左 / 数值右」横排：标签排在数值之前', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../miniprogram/pages/campaign-detail/campaign-detail.wxml'),
    'utf8',
  );
  const block = src.slice(src.indexOf('class="sum-row"'));
  const tags = [...block.matchAll(/class="sum-(label|value)"/g)]
    .slice(0, 6)
    .map((m) => m[1]);
  assert.deepEqual(
    tags,
    ['label', 'value', 'label', 'value', 'label', 'value'],
    '三格都必须是「标签在前、数值在后」。出现 value→label 就是退回纵向堆叠（数值在上、标签在下）',
  );
});

test('CDP22 状态标签用共享类：head.statusTag 给修饰类，wxml 不再用自己的 .head-tag', async () => {
  resetEnv();
  mockDetail(member());
  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();

  assert.equal(page.data.head.statusText, '进行中');
  assert.equal(page.data.head.statusTag, 'campaign-tag--active', 'fixture 是 active 态');

  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../miniprogram/pages/campaign-detail/campaign-detail.wxml'),
    'utf8',
  );
  assert.match(
    src,
    /class="campaign-tag \{\{head\.statusTag\}\}"/,
    '详情页要改用 app.wxss 里的共享 .campaign-tag，否则又跟列表卡片各长一套',
  );
  assert.ok(!src.includes('head-tag'), '.head-tag 应已从详情页 wxml 消失');
});

/* ------------------------- 发起人「编辑活动」入口 -------------------------
 * 口径：只有发起人、且活动**进行中**才能编辑；已结束与已解散都收回入口。
 * 入口只是导航，真正的闸门在服务端 PUT /campaigns/:id。
 * ------------------------------------------------------------------------ */

test('CDP23 发起人可编辑：只有进行中给入口，已结束 / 已解散都不给', async () => {
  resetEnv();
  appStub.globalData.userInfo = { id: 'u-owner' };
  mockDetail(member());
  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();
  assert.equal(page.data.canEdit, true, '进行中：发起人应有编辑入口');

  page.goEdit();
  assert.deepEqual(navs, ['/pages/campaign-create/campaign-create?id=c1']);
  assert.equal(apiCalls.filter((c) => c.method === 'PUT').length, 0, '入口只跳转，不该顺手发请求');

  // 已结束：活动已经跑完，改标题/改日期都不该再给入口
  mockDetail(member({ status: 'ended', endAt: Date.UTC(2026, 9, 7, 16, 0, 0) }));
  await page.refresh(true);
  await flush();
  assert.equal(page.data.head.statusText, '已结束');
  assert.equal(page.data.canEdit, false, '已结束不能编辑（只有进行中可改）');
  navs.length = 0;
  page.goEdit();
  assert.equal(navs.length, 0, '没有入口时点了也不该跳（wxml 之外再兜一层）');

  // 已解散：只读，编辑入口收回
  mockDetail(member({ status: 'dissolved' }));
  await page.refresh(true);
  await flush();
  assert.equal(page.data.canEdit, false, '解散后活动转只读，不能再编辑');
});

test('CDP24 非发起人不给编辑入口：普通成员与非成员 canEdit 都是 false', async () => {
  resetEnv();
  appStub.globalData.userInfo = { id: 'u-viewer' }; // ≠ creatorId
  mockDetail(member());
  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();
  assert.equal(page.data.isCreator, false, '先确认处在普通成员视角');
  assert.equal(page.data.canEdit, false);

  mockDetail(nonMember());
  await page.refresh(true);
  await flush();
  assert.equal(page.data.canEdit, false, '非成员更不该看到编辑入口');
});

test('CDP25 「编辑」pill 挂在发起人那一排（.act-row 内、由 canEdit 驱动）', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../miniprogram/pages/campaign-detail/campaign-detail.wxml'),
    'utf8',
  );
  assert.match(
    src,
    /class="act-pill"[^>]*wx:if="\{\{canEdit\}\}"[^>]*bindtap="goEdit"/,
    '编辑入口要与「邀请好友」「解散活动」同排同形态，且由 canEdit 单独驱动',
  );
});

/* ---------------------------- 成员排行分页 ----------------------------
 * 排行按距离排，服务端必须给全员算完距离才能定名次，所以分页只切响应。
 * 端上是**往同一个数组追加**，于是两件事必须钉住：
 *   1. 追加行的 rank 是全局名次（服务端已算好，端上不再排）；
 *   2. 「加载更多」的显示判据是 total，不是本页行数——老服务端不下发 total 时
 *      退化成「全量、没有加载更多」，绝不能出一个点了没反应的按钮。
 * -------------------------------------------------------------------- */

test('CDP26 首屏带分页参数上送，并落地 total / page', async () => {
  resetEnv();
  appStub.globalData.userInfo = { id: 'u-owner' };
  mockDetail(member());
  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();

  const call = apiCalls.find((c) => c.path.indexOf('/leaderboard') >= 0);
  assert.ok(call, '成员视角要拉排行榜');
  assert.match(call.path, /[?&]page=1(&|$)/, `首屏只要第 1 页：${call.path}`);
  assert.match(call.path, /[?&]pageSize=20(&|$)/, `页大小要与服务端默认同口径：${call.path}`);
  assert.equal(page.data.members.length, 2);
  assert.equal(page.data.memberTotal, 2, 'total 决定「加载更多」出不出');
  assert.equal(page.data.memberPage, 1);
});

test('CDP27 加载更多：追加第 2 页、名次接着数，到底后按钮条件不再成立', async () => {
  resetEnv();
  appStub.globalData.userInfo = { id: 'u-owner' };
  respond = (path) => {
    if (path.indexOf('/leaderboard') >= 0) {
      return Promise.resolve(
        path.indexOf('page=2') >= 0
          ? { rows: boardRows(21, 5), total: 25, page: 2, pageSize: 20 }
          : { rows: boardRows(1, 20), total: 25, page: 1, pageSize: 20 },
      );
    }
    return Promise.resolve(member());
  };
  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();
  assert.equal(page.data.members.length, 20);
  assert.equal(page.data.memberTotal, 25);

  await page.loadMoreMembers();
  assert.equal(page.data.members.length, 25, '第 2 页要接在同一列后面，不是替换');
  assert.deepEqual(
    page.data.members.map((m) => m.rank),
    Array.from({ length: 25 }, (_, i) => i + 1),
    '追加行必须带全局名次——端上重排或沿用页内下标都会出现两个第 1 名',
  );
  assert.equal(page.data.memberPage, 2);
  assert.equal(page.data.members.length < page.data.memberTotal, false, '到底了，按钮条件不再成立');
  assert.equal(page.data.memberLoadingMore, false);

  const before = apiCalls.length;
  await page.loadMoreMembers();
  assert.equal(apiCalls.length, before, '已经到底还点（比如 wxml 判断漏了）不该再发请求');
});

test('CDP28 加载更多失败 → toast 具体原因、列表不动、按钮可重试', async () => {
  resetEnv();
  appStub.globalData.userInfo = { id: 'u-owner' };
  respond = (path) => {
    if (path.indexOf('page=2') >= 0) return Promise.reject(new Error('网络不给力'));
    if (path.indexOf('/leaderboard') >= 0) {
      return Promise.resolve({ rows: boardRows(1, 20), total: 25, page: 1, pageSize: 20 });
    }
    return Promise.resolve(member());
  };
  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();

  await page.loadMoreMembers();
  assert.equal(page.data.members.length, 20, '失败不能把已显示的行清掉');
  assert.equal(toasts[toasts.length - 1], '网络不给力', '要原样转服务端/网络的错，别只说「加载失败」');
  assert.equal(page.data.memberPage, 1, '页码不前进，重试才会重新要第 2 页');
  assert.equal(page.data.memberLoadingMore, false, '失败必须复位，否则按钮永久锁死');
  assert.ok(page.data.members.length < page.data.memberTotal, '仍有 5 人没显示 → 按钮还在，可以重试');
});

test('CDP29 响应不带 total（老服务端）→ 退化成「全量、没有加载更多」', async () => {
  resetEnv();
  appStub.globalData.userInfo = { id: 'u-owner' };
  mockDetail(member(), { rows: boardRows(1, 3) }); // 真实的老响应就只有 rows 一个字段
  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();
  assert.equal(page.data.members.length, 3);
  assert.equal(page.data.memberTotal, 3, '没有 total 就按「已显示的就是全部」兜底');
  assert.equal(page.data.members.length < page.data.memberTotal, false, '否则会出现一个点了没反应的按钮');
});

test('CDP30 加载更多在途时整页刷新 → 过期响应不许追加到新一页后面', async () => {
  resetEnv();
  appStub.globalData.userInfo = { id: 'u-owner' };
  let release;
  const board = (path) => {
    if (path.indexOf('page=2') >= 0) return new Promise((r) => { release = r; });
    return Promise.resolve({ rows: boardRows(1, 20), total: 25, page: 1, pageSize: 20 });
  };
  respond = (path) => (path.indexOf('/leaderboard') >= 0 ? board(path) : Promise.resolve(member()));

  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();

  const pending = page.loadMoreMembers(); // 故意不 await：让它悬在途
  await page.refresh(true); // 期间用户下拉刷新，重新要了第 1 页
  release({ rows: boardRows(21, 5), total: 25, page: 2, pageSize: 20 });
  await pending;
  await flush();

  assert.equal(page.data.members.length, 20, '过期第 2 页若照样追加，屏上就会是「刷新后的 1..20 + 21..25」混着两场数据');
  assert.equal(page.data.memberPage, 1, '刷新已把页码归 1，过期响应不该把它推到 2');
});

test('CDP31 「加载更多」行由 members.length < memberTotal 驱动，并写明已显示/总数', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../miniprogram/pages/campaign-detail/campaign-detail.wxml'),
    'utf8',
  );
  assert.match(
    src,
    /wx:if="\{\{members\.length < memberTotal\}\}"[^>]*bindtap="loadMoreMembers"/,
    '加载更多只在还有没显示的人时出现，且是显式可点的行（不靠触底自动加载）',
  );
  assert.match(src, /已显示 \{\{members\.length\}\} \/ \{\{memberTotal\}\}/, '要给出「还差多少」的实际数字');
});

test('CDP32 未开始（upcoming）：标签「未开始」+ 专属样式，发起人仍有编辑入口', async () => {
  resetEnv();
  appStub.globalData.userInfo = { id: 'u-owner' };
  mockDetail(member({ status: 'upcoming' }));
  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();

  assert.equal(page.data.head.statusText, '未开始', '文案必须有名可显，不能透传英文档位');
  assert.equal(page.data.head.statusTag, 'campaign-tag--upcoming', '不与「已结束」共用灰底：两者语义相反');
  assert.equal(page.data.canEdit, true, '还没开赛正是最该调时间/标题的阶段，编辑入口要给');
  assert.equal(page.data.isMember, true, '未开始不影响成员身份');
});

test('CDP33 未开始的非成员仍可加入：cta 不置灰', async () => {
  resetEnv();
  appStub.globalData.userInfo = { id: 'u-viewer' };
  mockDetail(nonMember({ status: 'upcoming', canJoin: true, visibility: 'public' }));
  const page = makePage();
  await page.onLoad({ id: 'c1' });
  await flush();

  assert.deepEqual(page.data.cta, { text: '加入活动', disabled: false }, '报名早于开赛是常态，未开始不该挡加入');
  assert.equal(page.data.canEdit, false, '但编辑入口仍只给发起人');
});
