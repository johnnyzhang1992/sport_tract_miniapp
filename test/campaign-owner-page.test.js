/**
 * 活动详情页「发起人专属 + 分享 / 小程序码」页级回归（Task 11）。
 *
 * 需求边界（本文件是唯一防线，逐条钉住）：
 *   - 发起人身份 = `getApp().globalData.userInfo.id` 与 `detail.creatorId` 比较（T10 时本页不持有 viewerId）；
 *   - **非发起人绝不请求** `GET /:id/pending`（服务端 403；他人数据不外泄）；成员明细（`GET /:id/members/:uid`）
 *     则对**活动内成员**开放：发起人与普通成员点成员行都要拉（防的是非成员，不是队友）；
 *   - 踢人 / 解散必须 `wx.showModal` 二次确认 —— **取消＝零请求**（本仓对破坏性操作的硬要求）；
 *   - 成员明细＝stats 概况 + 分页列表（加载更多只在还有下一页时发请求）；
 *   - 小程序码 `{url}` 与降级 `{url:'', base64}` 两条分支都要能展示；保存相册只吃本地路径
 *     （base64 → writeFile 落临时文件；远程 url → downloadFile，被域名白名单拦下时不吞掉长按识别路径）；
 *   - 分享照 track-detail.js 的 onShareAppMessage / onShareTimeline 写法。
 *
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 * 桩：wx / Page / Component / getApp 就地 stub；services/api 用 require.cache 注入假实现
 *     （绕开 config/storage 的真实 wx 依赖），respond 钩子按路径分发这一轮的返回。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

/* ---------------------------------- 环境桩 ---------------------------------- */

const apiCalls = [];
/** 用例内改写的响应钩子：(path, body) => Promise<data> */
let respond = () => Promise.resolve({});
/** DELETE 的额外副作用钩子（用例里模拟服务端状态翻转，如解散） */
let delHook = () => {};
const fakeApi = {
  get(p) {
    apiCalls.push({ method: 'GET', path: p });
    return respond(p);
  },
  post(p, body) {
    apiCalls.push({ method: 'POST', path: p, body });
    return respond(p, body);
  },
  del(p) {
    apiCalls.push({ method: 'DELETE', path: p });
    delHook(p);
    return respond(p);
  },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const toasts = [];
const modals = []; // 每次 showModal 的入参（含 title/content），用来核对二次确认文案
let modalResult = { confirm: true }; // 用例控制的用户选择
const previews = []; // wx.previewImage 入参
const albumSaves = []; // wx.saveImageToPhotosAlbum 的 filePath
const downloadFails = { value: false }; // downloadFile 是否模拟「被域名白名单拦下」
const writtenFiles = []; // writeFile 入参（base64 降级分支）
global.wx = {
  showToast: (o) => toasts.push(o && o.title),
  setNavigationBarTitle: () => {},
  showModal: (o) => {
    modals.push(o);
    if (o && typeof o.success === 'function') o.success(modalResult);
  },
  showLoading: () => {},
  hideLoading: () => {},
  stopPullDownRefresh: () => {},
  previewImage: (o) => previews.push(o),
  saveImageToPhotosAlbum: (o) => {
    albumSaves.push(o.filePath);
    if (o.success) o.success();
  },
  downloadFile: (o) => {
    if (downloadFails.value) {
      if (o.fail) o.fail({ errMsg: 'downloadFile:fail url not in domain list' });
    } else if (o.success) {
      o.success({ statusCode: 200, tempFilePath: `${o.url}#tmp` });
    }
    if (o.complete) o.complete();
  },
  env: { USER_DATA_PATH: '/tmp-userdata' },
  getFileSystemManager: () => ({
    writeFile: (o) => {
      writtenFiles.push(o);
      o.success && o.success();
    },
  }),
  openSetting: () => {},
};

const appStub = {
  globalData: {
    loggedIn: true,
    userInfo: { id: 'u-owner' }, // 发起人视角默认；用例可改
  },
};
global.getApp = () => appStub;

let pageDef = null;
let compDef = null;
global.Page = (def) => { pageDef = def; };
global.Component = (def) => { compDef = def; };

require('../miniprogram/pages/campaign-detail/campaign-detail.js');
assert.ok(pageDef, 'campaign-detail.js 应通过 Page() 交出页面对象');
require('../miniprogram/components/campaign-member-sheet/campaign-member-sheet.js');
assert.ok(compDef, 'campaign-member-sheet.js 应通过 Component() 交出组件对象');

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
  modals.length = 0;
  previews.length = 0;
  albumSaves.length = 0;
  writtenFiles.length = 0;
  modalResult = { confirm: true };
  delHook = () => {};
  appStub.globalData.userInfo = { id: 'u-owner' };
  appStub.globalData.loginPromise = null;
}

