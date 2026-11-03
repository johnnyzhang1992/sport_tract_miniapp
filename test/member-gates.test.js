/**
 * 会员权益在端上的三处落点（spec §8）：
 * G-1 轨迹合集页「多选」入口已恢复，且判据是服务端下发的 canExportBundle；
 * G-2 非会员点多选 → 引导弹窗（不进入多选、不发导出请求），会员点 → 真进 selectMode；
 * G-3 导出被服务端拒时整句原样展示（端上不写死 403 文案）；
 * G-4 设置页拉 /member/entitlements 并写免广告缓存；
 * G-5 广告组件数据源仍是 ad-free 缓存（没有新增第二份到期算式）。
 * 桩：wx / Page / getApp 就地 stub；services/api、services/storage 用 require.cache 注入。
 * 运行：node --test test/member-gates.test.js；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/* ------------------------------- 结构断言 ------------------------------- */

test('G-1 多选入口已从注释还原，判据是 canExportBundle', () => {
  const w = read('miniprogram/pages/tracks/tracks.wxml');
  assert.match(w, /class="mode-btn select-toggle/, '多选按钮没还原');
  assert.ok(w.includes('bindtap="onToggleSelect"'));
  assert.ok(!/<!--\s*<view class="mode-btn select-toggle/.test(w), '还在注释里');
  const js = read('miniprogram/pages/tracks/tracks.js');
  assert.ok(js.includes('canExportBundle'), '页面要有服务端下发的权益标记');
  assert.ok(js.includes("api.get('/member/entitlements')"), '权益只能从接口取');
  assert.ok(js.includes('canExportBundle: !!ent.canExportBundle'), '拿到响应必须落进 data，否则判据永远是 false');
});

test('G-3 导出失败原样展示服务端整句，端上不写死会员文案', () => {
  const js = read('miniprogram/pages/tracks/tracks.js');
  assert.match(js, /e\.message/);
  assert.ok(!js.includes('多条轨迹打包导出需要开通会员'), '这句由服务端 403 下发，端上不许复制一份');
});

test('G-4 设置页拉权益并写免广告缓存', () => {
  const js = read('miniprogram/pages/settings/settings.js');
  assert.match(js, /\/member\/entitlements/);
  assert.match(js, /setAdFreeUntil\(e\.adFreeUntil\)/, '必须真的把服务端值写进缓存，不能只 import');
});

test('G-5 广告组件数据源仍是 ad-free 缓存（没有新增第二份算式）', () => {
  const js = read('miniprogram/components/ad-template/ad-template.js');
  assert.match(js, /isAdFree\(/);
  assert.ok(!js.includes('memberUntil'), '组件不该自己去算会员到期');
});

/* --------------------------------- 行为桩 --------------------------------- */

let modals = [];
let pageDef = null;
global.wx = {
  showModal: (o) => modals.push(o),
  showToast: () => {},
  getStorageSync: () => '',
  setStorageSync: () => {},
  navigateTo: () => {},
};
global.Page = (d) => { pageDef = d; };
global.getApp = () => ({ globalData: {}, hasSession: () => false });

const fakeApi = { get: () => Promise.resolve(null), post: () => Promise.resolve(null) };
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

require('../miniprogram/pages/tracks/tracks.js');
assert.ok(pageDef, 'tracks.js 应通过 Page() 交出页面对象');

function pageWith(data) {
  const p = Object.assign({}, pageDef);
  p.data = Object.assign({}, pageDef.data, data);
  p.setData = (patch) => Object.assign(p.data, patch || {});
  return p;
}

test('G-2 非会员点「多选」：弹引导、不进多选；会员进多选', () => {
  modals = [];
  const p = pageWith({ canExportBundle: false, selectMode: false, items: [] });
  p.onToggleSelect();
  assert.equal(modals.length, 1, '非会员要看到引导，不能静默无反应');
  assert.equal(modals[0].title, '打包导出');
  assert.equal(modals[0].content, '开通会员后可一次导出多条轨迹');
  assert.equal(modals[0].confirmText, '去开通');
  assert.equal(p.data.selectMode, false, '不许进入多选');

  modals = [];
  const q = pageWith({ canExportBundle: true, selectMode: false, items: [] });
  q.onToggleSelect();
  assert.equal(modals.length, 0);
  assert.equal(q.data.selectMode, true);
});
