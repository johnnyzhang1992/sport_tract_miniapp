/**
 * 创建活动页（pages/campaign-create/campaign-create.js）页级回归。
 *
 * 前端必须把服务端 CreateCampaignSchema（sport_track_api/src/utils/validators.ts）的上限镜像出来：
 * 违反时给「对象 + 实际值 + 上限」的提示且一个请求都不发，合法表单才 POST /campaigns，成功后带 id 跳详情。
 * 这里只断言表单校验与请求体（不测 UI 渲染）。
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
let respond = () => Promise.resolve({ id: 'cp1' });
const fakeApi = {
  post(p, body) {
    apiCalls.push({ method: 'POST', path: p, body });
    return respond(p, body);
  },
  put(p, body) {
    apiCalls.push({ method: 'PUT', path: p, body });
    return respond(p, body);
  },
  get(p) {
    apiCalls.push({ method: 'GET', path: p, body: null });
    return respond(p, null);
  },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const toasts = [];
const navs = [];
const navBacks = [];
const navTitles = [];
const modals = [];
let modalConfirm = false; // 登录闸门弹窗：默认取消（游客态用例自己改成确认）
let loginCalls = 0;
global.wx = {
  showToast: (o) => toasts.push(o && o.title),
  navigateTo: (o) => navs.push(o && o.url),
  navigateBack: (o) => navBacks.push(o || {}),
  setNavigationBarTitle: (o) => navTitles.push(o && o.title),
  showModal: (o) => {
    modals.push(o);
    if (o && o.success) o.success({ confirm: modalConfirm });
  },
};

const appStub = {
  globalData: { loggedIn: true },
  login() {
    loginCalls++;
    appStub.globalData.loggedIn = true;
    return Promise.resolve({});
  },
};
global.getApp = () => appStub;

let pageDef = null;
global.Page = (def) => { pageDef = def; };

require('../miniprogram/pages/campaign-create/campaign-create.js');
assert.ok(pageDef, 'campaign-create.js 应通过 Page() 交出页面对象');

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
  navBacks.length = 0;
  navTitles.length = 0;
  modals.length = 0;
  modalConfirm = false;
  loginCalls = 0;
  respond = () => Promise.resolve({ id: 'cp1' });
  appStub.globalData.loggedIn = true;
}

/** 合法表单基线（用例只覆盖要变化的字段） */
function legal(o = {}) {
  return Object.assign({
    title: '周末一起去徒步',
    description: '走西湖群山',
    visibility: 'private',
    allowedTypes: ['hiking', 'walking'],
    memberLimit: '20',
    startDate: '2026-10-01',
    endDate: '2026-10-07',
  }, o);
}

/* ---------------------------------- 用例 ---------------------------------- */

test('CCP1 标题为空 → 不提交，toast 点名对象与实际值', async () => {
  resetEnv();
  const page = makePage();
  Object.assign(page.data, legal({ title: '   ' }));
  await page.onSubmit();
  assert.equal(apiCalls.length, 0, '标题不合法时一个请求都不发');
  assert.equal(navs.length, 0);
  assert.ok(toasts.length >= 1, '要给用户具体提示');
  assert.match(toasts[0], /标题/, `提示要点名对象：${toasts[0]}`);
});

test('CCP2 结束日期早于开始日期 → 不提交，toast 给出两个实际值', async () => {
  resetEnv();
  const page = makePage();
  Object.assign(page.data, legal({ startDate: '2026-10-05', endDate: '2026-10-01' }));
  await page.onSubmit();
  assert.equal(apiCalls.length, 0, '日期倒置时一个请求都不发');
  assert.ok(toasts.length >= 1);
  assert.match(toasts[0], /日期/, `提示要点名对象：${toasts[0]}`);
  assert.match(toasts[0], /2026\/10\/05/, '要带上开始日期实际值（展示层用「/」）');
  assert.match(toasts[0], /2026\/10\/01/, '要带上结束日期实际值（展示层用「/」）');
});

