/**
 * 照片管理页（2026-11-05）：
 * 1) 结构：app.json 注册；设置页额度卡与会员页额度行都能进；
 * 2) 额度渲染：普通/会员/超额三种读数都按服务端下发显示；
 * 3) 选择与删除：按「来源+分组」聚合 refs 提交，删除成功重新拉总览。
 * 桩：wx / Page 就地 stub，services/api、services/storage、utils/login-gate 用 require.cache 注入。
 * 运行：node --test test/photos-page.test.js；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('PH1 结构：app.json 注册照片管理页，设置页与会员页都有入口', () => {
  const app = JSON.parse(read('miniprogram/app.json'));
  assert.ok(app.pages.includes('pages/photos/photos'));
  assert.ok(read('miniprogram/pages/settings/settings.wxml').includes('bindtap="goPhotos"'));
  assert.ok(read('miniprogram/pages/member/member.wxml').includes('bindtap="goPhotos"'));
  assert.ok(read('miniprogram/pages/settings/settings.js').includes("'/pages/photos/photos'"));
  assert.ok(read('miniprogram/pages/member/member.js').includes("'/pages/photos/photos'"));
});

/* --------------------------------- 环境桩 --------------------------------- */

let apiGets = [];
let apiPosts = [];
let listRespond = null;
let postRespond = null;
let modals = [];
let toasts = [];
let token = { accessToken: 't' };
let navs = [];

const fakeApi = {
  get(p) { apiGets.push(p); return listRespond(p); },
  post(p, body) { apiPosts.push({ p, body }); return postRespond(p, body); },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };
const storagePath = require.resolve('../miniprogram/services/storage.js');
require.cache[storagePath] = {
  id: storagePath, filename: storagePath, loaded: true, exports: { getToken: () => token }, children: [], paths: [],
};
const loginGatePath = require.resolve('../miniprogram/utils/login-gate.js');
require.cache[loginGatePath] = {
  id: loginGatePath, filename: loginGatePath, loaded: true,
  exports: { ensureLogin: () => { token = { accessToken: 't2' }; return Promise.resolve(true); } }, children: [], paths: [],
};

let modalConfirm = true;
global.wx = {
  showToast: (o) => toasts.push(o && o.title),
  showModal: (o) => { modals.push({ title: o && o.title, content: o && o.content }); if (o && o.success) o.success({ confirm: modalConfirm }); },
  previewImage: (o) => { navs.push(['preview', o && o.current]); global.__lastPreview = o || {}; },
  navigateTo: (o) => navs.push(['nav', o && o.url]),
  stopPullDownRefresh: () => {},
};

let pageDef = null;
global.Page = (d) => { pageDef = d; };
require('../miniprogram/pages/photos/photos.js');
assert.ok(pageDef, 'photos.js 应通过 Page() 交出页面对象');

const tick = () => new Promise((r) => setImmediate(r));

function fixture(over) {
  return {
    used: 3, limit: 50, remaining: 47, over: 0, isMember: false,
    groups: [
      { kind: 'activity', id: 'a1', title: '晨跑', dateText: '2026-11-01', photos: [
        { url: 'u1', thumb: 't1' }, { url: 'u2', thumb: 't2' },
      ] },
      { kind: 'footprint', id: 'f1', title: '西湖', dateText: '2026-11-02', photos: [
        { url: 'u3', thumb: 't3' },
      ] },
    ],
    ...over,
  };
}

function reset(over) {
  apiGets = []; apiPosts = []; modals = []; toasts = []; navs = [];
  modalConfirm = true;
  token = { accessToken: 't' };
  listRespond = () => Promise.resolve(fixture(over));
  postRespond = () => Promise.resolve({ deleted: 2, used: 1, limit: 50, remaining: 49, over: 0 });
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch) => Object.assign(p.data, patch);
  return p;
}

test('PH2 额度渲染：普通用户 3/50，超额时标记 over', async () => {
  let p = reset();
  p.onShow();
  await tick();
  assert.equal(p.data.quota.used, 3);
  assert.equal(p.data.quota.limit, 50);
  assert.equal(p.data.quota.percent, 6);
  assert.equal(p.data.groups.length, 2);

  p = reset({ used: 210, limit: 200, remaining: 0, over: 10 });
  p.onShow();
  await tick();
  assert.equal(p.data.quota.over, 10);
  assert.equal(p.data.quota.percent, 100, '超额时进度条封顶 100');
});

test('PH3 选择与删除：refs 按「来源+分组」聚合，删除后重新拉总览', async () => {
  const p = reset();
  p.onShow();
  await tick();
  assert.equal(p.data.selectedCount, 0);

  p.onTogglePhoto({ currentTarget: { dataset: { kind: 'activity', id: 'a1', url: 'u1' } } });
  p.onTogglePhoto({ currentTarget: { dataset: { kind: 'activity', id: 'a1', url: 'u2' } } });
  p.onTogglePhoto({ currentTarget: { dataset: { kind: 'footprint', id: 'f1', url: 'u3' } } });
  assert.equal(p.data.selectedCount, 3);

  apiGets.length = 0;
  await p.onDelete();
  await tick();
  assert.equal(modals.length, 1, '删除前二次确认');
  assert.equal(apiPosts.length, 1);
  const { p: path, body } = apiPosts[0];
  assert.equal(path, '/photos/delete');
  assert.equal(body.refs.length, 2, '同一来源的两张合并成一组');
  const act = body.refs.find((r) => r.kind === 'activity');
  assert.deepEqual(act.urls.sort(), ['u1', 'u2']);
  assert.equal(toasts[toasts.length - 1], '已删除 2 张');
  assert.ok(apiGets.includes('/photos'), '删除成功后重新拉总览');
  assert.equal(p.data.selectedCount, 0, '删除后清空选择');
});

test('PH4 取消确认：不提交删除', async () => {
  const p = reset();
  p.onShow();
  await tick();
  modalConfirm = false;
  p.onTogglePhoto({ currentTarget: { dataset: { kind: 'activity', id: 'a1', url: 'u1' } } });
  apiPosts.length = 0;
  await p.onDelete();
  assert.equal(apiPosts.length, 0, '取消后不发请求');
});

test('PH5b 预览只在当前分组内翻页（不传全量原图）', async () => {
  const p = reset();
  p.onShow();
  await tick();
  navs.length = 0;
  // 点轨迹组里的 u2
  p.onPreview({ currentTarget: { dataset: { url: 'u2', kind: 'activity', id: 'a1' } } });
  const call = navs.find((n) => n[0] === 'preview');
  assert.ok(call, '要调 previewImage');
  assert.equal(call[1], 'u2', 'current 是被点的那张');
  const { urls } = global.__lastPreview;
  assert.deepEqual(urls, ['u1', 'u2'], '只含同组照片（足迹那张 u3 不进来）');

  // 足迹组：只有自己那一张
  p.onPreview({ currentTarget: { dataset: { url: 'u3', kind: 'footprint', id: 'f1' } } });
  assert.deepEqual(global.__lastPreview.urls, ['u3']);
});

test('PH5 全选/取消全选', async () => {
  const p = reset();
  p.onShow();
  await tick();
  p.onSelectAll();
  assert.equal(p.data.selectedCount, 3, '全选覆盖所有分组');
  p.onSelectAll();
  assert.equal(p.data.selectedCount, 0, '再点一次取消全选');
});