/** 让挂起的 Promise 链跑完（setImmediate 在微任务队列排空之后执行） */
const flush = () => new Promise((r) => setImmediate(r));

/** 静音 console.warn / console.error（生产代码在失败路径确实会打日志；测试输出要 pristine） */
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

const OWNER_ID = 'u-owner';
const OTHER_ID = 'u2';
const THIRD_ID = 'u3';

/** 详情（成员视角；creatorId 默认＝登录用户） */
function detailOf(o = {}) {
  return Object.assign({
    id: 'c1',
    title: '周末一起去徒步',
    description: '',
    visibility: 'public',
    allowedTypes: ['hiking'],
    memberLimit: 10,
    startAt: Date.UTC(2026, 8, 30, 16, 0, 0),
    endAt: Date.UTC(2026, 9, 7, 16, 0, 0),
    status: 'active',
    creatorId: OWNER_ID,
    myState: 'joined',
    canJoin: false,
    totals: { count: 25, distance: 250000, duration: 9000 },
    members: [],
    myPanel: { count: 5, streak: 2, distance: 50000, duration: 3600 },
  }, o);
}

/** 排行榜：我自己（发起人）+ 小迹 */
function boardOf() {
  return {
    rows: [
      { userId: OWNER_ID, name: '我', avatarUrl: '', avatarPreset: 'face', distance: 50000, count: 5, duration: 3600, rank: 1 },
      { userId: OTHER_ID, name: '小迹', avatarUrl: '', avatarPreset: 'face', distance: 200000, count: 20, duration: 5400, rank: 2 },
    ],
    total: 2,
    page: 1,
    pageSize: 50,
  };
}

/** 待审批两行（同意/拒绝各测一条）。
 *  appliedAt 按**服务端真实形态**给：库里是 Date，过 JSON 到端上是 ISO 字符串
 *  （模拟器实测抓到的 NaN-NaN 就是只吃了 epoch 数字的锅）。 */
function pendingOf() {
  return {
    rows: [
      { userId: OTHER_ID, appliedAt: '2026-10-10T02:30:00.000Z', name: '小迹', avatarUrl: '', avatarPreset: 'face' },
      { userId: THIRD_ID, appliedAt: '2026-10-11T03:00:00.000Z', name: '阿三', avatarUrl: '', avatarPreset: '' },
    ],
  };
}

/** 成员明细：25 条（pageSize 20 → 两页，「加载更多」有真实下一页） */
function detailItemsOf() {
  return Array.from({ length: 25 }, (_, i) => ({
    id: `t${25 - i}`,
    type: 'hiking',
    distance: 4200 - i * 100,
    duration: 1800,
    startTime: Date.UTC(2026, 9, 9, 1, 5, 0) - i * 86400000,
    elevationGain: i === 0 ? 120 : 0,
  }));
}

const MEMBER_STATS = { count: 25, distance: 250000, duration: 9000 };

/** 累计趋势（GET /:id/trend）：成员视角会额外拉一次 */
function trendOf() {
  return {
    metric: 'distance',
    bucket: 'day',
    labels: ['10/01', '10/02'],
    series: [
      { userId: OWNER_ID, name: '我', isMe: true, values: [1000, 2000] },
      { userId: OTHER_ID, name: '小迹', isMe: false, values: [500, 1500] },
    ],
  };
}

/**
 * 按路径分发的一站式 mock：approve/reject 会真实收窄待审批列表、kick 会收窄排行榜，
 * 页面 refresh 后拿到的就是「服务端视角」的新状态（而不是写死回包）。
 */
