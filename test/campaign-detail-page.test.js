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
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 * 桩：wx / Page / getApp 就地 stub；services/api 用 require.cache 注入假实现（绕开 config/storage 的真实
 *     wx 依赖），respond 钩子按需改写这一轮返回什么。
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
global.wx = {
  showToast: (o) => toasts.push(o && o.title),
  stopPullDownRefresh: () => {},
};

const appStub = { globalData: { loggedIn: true } };
global.getApp = () => appStub;

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
  respond = () => Promise.resolve({});
  appStub.globalData.loggedIn = true;
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
  total: 2,
  page: 1,
  pageSize: 50,
};

/** 详情页进页：mock 好「详情 + 成员时的排行榜」两跳 */
function mockDetail(detail, board = BOARD) {
  respond = (path) => {
    if (/\/leaderboard$/.test(path)) return Promise.resolve(board);
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
  assert.equal(page.data.head.rangeText, '10-01 ~ 10-07');
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
  assert.equal(apiCalls[1].path, '/campaigns/c1/leaderboard');
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
    assert.ok(page.data.panel, '先得有底部「我的贡献」面板');
    assert.equal(page.data.members.length, 2, '先得有两行成员');

    // 打开成员抽屉，再下拉刷新拿到 404（会话内活动被删 / 被清）
    page.openMember({ currentTarget: { dataset: { idx: 0 } } });
    assert.equal(page.data.sheetVisible, true, '抽屉先得是开着的');
    respond = () => Promise.reject(Object.assign(new Error('活动不存在'), { statusCode: 404 }));
    await page.refresh(true);
    await flush();

    assert.equal(page.data.notFound, true, '刷新拿到 404 → 进「活动不存在」态');
    assert.equal(page.data.isMember, false, '成员态必须清零');
    assert.equal(page.data.panel, null, '「我的贡献」条不能残留上一次的数字');
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