test('CCP3 合法表单 → POST /campaigns 且请求体字段完整，成功后带 id 跳详情', async () => {
  resetEnv();
  respond = () => Promise.resolve({ id: 'cmp-abc' });
  const page = makePage();
  Object.assign(page.data, legal());
  appStub.globalData.homeDirty = false;
  await page.onSubmit();
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].path, '/campaigns');
  assert.deepEqual(apiCalls[0].body, {
    title: '周末一起去徒步',
    description: '走西湖群山',
    visibility: 'private',
    allowedTypes: ['hiking', 'walking'],
    memberLimit: 20, // 数字而非字符串：服务端 schema 是 z.number().int()
    startDate: '2026-10-01',
    endDate: '2026-10-07',
  });
  assert.equal(toasts[toasts.length - 1], '活动已创建');
  assert.equal(navs[navs.length - 1], '/pages/campaign-detail/campaign-detail?id=cmp-abc');
  assert.equal(appStub.globalData.homeDirty, true, '新建后首页区块要多一条：要标脏让它重拉');
});

test('CCP4 人数上限超 500 → 不提交，toast 给对象+实际值+上限', async () => {
  resetEnv();
  const page = makePage();
  Object.assign(page.data, legal({ memberLimit: '501' }));
  await page.onSubmit();
  assert.equal(apiCalls.length, 0, '超上限时一个请求都不发');
  assert.match(toasts[0], /人数/, `提示要点名对象：${toasts[0]}`);
  assert.match(toasts[0], /501/, '要带实际值');
  assert.match(toasts[0], /500/, '要带上限');
});

test('CCP5 空选运动类型＝不限制、不填人数＝null：请求体照实发', async () => {
  resetEnv();
  const page = makePage();
  Object.assign(page.data, legal({ allowedTypes: [], memberLimit: '' }));
  await page.onSubmit();
  assert.equal(apiCalls.length, 1);
  assert.deepEqual(apiCalls[0].body.allowedTypes, [], '空选＝不限制，发空数组');
  assert.equal(apiCalls[0].body.memberLimit, null, '不填人数＝不限制，发 null');
});

test('CCP6 游客取消登录闸门 → 表单合法也不提交', async () => {
  resetEnv();
  appStub.globalData.loggedIn = false;
  modalConfirm = false;
  const page = makePage();
  Object.assign(page.data, legal());
  await page.onSubmit();
  assert.equal(modals.length, 1, '游客要先弹登录闸门');
  assert.equal(loginCalls, 0, '取消登录不调用 app.login');
  assert.equal(apiCalls.length, 0, '登录闸门未通过 → 一个请求都不发');
});

test('CCP7 提交失败 → toast e.message 且不跳转', async () => {
  resetEnv();
  respond = () => Promise.reject(new Error('标题含违规内容'));
  const page = makePage();
  Object.assign(page.data, legal());
  await page.onSubmit();
  assert.equal(navs.length, 0, '失败不跳详情');
  assert.equal(toasts[toasts.length - 1], '标题含违规内容');
});

test('CCP8 成功后复位 submitting：返回创建页按钮不再锁死，可再次提交', async () => {
  resetEnv();
  respond = () => Promise.resolve({ id: 'cmp-resubmit' });
  const page = makePage();
  Object.assign(page.data, legal());
  await page.onSubmit();
  assert.equal(apiCalls.length, 1, '首次提交发一次请求');
  // 成功分支走的是 wx.navigateTo（推送详情页），创建页仍留在栈里；
  // 若不复位 submitting，用户返回后按钮会永久 disabled/loading，onSubmit 被守卫短路。
  assert.equal(page.data.submitting, false, '成功后必须复位 submitting，否则从详情页返回后按钮永久锁死');

  // 模拟用户从详情页返回创建页后再次点击提交
  await page.onSubmit();
  assert.equal(apiCalls.length, 2, '复位后第二次 onSubmit 应能再次发出请求（不锁死）');
  assert.equal(page.data.submitting, false, '第二次成功后同样复位');
});

test('CCP9 登录闸门未通过（早退）也复位 submitting，不锁死', async () => {
  resetEnv();
  appStub.globalData.loggedIn = false;
  modalConfirm = false;
  const page = makePage();
  Object.assign(page.data, legal());
  await page.onSubmit();
  assert.equal(apiCalls.length, 0, '登录闸门未通过 → 一个请求都不发');
  assert.equal(page.data.submitting, false, '早退分支必须复位 submitting，否则本页没有任何等价的重置路径');
});

