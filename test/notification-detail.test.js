/**
 * 通知详情页：登录用户加载成功后上报已读并置 notificationDirty；游客零 POST；失败静默。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const apiCalls = [];
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

global.wx = {
  showLoading: () => {},
  hideLoading: () => {},
  setNavigationBarTitle: () => {},
};

let session = true;
const appStub = {
  globalData: { loggedIn: true, notificationDirty: false, api: fakeApi },
  hasSession: () => session,
};
global.getApp = () => appStub;

let pageDef = null;
global.Page = (def) => { pageDef = def; };
require('../miniprogram/pages/notification/notification.js');
assert.ok(pageDef, 'notification.js 应通过 Page() 交出页面对象');

const flush = () => new Promise((r) => setTimeout(r, 0));

function makePage() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch) => Object.assign(p.data, patch);
  return p;
}

function resetEnv() {
  apiCalls.length = 0;
  session = true;
  appStub.globalData.notificationDirty = false;
  respond = () => Promise.resolve({});
}

test('ND1 登录：加载详情后上报已读并置 notificationDirty', async () => {
  resetEnv();
  respond = (p) =>
    p === '/notifications/n1'
      ? Promise.resolve({ id: 'n1', title: '停机维护', content: '第一行\n第二行', publishedAt: Date.now() })
      : Promise.resolve({ unreadCount: 0 });
  const page = makePage();
  page.onLoad({ id: 'n1' });
  await flush();

  assert.equal(page.data.notice.content, '第一行\n第二行', '换行原样保留');
  assert.ok(apiCalls.some((c) => c.method === 'POST' && c.path === '/notifications/n1/read'));
  assert.equal(appStub.globalData.notificationDirty, true, '读完通知要让首页补拉');
});

test('ND2 游客：只读详情，不发已读请求', async () => {
  resetEnv();
  session = false;
  respond = () => Promise.resolve({ id: 'n1', title: '公告', content: '正文', publishedAt: Date.now() });
  const page = makePage();
  page.onLoad({ id: 'n1' });
  await flush();
  assert.equal(apiCalls.filter((c) => c.method === 'POST').length, 0);
  assert.equal(appStub.globalData.notificationDirty, false);
});

test('ND3 已读上报失败：内容照常展示、静默、不置 dirty', async () => {
  resetEnv();
  respond = (p) => {
    if (p === '/notifications/n1') return Promise.resolve({ id: 'n1', title: '公告', content: '正文', publishedAt: Date.now() });
    return Promise.reject(new Error('down'));
  };
  const page = makePage();
  page.onLoad({ id: 'n1' });
  await flush();
  assert.equal(page.data.notice.title, '公告');
  assert.equal(appStub.globalData.notificationDirty, false);
});

test('ND4 非法 id：不发请求，进错误态', async () => {
  resetEnv();
  const page = makePage();
  page.onLoad({ id: '' });
  await flush();
  assert.deepEqual(apiCalls, []);
  assert.equal(page.data.failed, true);
});

test('ND5 404：错误态区分「通知不存在」，不是可重试的加载失败', async () => {
  resetEnv();
  respond = () => Promise.reject(Object.assign(new Error('通知不存在'), { statusCode: 404 }));
  const page = makePage();
  page.onLoad({ id: 'gone' });
  await flush();
  assert.equal(page.data.failed, true);
  assert.equal(page.data.notFound, true, '404 要给返回而不是重试');
});

test('ND6 发布时间按东八区格式化（设备时区不是 +8 也不变）', () => {
  resetEnv();
  process.env.TZ = 'UTC';
  const page = makePage();
  assert.equal(page.fmtDate(Date.UTC(2026, 9, 18, 16, 30)), '2026-10-19 00:30');
});