function mockAll(opts = {}) {
  const state = {
    detail: detailOf(),
    board: boardOf(),
    pending: pendingOf(),
    items: detailItemsOf(),
  };
  respond = (path, body) => {
    if (/\/campaigns\/c1\/pending$/.test(path)) return Promise.resolve(state.pending);
    if (/\/approve$/.test(path) || /\/reject$/.test(path)) {
      state.pending = { rows: state.pending.rows.filter((r) => r.userId !== body.userId) };
      return Promise.resolve(null);
    }
    if (/\/kick$/.test(path)) {
      state.board = Object.assign({}, state.board, { rows: state.board.rows.filter((r) => r.userId !== body.userId) });
      return Promise.resolve(null);
    }
    if (/\/leaderboard(\?|$)/.test(path)) return Promise.resolve(state.board);
    if (/\/trend(\?|$)/.test(path)) return Promise.resolve(trendOf());
    if (/\/members\//.test(path)) {
      const page = Number((path.match(/[?&]page=(\d+)/) || [])[1] || 1);
      const pageSize = Number((path.match(/[?&]pageSize=(\d+)/) || [])[1] || 20);
      const items = state.items.slice((page - 1) * pageSize, page * pageSize);
      return Promise.resolve({ stats: MEMBER_STATS, items, total: state.items.length, page, pageSize });
    }
    return Promise.resolve(state.detail);
  };
  return state;
}

/** 进页并静默等两跳（详情 + 排行榜 + 待审批）落地 */
async function openPage(options = { id: 'c1' }) {
  const page = makePage();
  await page.onLoad(options);
  await flush();
  return page;
}

const tap = (idx) => ({ currentTarget: { dataset: { idx } } });

/* ---------------------------------- 用例 ---------------------------------- */

test('COP1 发起人进页面会请求待审批列表（渲染徽标）；非发起人一个相关请求都不发', async () => {
  resetEnv();
  mockAll();
  const page = await openPage();

  assert.deepEqual(apiCalls.map((c) => c.path), [
    '/campaigns/c1',
    '/campaigns/c1/leaderboard?page=1&pageSize=20',
    '/campaigns/c1/trend',
    '/campaigns/c1/pending',
  ]);
  assert.equal(page.data.isCreator, true);
  assert.equal(page.data.pendingCount, 2, '徽标数＝待审批条数');
  assert.equal(page.data.pendingRows[0].name, '小迹');
  assert.equal(page.data.pendingRows[0].appliedAtText, '10/10 10:30', '申请时间按东八区 MM/DD HH:mm');
  // 成员行：自己不可踢、他人可踢（仅发起人视角下才有 canKick）
  assert.equal(page.data.members[0].canKick, false, '发起人不能移出自己');
  assert.equal(page.data.members[1].canKick, true);

  resetEnv();
  appStub.globalData.userInfo = { id: 'u-viewer' }; // 普通成员视角
  mockAll();
  const page2 = await openPage();
  assert.equal(page2.data.isCreator, false);
  assert.ok(!apiCalls.some((c) => /\/pending$/.test(c.path)), '非发起人绝不请求 /pending（服务端 403）');
  assert.equal(page2.data.pendingCount, 0);
  assert.equal(page2.data.members[0].canKick, false, '非发起人没有移出入口');
});

test('COP2 踢人：先 wx.showModal 二次确认；取消不发请求，确认后才 POST kick', async () => {
  resetEnv();
  mockAll();
  const page = await openPage();

  // ① 取消：零请求
  modalResult = { confirm: false };
  page.onKickTap(tap(1));
  await flush();
  assert.equal(modals.length, 1, '必须先弹二次确认');
  assert.equal(modals[0].title, '移出成员');
  assert.equal(modals[0].content, '确定把 TA 移出活动？');
  assert.equal(apiCalls.filter((c) => c.path === '/campaigns/c1/kick').length, 0, '点取消不能发请求');

  // ② 确认：POST kick（body 字段名就是 userId）+ 成功后刷新
  modalResult = { confirm: true };
  appStub.globalData.homeDirty = false;
  page.onKickTap(tap(1));
  await flush();
  const kicks = apiCalls.filter((c) => c.path === '/campaigns/c1/kick');
  assert.equal(kicks.length, 1);
  assert.equal(kicks[0].method, 'POST');
  assert.deepEqual(kicks[0].body, { userId: OTHER_ID });
  assert.deepEqual(toasts, ['已移出']);
  assert.equal(appStub.globalData.homeDirty, true, '移出成员后首页卡片(人数/头像)变了：要标脏让它重拉');
  assert.equal(apiCalls.filter((c) => c.path === '/campaigns/c1').length, 2, '踢完要静默刷新');

  // 自己那行（canKick=false）：连弹窗都不该有
  const before = modals.length;
  page.onKickTap(tap(0));
  await flush();
  assert.equal(modals.length, before, '不能移出自己（不弹确认）');
  assert.equal(apiCalls.filter((c) => c.path === '/campaigns/c1/kick').length, 1);
});