test('CCP10 描述上限 120 字：超一个字就不提交，toast 给对象+实际值+上限', async () => {
  resetEnv();
  const page = makePage();
  assert.equal(page.data.maxDesc, 120, '页面上限必须与服务端 CreateCampaignSchema 的 120 对齐');

  Object.assign(page.data, legal({ description: '字'.repeat(120) }));
  await page.onSubmit();
  assert.equal(apiCalls.length, 1, '恰好 120 字应照常提交');

  resetEnv();
  const page2 = makePage();
  Object.assign(page2.data, legal({ description: '字'.repeat(121) }));
  await page2.onSubmit();
  assert.equal(apiCalls.length, 0, '超上限时一个请求都不发');
  assert.match(toasts[0], /描述/, `提示要点名对象：${toasts[0]}`);
  assert.match(toasts[0], /121/, '要带实际值');
  assert.match(toasts[0], /120/, '要带上限');
});

test('CCP11 可见性说明文案：公开＝被邀请人自动加入（不再是「可搜索」）', async () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../miniprogram/pages/campaign-create/campaign-create.wxml'),
    'utf8',
  );
  assert.match(src, /公开：被邀请人自动加入/, '公开的说明要写清是「自动加入」');
  assert.match(src, /隐私：需发起人同意后才能加入/, '隐私的说明要与公开对偶（差异在「要不要审批」，不是「能不能被发现」）');
  assert.doesNotMatch(src, /可搜索/, '没有活动广场，不能再写「可搜索并加入」');
});

test('CCP12 人数上限默认 100：进页就预填，直接提交即为数字 100', async () => {
  resetEnv();
  const page = makePage();
  assert.equal(page.data.memberLimit, '100', '进页默认预填 100（清空＝不限制）');
  assert.equal(page.data.defaultMembers, 100, '默认值只有一个来源，说明文案也从它渲染');
  Object.assign(page.data, legal({ memberLimit: page.data.memberLimit }));
  await page.onSubmit();
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].body.memberLimit, 100, '默认 100 要作为数字上送，不能漏成 null');
});

test('CCP13 必填项（标题）没填完 → canSubmit=false，按钮不可点；填好才转 true', () => {
  resetEnv();
  const page = makePage();
  page.onLoad(); // 真机进页走 onLoad：预填起止日期
  assert.equal(page.data.canSubmit, false, '进页标题为空 → 按钮不可点');

  page.onTitle({ detail: { value: '   ' } });
  assert.equal(page.data.canSubmit, false, '只输空白字符不算填写（与 onSubmit 的 trim 口径一致）');

  page.onTitle({ detail: { value: '周末一起去徒步' } });
  assert.equal(page.data.canSubmit, true, '必填项齐备 → 按钮可点');

  page.onTitle({ detail: { value: '' } });
  assert.equal(page.data.canSubmit, false, '清空标题后回到不可点');
});

test('CCP14 发起按钮的 disabled 由 submitting 与 !canSubmit 共同驱动', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../miniprogram/pages/campaign-create/campaign-create.wxml'),
    'utf8',
  );
  assert.match(
    src,
    /disabled="\{\{[^"]*!canSubmit[^"]*\}\}"/,
    '必填项没填完时按钮必须 disabled（否则点了只会被 onSubmit 的 toast 拦下，等于给了个能点的假按钮）',
  );
});

test('CCP15 创建页日期展示用「/」，但 picker 值与上送值仍是 YYYY-MM-DD', async () => {
  resetEnv();
  const page = makePage();
  page.onLoad();
  assert.match(page.data.startDateText, /^\d{4}\/\d{2}\/\d{2}$/, '进页预填的日期也要按「/」展示');

  page.onStartDate({ detail: { value: '2026-10-01' } });
  page.onEndDate({ detail: { value: '2026-10-07' } });
  assert.equal(page.data.startDateText, '2026/10/01', '展示层用「/」');
  assert.equal(page.data.endDateText, '2026/10/07');
  // 关键：展示格式不能污染上送值 —— 服务端 campaignDateField 是严格 YYYY-MM-DD，picker 也要求这个格式
  assert.equal(page.data.startDate, '2026-10-01', 'picker 值/上送值保持 YYYY-MM-DD');
  assert.equal(page.data.endDate, '2026-10-07');

  // 倒置的即时提示里那对实际值同样走展示格式，别和屏上其它日期分叉
  page.onStartDate({ detail: { value: '2026-10-05' } });
  page.onEndDate({ detail: { value: '2026-10-01' } });
  assert.match(page.data.dateError, /2026\/10\/01 < 2026\/10\/05/, `即时提示也要用「/」：${page.data.dateError}`);
});

