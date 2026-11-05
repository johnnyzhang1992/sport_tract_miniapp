/**
 * 页面不存在兜底（2026-11-05）：小程序没有 404 页，旧分享卡片/小程序码指向
 * 未发布或已改名的页面时会落到微信空白页。要求在全局 onPageNotFound 里重定向首页。
 * 运行：node --test test/app-404.test.js；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('A404-1 app.js 注册 onPageNotFound，reLaunch 到首页并兜底 switchTab', () => {
  const src = read('miniprogram/app.js');
  assert.match(src, /onPageNotFound\s*\(/, '必须有全局 onPageNotFound');
  assert.match(src, /wx\.reLaunch\(/, '用 reLaunch 清栈回首页');
  assert.match(src, /url:\s*'\/pages\/index\/index'/, '目标是首页');
  assert.match(src, /wx\.switchTab\(/, 'reLaunch 失败要有 switchTab 兜底');
});

test('A404-2 首页必须是 tabBar 页（否则 switchTab 兜底失效）', () => {
  const app = JSON.parse(read('miniprogram/app.json'));
  const pages = app.tabBar?.list?.map((i) => i.pagePath) || [];
  assert.ok(pages.includes('pages/index/index'), '首页需在 tabBar 中');
});

test('A404-3 兜底行为：reLaunch 被调用一次，目标首页', () => {
  const calls = [];
  global.wx = {
    reLaunch: (o) => { calls.push(['reLaunch', o && o.url]); },
    switchTab: (o) => { calls.push(['switchTab', o && o.url]); },
    showToast: () => {},
    getStorageSync: () => '',
    setStorageSync: () => {},
    onError: () => {},
  };
  global.App = (def) => { global.__appDef = def; };
  // app.js 顶层 require 了若干工具模块，这里只需拿到定义，不管它们
  delete require.cache[require.resolve('../miniprogram/app.js')];
  try {
    require('../miniprogram/app.js');
  } catch (e) {
    assert.fail(`app.js 引入失败：${e.message}`);
  }
  const def = global.__appDef;
  assert.ok(def && typeof def.onPageNotFound === 'function');
  def.onPageNotFound({ path: 'pages/not-exist/not-exist' });
  assert.deepEqual(calls, [['reLaunch', '/pages/index/index']], '应 reLaunch 回首页');
});