test('COP3 解散：二次确认后才 DELETE；取消不请求；非发起人点了无效', async () => {
  resetEnv();
  const state = mockAll();
  const page = await openPage();

  // ① 取消：零请求
  modalResult = { confirm: false };
  page.onDissolve();
  await flush();
  assert.equal(modals.length, 1);
  assert.equal(modals[0].title, '解散活动');
  assert.equal(modals[0].content, '解散后活动页只读，确定？');
  assert.equal(apiCalls.filter((c) => c.method === 'DELETE').length, 0, '点取消不能发请求');

  // ② 确认：DELETE + toast + 刷新为已解散态（status 由服务端派生，端上不重算）
  modalResult = { confirm: true };
  delHook = () => { state.detail = detailOf({ status: 'dissolved' }); };
  appStub.globalData.homeDirty = false;
  page.onDissolve();
  await flush();
  const dels = apiCalls.filter((c) => c.method === 'DELETE');
  assert.equal(dels.length, 1);
  assert.equal(dels[0].path, '/campaigns/c1');
  assert.deepEqual(toasts, ['活动已解散']);
  assert.equal(appStub.globalData.homeDirty, true, '解散后首页不该再挂这条活动：要标脏让它重拉');
  assert.equal(page.data.head.statusText, '已解散', '解散后页面进入已解散态');

  // ③ 非发起人：按钮不存在，方法都不该被触发任何请求
  resetEnv();
  appStub.globalData.userInfo = { id: 'u-viewer' };
  mockAll();
  const page2 = await openPage();
  const calls = apiCalls.length;
  page2.onDissolve();
  await flush();
  assert.equal(modals.length, 0, '非发起人没有解散入口');
  assert.equal(apiCalls.length, calls);
});

test('COP4 点成员：活动内成员（发起人与普通成员）都请求 /members/:uid 展开明细', async () => {
  resetEnv();
  mockAll();
  const page = await openPage();
  page.openMember(tap(1));
  await flush();

  const detailCalls = apiCalls.filter((c) => c.path.includes('/members/'));
  assert.deepEqual(detailCalls.map((c) => c.path), ['/campaigns/c1/members/u2?page=1&pageSize=20']);
  assert.equal(page.data.sheetVisible, true);
  assert.equal(page.data.sheetMember.name, '小迹');
  // 概况来自该接口的 stats，明细行是格式化过的展示字段
  assert.deepEqual(page.data.sheetDetail.stats, { countText: '25', streakText: '0', distanceText: '250.00', durationText: '2小时30分钟' });
  assert.equal(page.data.sheetDetail.total, 25);
  assert.equal(page.data.sheetDetail.items.length, 20);
  assert.equal(page.data.sheetDetail.items[0].typeText, '徒步');
  assert.equal(page.data.sheetDetail.items[0].timeText, '10/09 09:05');
  assert.equal(page.data.sheetDetail.items[0].distanceText, '4.20');
  assert.equal(page.data.sheetDetail.items[0].durationText, '30分钟');
  assert.equal(page.data.sheetDetail.items[0].elevationText, ' · 爬升 120m');
  assert.equal(page.data.sheetDetail.hasMore, true);

  // 普通成员点同一行：同样拉明细（明细对活动内成员开放）——差异只剩「移出」入口
  resetEnv();
  appStub.globalData.userInfo = { id: 'u-viewer' };
  mockAll();
  const page2 = await openPage();
  page2.openMember(tap(1));
  await flush();
  const detailCalls2 = apiCalls.filter((c) => c.path.includes('/members/'));
  assert.deepEqual(
    detailCalls2.map((c) => c.path),
    ['/campaigns/c1/members/u2?page=1&pageSize=20'],
    '普通成员点成员行也要拉明细',
  );
  assert.equal(page2.data.sheetVisible, true);
  assert.equal(page2.data.sheetMember.name, '小迹');
  assert.equal(page2.data.sheetDetail.total, 25);
  assert.equal(page2.data.sheetDetail.items.length, 20);
  assert.equal(page2.data.sheetDetail.error, false, '要真拉到数据，不是错误态');
  assert.equal(page2.data.members[1].canKick, false, '「移出」仍只有发起人');
  assert.ok(!apiCalls.some((c) => /\/pending$/.test(c.path)), '普通成员仍绝不请求 /pending');
});