test('CCP16 日期展示格式只有一个来源（utils 的 slashDate），别各处自己 replace', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../miniprogram/pages/campaign-create/campaign-create.js'),
    'utf8',
  );
  assert.match(src, /slashDate\(/, '创建页的日期展示要复用 utils/campaign.js 的 slashDate');
  assert.doesNotMatch(src, /replace\(\/-\//, '不要在页面里自己写 replace 换分隔符（会与 utils 的口径分叉）');
});

/* ------------------------------ 编辑模式（?id=） ------------------------------
 * 同一个页面兼任「编辑活动」：带 id 进页 → GET 详情预填 → PUT /campaigns/:id。
 * 服务端 UpdateCampaignSchema 是 .strict()，多传 startDate 会整请求 400，所以请求体
 * 里绝不能出现 startDate（开始时间不可改是产品口径，不是漏填）。
 * --------------------------------------------------------------------------- */

/** GET /campaigns/:id 的响应桩：字段名与服务端 CampaignDetailDto 对齐 */
function detailDto(o = {}) {
  return Object.assign({
    id: 'cmp-abc',
    title: '原标题',
    description: '原描述',
    visibility: 'private',
    allowedTypes: ['hiking'],
    memberLimit: 20,
    startAt: Date.parse('2026-10-01T00:00:00+08:00'),
    endAt: Date.parse('2026-10-08T00:00:00+08:00'),
    startDate: '2026-10-01',
    endDate: '2026-10-07',
    status: 'active',
    creatorId: 'u-me',
    myState: 'joined',
    canJoin: false,
  }, o);
}

test('CCP17 带 id 进页＝编辑模式：拉详情预填六个字段，chips 与 canSubmit 跟着落地', async () => {
  resetEnv();
  respond = (p) => (p === '/campaigns/cmp-abc' ? Promise.resolve(detailDto()) : Promise.resolve({}));
  const page = makePage();
  await page.onLoad({ id: 'cmp-abc' });

  assert.deepEqual(
    apiCalls.map((c) => [c.method, c.path]),
    [['GET', '/campaigns/cmp-abc']],
    '进页只该发一次详情请求',
  );
  assert.equal(page.data.isEdit, true);
  assert.equal(page.data.editId, 'cmp-abc');
  assert.equal(page.data.title, '原标题');
  assert.equal(page.data.description, '原描述');
  assert.equal(page.data.visibility, 'private');
  assert.equal(page.data.memberLimit, '20', '人数上限在页面上是字符串（输入框的值）');
  assert.deepEqual(page.data.allowedTypes, ['hiking']);
  assert.equal(page.data.types.filter((t) => t.active).length, 1, '类型 chips 要按 allowedTypes 点亮');
  assert.equal(page.data.startDate, '2026-10-01', '开始日期取服务端下发的字符串，端上不做时区换算');
  assert.equal(page.data.endDate, '2026-10-07');
  assert.equal(page.data.canSubmit, true, '预填后标题非空 → 按钮应可点');
  assert.deepEqual(navTitles, ['编辑活动'], '编辑态要把导航标题改掉，否则用户不知道自己在改而不是在建');
});

test('CCP18 编辑提交走 PUT /campaigns/:id，请求体六字段齐、且绝不含 startDate', async () => {
  resetEnv();
  respond = (p, body) => (body ? Promise.resolve(detailDto(body)) : Promise.resolve(detailDto()));
  const page = makePage();
  await page.onLoad({ id: 'cmp-abc' });
  apiCalls.length = 0;

  page.onTitle({ detail: { value: '改后的标题' } });
  page.onEndDate({ detail: { value: '2026-10-09' } });
  await page.onSubmit();

  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].method, 'PUT');
  assert.equal(apiCalls[0].path, '/campaigns/cmp-abc');
  assert.deepEqual(apiCalls[0].body, {
    title: '改后的标题',
    description: '原描述',
    visibility: 'private',
    allowedTypes: ['hiking'],
    memberLimit: 20,
    endDate: '2026-10-09',
  });
  assert.ok(!('startDate' in apiCalls[0].body), '上送 startDate 会被服务端 .strict() 整请求 400');
});

