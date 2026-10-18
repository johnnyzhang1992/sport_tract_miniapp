/**
 * 历史消息列表 + 个人中心消息入口：
 * 未读点只对登录用户且 read=false 渲染；个人中心 unreadCount>0 显示角标，游客入口在、角标 0。
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
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const navs = [];
global.wx = {
  navigateTo: (o) => navs.push(o && o.url),
  stopPullDownRefresh: () => {},
  getStorageSync: () => '',
  setStorageSync: () => {},
};

let session = true;
const appStub = {
  globalData: { loggedIn: true, api: fakeApi },
  hasSession: () => session,
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

function resetEnv() {
  apiCalls.length = 0;
  navs.length = 0;
  session = true;
  respond = () => Promise.resolve({});
}

test('NL1 列表：登录用户未读点按 read=false 渲染', async () => {
  resetEnv();
  respond = () =>
    Promise.resolve({
      items: [
        { id: 'n2', title: '新通知', publishedAt: Date.now(), read: false },
        { id: 'n1', title: '旧通知', publishedAt: Date.now() - 1000, read: true },
      ],
      unreadCount: 1,
    });
  const page = makePage(listDef);
  await page.fetch();
  assert.deepEqual(page.data.items.map((i) => i.unread), [true, false]);
});

test('NL2 游客：一律不显示未读点', async () => {
  resetEnv();
  session = false;
  respond = () =>
    Promise.resolve({
      items: [{ id: 'n1', title: '公告', publishedAt: Date.now(), read: false }],
      unreadCount: 0,
    });
  const page = makePage(listDef);
  await page.fetch();
  assert.equal(page.data.items[0].unread, false);
});

test('NL3 点击列表项 → 带 id 进详情', () => {
  resetEnv();
  const page = makePage(listDef);
  page.goDetail({ currentTarget: { dataset: { id: 'n9' } } });
  assert.deepEqual(navs, ['/pages/notification/notification?id=n9']);
});

test('NM1 个人中心：unreadCount>0 时角标有数', async () => {
  resetEnv();
  respond = () => Promise.resolve({ item: null, unreadCount: 3 });
  const page = makePage(myDef);
  await page.loadUnread();
  assert.equal(page.data.unreadCount, 3);
});

test('NL4 列表日期按东八区格式化（设备时区不是 +8 也不变）', () => {
  resetEnv();
  process.env.TZ = 'UTC';
  const page = makePage(listDef);
  assert.equal(page.fmtDate(Date.UTC(2026, 9, 18, 16, 30)), '2026-10-19');
});

test('NM2 游客个人中心：入口仍在，角标为 0', async () => {
  resetEnv();
  session = false;
  respond = () => Promise.resolve({ item: null, unreadCount: 0 });
  const page = makePage(myDef);
  await page.loadUnread();
  assert.equal(page.data.unreadCount, 0);
});