test('COP5 审批：同意 / 拒绝 → POST body {userId}，本地移除该行并刷新', async () => {
  resetEnv();
  mockAll();
  const page = await openPage();

  page.openReview();
  assert.equal(page.data.reviewVisible, true);
  page.onApprove(tap(0));
  await flush();
  const approves = apiCalls.filter((c) => c.path === '/campaigns/c1/approve');
  assert.equal(approves.length, 1);
  assert.equal(approves[0].method, 'POST');
  assert.deepEqual(approves[0].body, { userId: OTHER_ID });
  assert.deepEqual(toasts, ['已同意']);
  assert.equal(page.data.pendingRows.length, 1, '本地先移除该行');
  assert.equal(page.data.pendingRows[0].userId, THIRD_ID);
  assert.equal(page.data.reviewVisible, true, '还有待审批就继续开着抽屉');
  assert.equal(page.data.pendingCount, 1, '刷新后徽标数同步');

  page.onReject(tap(0));
  await flush();
  const rejects = apiCalls.filter((c) => c.path === '/campaigns/c1/reject');
  assert.equal(rejects.length, 1);
  assert.deepEqual(rejects[0].body, { userId: THIRD_ID });
  assert.deepEqual(toasts, ['已同意', '已拒绝']);
  assert.equal(page.data.pendingRows.length, 0);
  assert.equal(page.data.reviewVisible, false, '清空后抽屉自动收起');
  assert.equal(page.data.pendingCount, 0);
});

test('COP6 成员明细「加载更多」：page+1 追加；没有下一页 / 加载中不重复发请求', async () => {
  resetEnv();
  mockAll();
  const page = await openPage();
  page.openMember(tap(1));
  await flush();

  page.onSheetLoadMore();
  page.onSheetLoadMore(); // 连点：第二次必须被 loadingMore 挡住
  await flush();
  const pages = apiCalls.filter((c) => c.path.includes('/members/')).map((c) => c.path);
  assert.deepEqual(pages, ['/campaigns/c1/members/u2?page=1&pageSize=20', '/campaigns/c1/members/u2?page=2&pageSize=20']);
  assert.equal(page.data.sheetDetail.items.length, 25, '两页拼接');
  assert.equal(page.data.sheetDetail.hasMore, false, '25 条拿完就没有下一页');

  const calls = apiCalls.length;
  page.onSheetLoadMore();
  await flush();
  assert.equal(apiCalls.length, calls, '没有下一页时一个请求都不发');
});

test('COP7 小程序码：POST body {campaignId}，url 分支展示并走 previewImage；非成员零请求', async () => {
  resetEnv();
  respond = (path) => {
    if (/\/pending$/.test(path)) return Promise.resolve({ rows: [] });
    if (/\/leaderboard(\?|$)/.test(path)) return Promise.resolve(boardOf());
    if (path === '/campaigns/mini-code') return Promise.resolve({ url: 'https://oss.example/qr.png?sig=1', key: 'k1' });
    return Promise.resolve(detailOf());
  };
  const page = await openPage();
  await page.onInvite();
  await flush();

  const codes = apiCalls.filter((c) => c.path === '/campaigns/mini-code');
  assert.equal(codes.length, 1);
  assert.equal(codes[0].method, 'POST');
  assert.equal(codes[0].body.campaignId, 'c1');
  assert.equal(page.data.codeVisible, true);
  assert.equal(page.data.codeSrc, 'https://oss.example/qr.png?sig=1');
  assert.equal(page.data.codeLocalPath, '', 'url 分支不落本地文件');

  page.previewCode();
  assert.equal(previews.length, 1);
  assert.deepEqual(previews[0].urls, ['https://oss.example/qr.png?sig=1'], '长按识别路径：预览的就是小程序码');

  // 非成员（如 pending）没有邀请入口：方法不该发任何请求
  resetEnv();
  respond = () => Promise.resolve(detailOf({ myState: 'pending', canJoin: false, totals: undefined, myPanel: undefined }));
  const page2 = await openPage();
  const calls = apiCalls.length;
  await page2.onInvite();
  await flush();
  assert.equal(apiCalls.length, calls, '非成员点邀请不发请求');
  assert.equal(page2.data.codeVisible, false);
});