test('CCP19 编辑成功 → toast + navigateBack（回到详情页由它自己刷新），不再 navigateTo 详情', async () => {
  resetEnv();
  respond = (p, body) => (body ? Promise.resolve(detailDto(body)) : Promise.resolve(detailDto()));
  const page = makePage();
  await page.onLoad({ id: 'cmp-abc' });
  appStub.globalData.homeDirty = false;
  await page.onSubmit();
  assert.equal(toasts[toasts.length - 1], '已保存');
  assert.equal(navBacks.length, 1, '编辑是从详情页进来的，成功后应退回而不是再压一层详情页');
  assert.equal(navs.length, 0);
  assert.equal(appStub.globalData.homeDirty, true, '编辑后首页卡片(标题等)可能变了：要标脏让它重拉');
  assert.equal(page.data.submitting, false, '成功分支必须复位，否则返回后按钮永久锁死');
});

test('CCP20 编辑保存失败 → toast 服务端文案、复位 submitting、不返回（留在页上改）', async () => {
  resetEnv();
  respond = (p, body) =>
    body ? Promise.reject(Object.assign(new Error('人数上限不能小于当前已占用的 3 人（收到 2）'), { statusCode: 400 }))
      : Promise.resolve(detailDto());
  const page = makePage();
  await page.onLoad({ id: 'cmp-abc' });
  await page.onSubmit();
  assert.match(toasts[toasts.length - 1], /人数上限/, `要原样把服务端的具体提示给用户：${toasts[toasts.length - 1]}`);
  assert.equal(navBacks.length, 0, '没保存成功不能退出页面，用户改不动就得留在原地');
  assert.equal(page.data.submitting, false);
});

test('CCP21 预填请求失败（非发起人 / 已解散 / 断网）→ toast + 返回，不留下半张假表单', async () => {
  resetEnv();
  respond = () => Promise.reject(Object.assign(new Error('只有发起人可以操作'), { statusCode: 403 }));
  const page = makePage();
  await page.onLoad({ id: 'cmp-abc' });
  assert.match(toasts[toasts.length - 1], /发起人/);
  assert.equal(navBacks.length, 1);
  assert.equal(page.data.canSubmit, false, '没拿到数据时按钮不能可点');

  // 拿不到数据后即使被强行 onSubmit，也不该发出 PUT（页面上不该有「保存」这条路）
  apiCalls.length = 0;
  await page.onSubmit();
  assert.equal(apiCalls.filter((c) => c.method === 'PUT').length, 0);
});

test('CCP22 编辑模式仍在前端拦日期倒置：拿预填的开始日期比，一个请求都不发', async () => {
  resetEnv();
  respond = (p) => (p === '/campaigns/cmp-abc' ? Promise.resolve(detailDto()) : Promise.resolve({}));
  const page = makePage();
  await page.onLoad({ id: 'cmp-abc' });
  apiCalls.length = 0;

  page.onEndDate({ detail: { value: '2026-09-30' } });
  await page.onSubmit();
  assert.equal(apiCalls.length, 0, '结束早于开始不该发请求');
  assert.match(toasts[0], /2026\/09\/30/);
  assert.match(toasts[0], /2026\/10\/01/, '提示要带上那个只读的开始日期，用户才知道为什么不行');
});

