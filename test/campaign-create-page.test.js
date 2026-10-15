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
    apiCalls.push({ path: p, body });
    return respond(p, body);
  },
  get() {
    return Promise.resolve({});
  },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const toasts = [];
const navs = [];
const modals = [];
let modalConfirm = false; // 登录闸门弹窗：默认取消（游客态用例自己改成确认）
let loginCalls = 0;
global.wx = {
  showToast: (o) => toasts.push(o && o.title),
  navigateTo: (o) => navs.push(o && o.url),
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