test('COP8 小程序码降级：base64 落临时文件后可预览可保存；url 分支 downloadFile 被拦时不吞识别路径', async () => {
  resetEnv();
  await withSilencedConsole(async () => {
    respond = (path) => {
      if (/\/leaderboard(\?|$)/.test(path)) return Promise.resolve(boardOf());
      if (/\/pending$/.test(path)) return Promise.resolve({ rows: [] });
      if (path === '/campaigns/mini-code') return Promise.resolve({ url: '', base64: 'data:image/png;base64,QUJD' });
      return Promise.resolve(detailOf());
    };
    const page = await openPage();
    await page.onInvite();
    await flush();

    assert.equal(writtenFiles.length, 1, 'base64 分支必须先落成临时文件（预览/保存都只吃路径）');
    assert.ok(writtenFiles[0].filePath.startsWith('/tmp-userdata/'));
    assert.equal(writtenFiles[0].encoding, 'base64');
    assert.equal(writtenFiles[0].data, 'QUJD', 'data: 前缀要剥掉');
    assert.equal(page.data.codeSrc, writtenFiles[0].filePath);
    assert.equal(page.data.codeLocalPath, writtenFiles[0].filePath);

    page.saveCode();
    await flush();
    assert.deepEqual(albumSaves, [writtenFiles[0].filePath], '本地文件直接存相册');
    assert.deepEqual(toasts, ['已保存到相册']);
  });

  // url 分支：downloadFile（需要域名在白名单里）成功 → 落回临时路径再存
  resetEnv();
  respond = (path) => {
    if (/\/leaderboard(\?|$)/.test(path)) return Promise.resolve(boardOf());
    if (/\/pending$/.test(path)) return Promise.resolve({ rows: [] });
    if (path === '/campaigns/mini-code') return Promise.resolve({ url: 'https://oss.example/qr.png?sig=1', key: 'k1' });
    return Promise.resolve(detailOf());
  };
  const page2 = await openPage();
  await page2.onInvite();
  await flush();
  page2.saveCode();
  await flush();
  assert.deepEqual(albumSaves, ['https://oss.example/qr.png?sig=1#tmp'], '远程 url 由 downloadFile 落地后保存');

  // url 分支 + downloadFile 被域名白名单拦下：不保存，但要明确引导长按识别，不能静默
  resetEnv();
  await withSilencedConsole(async () => {
    albumSaves.length = 0;
    downloadFails.value = true;
    respond = (path) => {
      if (/\/leaderboard(\?|$)/.test(path)) return Promise.resolve(boardOf());
      if (/\/pending$/.test(path)) return Promise.resolve({ rows: [] });
      if (path === '/campaigns/mini-code') return Promise.resolve({ url: 'https://oss.example/qr.png?sig=1', key: 'k1' });
      return Promise.resolve(detailOf());
    };
    const page3 = await openPage();
    await page3.onInvite();
    await flush();
    page3.saveCode();
    await flush();
    downloadFails.value = false;
    assert.deepEqual(albumSaves, [], 'downloadFile 被拦 → 不能假装保存成功');
    assert.deepEqual(toasts, ['保存失败，可长按图片识别或保存'], '要给出长按识别的替代路径');
  });
});

test('COP9 冷启动直达本页：等在途的静默登录落地后再判发起人身份；登录失败按非发起人兜底', async () => {
  resetEnv();
  appStub.globalData.userInfo = null;
  appStub.globalData.loginPromise = Promise.resolve().then(() => {
    appStub.globalData.userInfo = { id: OWNER_ID };
  });
  mockAll();
  const page = await openPage();
  assert.equal(page.data.isCreator, true, '登录落地后应认出发起人');
  assert.ok(apiCalls.some((c) => /\/pending$/.test(c.path)), '发起人要拉待审批');

  resetEnv();
  await withSilencedConsole(async () => {
    appStub.globalData.userInfo = null;
    appStub.globalData.loginPromise = Promise.reject(new Error('未登录'));
    mockAll();
    const page2 = await openPage();
    assert.equal(page2.data.isCreator, false, '登录失败 → 非发起人（安全侧：不请求他人数据）');
    assert.ok(!apiCalls.some((c) => /\/pending$/.test(c.path) || c.path.includes('/members/')));
  });
});