test('CCP23 开始日期在编辑态只读（只靠置灰表达，箭头保留、不加说明文案）、按钮文案随模式切换', () => {
  const path = require('path');
  const src = require('fs').readFileSync(
    path.join(__dirname, '../miniprogram/pages/campaign-create/campaign-create.wxml'),
    'utf8',
  );
  const css = require('fs').readFileSync(
    path.join(__dirname, '../miniprogram/pages/campaign-create/campaign-create.wxss'),
    'utf8',
  );
  assert.match(src, /<picker\s+mode="date"[^>]*disabled="\{\{isEdit\}\}"/, '开始日期的 picker 要在编辑态 disabled');
  assert.match(
    src,
    /class="fval \{\{isEdit \? 'fval-off'/,
    '只读靠值本身换色表达，不靠旁边补一句说明',
  );
  // 类名写了没样式＝静默失效（框架默认样式压页面样式这类坑踩过），所以两头都钉
  assert.match(css, /\.fval-off\s*\{[^}]*color:/, '.fval-off 必须真的定义了颜色');
  assert.doesNotMatch(src, /不可修改/, '按用户口径砍掉说明文案：置灰本身已经表达「点不动」');
  assert.match(
    src,
    /\{\{[^{}]*isEdit \? '保存修改' : '发起活动'/,
    '按钮文案随模式切换（编辑态写「保存修改」，别让用户以为又建了一个活动）',
  );

  // 箭头不摘：两行日期版式保持一致，只读只靠置灰表达（用户明确要保留 ›）
  const startBlock = src.slice(src.indexOf('value="{{startDate}}"'), src.indexOf('value="{{endDate}}"'));
  assert.match(
    startBlock,
    /<view class="farrow">›<\/view>/,
    '开始日期行的 › 要无条件渲染，编辑态也保留（别被「不可点就不该给箭头」的直觉改掉）',
  );
});

test('CCP24 不带 id 仍是创建模式：不发 GET、isEdit=false、提交走 POST', async () => {
  resetEnv();
  const page = makePage();
  await page.onLoad({});
  assert.equal(page.data.isEdit, false);
  assert.equal(apiCalls.length, 0, '创建模式进页不发任何请求');
  assert.equal(navTitles.length, 0, '创建模式不改导航标题');

  Object.assign(page.data, legal());
  await page.onSubmit();
  assert.equal(apiCalls[0].method, 'POST');
  assert.equal(apiCalls[0].path, '/campaigns');
});


/* ------------------------- 跨度上限（与服务端 assertCampaignSpan 同一条线） ------------------------- */

/** YYYY-MM-DD + n 个日历日（测试侧独立实现一遍，不复用页面里的 helper） */
function plusDays(dateStr, n) {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

test('CCP21 结束日期选择器要封顶：maxEndDate = 开始日期 + 364（含首尾正好 365 天）', async () => {
  resetEnv();
  const page = makePage();
  await page.onLoad({});
  assert.equal(page.data.maxEndDate, plusDays(page.data.startDate, 364), '进页默认态就要算出上界');

  page.onStartDate({ detail: { value: '2026-01-01' } });
  assert.equal(page.data.maxEndDate, '2026-12-31', '2026 是闰年：+364 天落在 12-31');
  page.onStartDate({ detail: { value: '2027-01-01' } });
  assert.equal(page.data.maxEndDate, '2027-12-31', '平年同样落在 12-31');
});

test('CCP22 编辑态预填也带上 maxEndDate（否则选择器没有上界，能一路划到两年后）', async () => {
  resetEnv();
  respond = (p) => (p === '/campaigns/cmp-abc' ? Promise.resolve(detailDto()) : Promise.resolve({}));
  const page = makePage();
  await page.onLoad({ id: 'cmp-abc' });
  assert.equal(page.data.startDate, '2026-10-01');
  assert.equal(page.data.maxEndDate, '2027-09-30', '开始日期 + 364 天');
});

test('CCP23 跨度超一年 → 不提交，toast 带实际天数与上限（一个请求都不发）', async () => {
  resetEnv();
  const page = makePage();
  Object.assign(page.data, legal({ startDate: '2026-01-01', endDate: '2027-01-01' }));
  await page.onSubmit();
  assert.equal(apiCalls.length, 0, '超跨度时不该发请求');
  assert.ok(toasts.length >= 1, JSON.stringify(toasts));
  assert.match(toasts[toasts.length - 1], /365/, `要说明上限：${toasts[toasts.length - 1]}`);
  assert.match(toasts[toasts.length - 1], /366/, `要报出实际跨了多少天：${toasts[toasts.length - 1]}`);

  // 收回到正好 365 天要放行（边界不能被端上多砍一格）
  resetEnv();
  const ok = makePage();
  Object.assign(ok.data, legal({ startDate: '2026-01-01', endDate: '2026-12-31' }));
  await ok.onSubmit();
  assert.equal(apiCalls.length, 1, '正好 365 天该提交出去');
});

test('CCP24 结束日期 picker 必须挂上 end 上界', () => {
  const fs = require('fs');
  const path = require('path');
  const wxml = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/campaign-create/campaign-create.wxml'),
    'utf8',
  ).replace(/<!--[\s\S]*?-->/g, '');
  assert.match(wxml, /mode="date"[^>]*end="\{\{maxEndDate\}\}"/, '结束日期选择器要绑上界');
});
