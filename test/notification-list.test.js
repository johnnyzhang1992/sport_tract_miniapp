/**
 * 消息中心：分类 / 搜索 / 只看未读 / 全部已读 / 消息订阅；
 * 个人中心未读角标与游客态不回归。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
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

const navs = [];
const toasts = [];
let modalConfirm = true;
let modalCalls = 0;
let subscribeResult = { TPL: 'accept' };
let subscribeCalls = 0;

global.wx = {
  navigateTo: (o) => navs.push(o && o.url),
  stopPullDownRefresh: () => {},
  getStorageSync: () => '',
  setStorageSync: () => {},
  showToast: (o) => toasts.push(o && o.title),
  showModal: (o) => {
    modalCalls += 1;
    if (o && o.success) o.success({ confirm: modalConfirm });
  },
  requestSubscribeMessage: (o) => {
    subscribeCalls += 1;
    if (o && o.success) o.success(subscribeResult);
  },
};

let session = true;
const appStub = {
  globalData: { loggedIn: true, api: fakeApi },
  hasSession: () => session,
  login: () => {
    session = true;
    appStub.globalData.loggedIn = true;
    return Promise.resolve();
  },
};
global.getApp = () => appStub;

const defs = [];
global.Page = (def) => defs.push(def);
require('../miniprogram/pages/notification-list/notification-list.js');
require('../miniprogram/pages/my/my.js');
assert.equal(defs.length, 2, '列表页与个人中心各调用一次 Page()');
const listDef = defs[0];
const myDef = defs[1];

function makePage(def) {
  const p = Object.assign({}, def);
  p.data = JSON.parse(JSON.stringify(def.data));
  p.setData = (patch) => Object.assign(p.data, patch);
  return p;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function resetEnv() {
  apiCalls.length = 0;
  navs.length = 0;
  toasts.length = 0;
  session = true;
  appStub.globalData.loggedIn = true;
  modalConfirm = true;
  modalCalls = 0;
  subscribeResult = { TPL: 'accept' };
  subscribeCalls = 0;
  respond = () => Promise.resolve({});
}

function listPayload(overrides = {}) {
  return {
    items: [
      { id: 'n2', title: '会员即将到期', category: 'member', categoryText: '会员服务', publishedAt: Date.now(), read: false },
      { id: 'n1', title: '系统维护', category: 'system', categoryText: '系统通知', publishedAt: Date.now() - 1000, read: true },
    ],
    unreadCount: 1,
    total: 2,
    categories: [
      { key: 'system', label: '系统通知', unreadCount: 0 },
      { key: 'member', label: '会员服务', unreadCount: 1 },
    ],
    ...overrides,
  };
}

test('NL1 列表：登录用户未读点按 read=false 渲染，分类与分类文案下发', async () => {
  resetEnv();
  respond = () => Promise.resolve(listPayload());
  const page = makePage(listDef);
  await page.fetch();
  assert.deepEqual(page.data.items.map((i) => i.unread), [true, false]);
  assert.equal(page.data.items[0].categoryText, '会员服务');
  assert.deepEqual(page.data.categories.map((c) => c.key), ['system', 'member']);
  assert.equal(page.data.hasUnread, true);
  assert.equal(page.data.unreadText, '1 条未读');
});

test('NL2 游客：一律不显示未读点，工具栏不渲染', async () => {
  resetEnv();
  session = false;
  appStub.globalData.loggedIn = false;
  respond = () =>
    Promise.resolve(listPayload({
      items: [{ id: 'n1', title: '公告', category: 'system', categoryText: '系统通知', publishedAt: Date.now(), read: false }],
      unreadCount: 0,
    }));
  const page = makePage(listDef);
  await page.fetch();
  assert.equal(page.data.items[0].unread, false);
  const wxml = read('miniprogram/pages/notification-list/notification-list.wxml');
  assert.ok(
    /wx:if="\{\{loggedIn\}\}"[\s\S]*?class="unread-toggle/.test(wxml),
    '游客不显示只看未读',
  );
  assert.ok(wxml.includes('bindtap="openSubscribe"'), '消息订阅入口游客仍在（点后走登录闸门）');
});

test('NL3 点击列表项 → 带 id 进详情', () => {
  resetEnv();
  const page = makePage(listDef);
  page.goDetail({ currentTarget: { dataset: { id: 'n9' } } });
  assert.deepEqual(navs, ['/pages/notification/notification?id=n9']);
});

test('NL5 一键全读：有未读才出按钮，点了 POST read-all + 重拉 + 回执', async () => {
  resetEnv();
  respond = () => Promise.resolve(listPayload());
  const page = makePage(listDef);
  await page.fetch();
  assert.equal(page.data.hasUnread, true, '有未读 → 按钮出现');

  apiCalls.length = 0;
  respond = () => Promise.resolve(listPayload({ unreadCount: 0, items: [] }));
  await page.onReadAll();
  assert.deepEqual(apiCalls, [
    { method: 'POST', path: '/notifications/read-all', body: {} },
    { method: 'GET', path: '/notifications' },
  ], '先上报全读，再重拉列表');
  assert.equal(page.data.hasUnread, false);
  assert.equal(page.data.unreadText, '');
  assert.ok(toasts.includes('已全部读'), `要有回执，实际 ${JSON.stringify(toasts)}`);
  assert.equal(page.data.readingAll, false, '结束时复位 busy');

  apiCalls.length = 0;
  await page.onReadAll();
  assert.deepEqual(apiCalls, [], '没有未读就不该发请求');
});

test('NL6 分类筛选：选中分类后请求带 category，且再次点同一个不发请求', async () => {
  resetEnv();
  respond = () => Promise.resolve(listPayload());
  const page = makePage(listDef);
  await page.fetch();
  apiCalls.length = 0;

  page.onCategoryTap({ currentTarget: { dataset: { key: 'member' } } });
  await flush();
  assert.deepEqual(apiCalls, [{ method: 'GET', path: '/notifications?category=member' }]);
  assert.equal(page.data.category, 'member');

  apiCalls.length = 0;
  page.onCategoryTap({ currentTarget: { dataset: { key: 'member' } } });
  assert.deepEqual(apiCalls, [], '重复点当前分类不重复请求');

  const wxml = read('miniprogram/pages/notification-list/notification-list.wxml');
  assert.ok(wxml.includes('wx:for="{{categories}}"'), '分类 chips 由服务端下发');
  assert.ok(wxml.includes('data-key="{{item.key}}"'), '点分类要带 key');
  assert.ok(wxml.includes('cat-dot'), '分类有未读时显示红点');
});

test('NL7 搜索：确认才提交，去首尾空格并编码；清空恢复全量', async () => {
  resetEnv();
  respond = () => Promise.resolve(listPayload());
  const page = makePage(listDef);
  await page.fetch();
  apiCalls.length = 0;

  page.onKeywordInput({ detail: { value: ' 到期 ' } });
  assert.deepEqual(apiCalls, [], '只输入不请求');
  page.onSearch();
  await flush();
  assert.deepEqual(apiCalls, [{ method: 'GET', path: `/notifications?q=${encodeURIComponent('到期')}` }]);
  assert.equal(page.data.q, '到期');

  apiCalls.length = 0;
  page.onClearKeyword();
  await flush();
  assert.deepEqual(apiCalls, [{ method: 'GET', path: '/notifications' }]);
  assert.equal(page.data.keyword, '');
  assert.equal(page.data.q, '');

  const wxml = read('miniprogram/pages/notification-list/notification-list.wxml');
  assert.ok(wxml.includes('bindconfirm="onSearch"'), '键盘搜索键要提交');
  assert.ok(wxml.includes('bindinput="onKeywordInput"'), '输入框绑输入事件');
});

test('NL8 只看未读：登录用户切换即请求；游客先登录闸门，取消则不请求', async () => {
  resetEnv();
  respond = () => Promise.resolve(listPayload());
  const page = makePage(listDef);
  await page.fetch();
  apiCalls.length = 0;

  await page.onToggleUnread();
  assert.equal(page.data.unreadOnly, true);
  assert.deepEqual(apiCalls, [{ method: 'GET', path: '/notifications?unread=1' }]);

  resetEnv();
  session = false;
  appStub.globalData.loggedIn = false;
  modalConfirm = false;
  respond = () => Promise.resolve(listPayload());
  const guest = makePage(listDef);
  await guest.fetch();
  apiCalls.length = 0;
  await guest.onToggleUnread();
  assert.equal(modalCalls, 1, '游客点只看未读要弹登录');
  assert.deepEqual(apiCalls, [], '取消登录不发请求');
  assert.equal(guest.data.unreadOnly, false);

  modalConfirm = true;
  await guest.onToggleUnread();
  assert.equal(guest.data.unreadOnly, true);
  assert.deepEqual(apiCalls, [{ method: 'GET', path: '/notifications?unread=1' }], '登录后继续筛选');
});

test('NL9 搜索+分类+未读组合：请求参数同时带上', async () => {
  resetEnv();
  respond = () => Promise.resolve(listPayload());
  const page = makePage(listDef);
  page.setData({ keyword: '到期', q: '到期', category: 'member', unreadOnly: true });
  await page.fetch();
  const last = apiCalls[apiCalls.length - 1];
  assert.equal(
    last.path,
    `/notifications?category=member&q=${encodeURIComponent('到期')}&unread=1`,
  );
});

test('NL10 消息订阅：打开拉取列表；允许后上报授权并置已订阅', async () => {
  resetEnv();
  respond = (p) => {
    if (p === '/notifications/subscriptions') {
      return Promise.resolve({
        items: [{
          key: 'memberExpiry',
          label: '会员到期提醒',
          description: '会员到期前 3 天提醒你续费',
          templateId: 'TPL',
          daysBefore: 3,
          subscribed: false,
        }],
      });
    }
    return Promise.resolve(listPayload());
  };
  const page = makePage(listDef);
  await page.openSubscribe();
  assert.equal(page.data.subscribe.visible, true);
  assert.equal(page.data.subscribe.items.length, 1);
  assert.ok(apiCalls.some((c) => c.method === 'GET' && c.path === '/notifications/subscriptions'));

  apiCalls.length = 0;
  page.onSubscribeTap({ detail: { key: 'memberExpiry', templateId: 'TPL' } });
  await flush();
  assert.equal(subscribeCalls, 1, '要唤起微信订阅授权');
  assert.deepEqual(apiCalls, [{
    method: 'POST',
    path: '/notifications/subscriptions/grant',
    body: { key: 'memberExpiry', scene: 'message_center' },
  }], '用户允许后才上报额度');
  assert.equal(page.data.subscribe.items[0].subscribed, true);
  assert.ok(toasts.includes('已订阅'));
  assert.equal(page.data.subscribe.busy, '');

  page.closeSubscribe();
  assert.equal(page.data.subscribe.visible, false);
});

test('NL15 消息订阅：服务端返回两项时原样展示（会员到期 + 每周运动数据）', async () => {
  resetEnv();
  respond = (p) => {
    if (p === '/notifications/subscriptions') {
      return Promise.resolve({
        items: [
          { key: 'memberExpiry', label: '会员到期提醒', description: '会员到期前 3 天提醒你续费', templateId: 'TPL_M', subscribed: false },
          { key: 'weeklySports', label: '每周运动数据', description: '每周一 09:00 汇总上周运动数据', templateId: 'TPL_W', subscribed: true },
        ],
      });
    }
    return Promise.resolve(listPayload());
  };
  const page = makePage(listDef);
  await page.openSubscribe();
  assert.deepEqual(page.data.subscribe.items.map((i) => i.key), ['memberExpiry', 'weeklySports']);
  assert.equal(page.data.subscribe.items[1].description, '每周一 09:00 汇总上周运动数据');
  assert.equal(page.data.subscribe.items[1].templateId, 'TPL_W');
});

test('NL11 消息订阅：拒绝授权不上报，按钮复位', async () => {
  resetEnv();
  subscribeResult = { TPL: 'reject' };
  respond = (p) =>
    p === '/notifications/subscriptions'
      ? Promise.resolve({ items: [{ key: 'memberExpiry', templateId: 'TPL', subscribed: false }] })
      : Promise.resolve(listPayload());
  const page = makePage(listDef);
  await page.openSubscribe();
  apiCalls.length = 0;
  page.onSubscribeTap({ detail: { key: 'memberExpiry', templateId: 'TPL' } });
  await flush();
  assert.deepEqual(apiCalls, [], '拒绝时不上报授权');
  assert.equal(page.data.subscribe.busy, '');
  assert.ok(toasts.includes('未订阅'));
});

test('NL12 消息订阅：游客先登录；登录失败不打开半屏', async () => {
  resetEnv();
  session = false;
  appStub.globalData.loggedIn = false;
  modalConfirm = false;
  const page = makePage(listDef);
  await page.openSubscribe();
  assert.equal(modalCalls, 1, '游客点消息订阅要弹登录');
  assert.equal(page.data.subscribe.visible, false);
  assert.deepEqual(apiCalls, [], '取消登录不拉订阅列表');
});

test('NL13 结构：搜索框、分类横滑、订阅组件和空态清除筛选都在', () => {
  const wxml = read('miniprogram/pages/notification-list/notification-list.wxml');
  const json = JSON.parse(read('miniprogram/pages/notification-list/notification-list.json'));
  assert.ok(wxml.includes('placeholder="搜索消息"'));
  assert.ok(wxml.includes('<scroll-view class="cat-scroll" scroll-x'));
  assert.ok(wxml.includes('<message-subscribe'));
  assert.ok(wxml.includes('bind:subscribe="onSubscribeTap"'));
  assert.ok(wxml.includes('清除筛选'));
  assert.equal(json.usingComponents['message-subscribe'], '/components/message-subscribe/message-subscribe');
});

test('NL14 结构：只看未读与消息订阅都收进消息通知列工具行，搜索行不再放订阅', () => {
  const wxml = read('miniprogram/pages/notification-list/notification-list.wxml');
  const topbarStart = wxml.indexOf('<view class="topbar">');
  const topbarEnd = wxml.indexOf('<!-- 消息分类');
  assert.ok(topbarStart >= 0 && topbarEnd > topbarStart);
  const topbar = wxml.slice(topbarStart, topbarEnd);
  assert.ok(!topbar.includes('openSubscribe'), '消息订阅不再占搜索行');

  const toolbarStart = wxml.indexOf('<view class="toolbar">');
  const toolbarEnd = wxml.indexOf('<view wx:if="{{loading');
  assert.ok(toolbarStart >= 0 && toolbarEnd > toolbarStart);
  const toolbar = wxml.slice(toolbarStart, toolbarEnd);
  assert.ok(toolbar.includes('bindtap="onToggleUnread"'), '只看未读在工具行');
  assert.ok(toolbar.includes('bindtap="openSubscribe"'), '消息订阅在工具行');
  const subscribeTag = toolbar.match(/<view[^>]*class="subscribe-link"[^>]*>/);
  assert.ok(subscribeTag, '找到消息订阅标签');
  assert.ok(!subscribeTag[0].includes('wx:if'), '消息订阅不跟登录态一起隐藏');
});

test('NL4 列表日期按东八区格式化（设备时区不是 +8 也不变）', () => {
  resetEnv();
  process.env.TZ = 'UTC';
  const page = makePage(listDef);
  assert.equal(page.fmtDate(Date.UTC(2026, 9, 18, 16, 30)), '2026-10-19');
});

test('NM1 个人中心：unreadCount>0 时角标有数', async () => {
  resetEnv();
  respond = () => Promise.resolve({ item: null, unreadCount: 3 });
  const page = makePage(myDef);
  await page.loadUnread();
  assert.equal(page.data.unreadCount, 3);
});

test('NM2 游客个人中心：入口仍在，角标为 0', async () => {
  resetEnv();
  session = false;
  appStub.globalData.loggedIn = false;
  respond = () => Promise.resolve({ item: null, unreadCount: 0 });
  const page = makePage(myDef);
  await page.loadUnread();
  assert.equal(page.data.unreadCount, 0);
});