test('COP10 分享：onShareAppMessage / onShareTimeline 照 track-detail 写法带标题与 id', async () => {
  resetEnv();
  mockAll();
  const page = await openPage();

  assert.deepEqual(page.onShareAppMessage(), {
    title: '周末一起去徒步',
    path: '/pages/campaign-detail/campaign-detail?id=c1',
  });
  assert.deepEqual(page.onShareTimeline(), {
    title: '周末一起去徒步',
    query: 'id=c1',
  });
});

test('COP11 成员明细加载失败 → 半屏出错误态（不冒充空态），静默不弹 toast', async () => {
  resetEnv();
  await withSilencedConsole(async () => {
    respond = (path) => {
      if (/\/leaderboard(\?|$)/.test(path)) return Promise.resolve(boardOf());
      if (/\/pending$/.test(path)) return Promise.resolve({ rows: pendingOf().rows });
      if (path.includes('/members/')) return Promise.reject(new Error('网络请求失败'));
      return Promise.resolve(detailOf());
    };
    const page = await openPage();
    apiCalls.length = 0;
    page.openMember(tap(1));
    await flush();

    assert.equal(page.data.sheetDetail.loading, false);
    assert.equal(page.data.sheetDetail.error, true);
    assert.deepEqual(page.data.sheetDetail.items, []);
    assert.equal(page.data.sheetDetail.hasMore, false);
    assert.deepEqual(toasts, [], '加载失败静默：半屏内说明，不用 toast 打断');
  });
});

test('COP12 半屏组件：加载更多只在「还有下一页且不在加载中」时抛事件（数据拉取在页面）', () => {
  const c = Object.assign({}, compDef.methods);
  c.data = { detail: null };
  const events = [];
  c.triggerEvent = (name) => events.push(name);

  c.onLoadMore();
  assert.deepEqual(events, [], '没有 detail 不抛');
  c.data.detail = { hasMore: false };
  c.onLoadMore();
  assert.deepEqual(events, [], '没有下一页不抛');
  c.data.detail = { hasMore: true, loadingMore: true };
  c.onLoadMore();
  assert.deepEqual(events, [], '加载中不重复抛');
  c.data.detail = { hasMore: true, loadingMore: false };
  c.onLoadMore();
  assert.deepEqual(events, ['loadmore']);
});

test('COP13 待审批拉取失败：静默（无 toast）、不崩、徽标保住旧值', async () => {
  resetEnv();
  await withSilencedConsole(async () => {
    let pendingShouldFail = false;
    respond = (path) => {
      if (/\/pending$/.test(path)) return pendingShouldFail ? Promise.reject(new Error('网络请求失败')) : Promise.resolve(pendingOf());
      if (/\/leaderboard(\?|$)/.test(path)) return Promise.resolve(boardOf());
      return Promise.resolve(detailOf());
    };
    const page = await openPage();
    assert.equal(page.data.pendingCount, 2);

    pendingShouldFail = true;
    await page.refresh(true);
    await flush();
    assert.equal(page.data.pendingCount, 2, '刷新失败不清掉已有徽标（静默保住旧值）');
    assert.deepEqual(toasts, [], '不弹 toast');
  });
});

test('COP14 成员半屏的明细块对所有成员渲染（不再有发起人分叉）', () => {
  const fs = require('fs');
  const path = require('path');
  const sheet = fs.readFileSync(
    path.join(__dirname, '../miniprogram/components/campaign-member-sheet/campaign-member-sheet.wxml'),
    'utf8',
  );
  assert.match(sheet, /<block wx:if="\{\{detail\}\}">/, '明细块只由 detail 驱动');
  // 组件不再持有查看者身份：页面不传、组件也没这个 property（否则又会分叉出「谁能看」的第二套判据）
  assert.ok(!('isCreator' in compDef.properties), '组件不该再有 isCreator property');
  const pageWxml = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/campaign-detail/campaign-detail.wxml'),
    'utf8',
  );
  assert.ok(!/isCreator="\{\{isCreator\}\}"/.test(pageWxml), '页面不再给半屏传发起人身份');
});
