/**
 * 底部 tabBar 改版（2026-11-04 用户指定）：
 * - tabBar 第三格「足迹」换成数据统计（pages/stats/stats）；
 * - 足迹入口移到「我的」页菜单，个人中心原来那张数据统计卡整体移除；
 * - 统计页变成 tab 页：其它页跳它必须走 wx.switchTab（navigateTo 跳 tab 页会失败），
 *   根节点按「tab 页不加安全区」约定去掉 env()；
 * - 足迹页不再是 tab 页：三个半屏恢复安全区，浮层按钮与弹层底部垫 env()。
 * 运行：node --test test/tabbar-stats-entry.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const navs = [];
global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  navigateTo: (o) => navs.push(o && o.url),
  switchTab: (o) => navs.push(o && o.url),
  showToast: () => {},
  stopPullDownRefresh: () => {},
};
global.getApp = () => ({
  globalData: { loggedIn: false, user: null, homeDirty: false },
  hasSession: () => false,
  login: async () => {},
});

const fakeApi = { get: async () => ({}), post: async () => ({}), put: async () => ({}), del: async () => ({}) };
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const loginGatePath = require.resolve('../miniprogram/utils/login-gate.js');
require.cache[loginGatePath] = {
  id: loginGatePath, filename: loginGatePath, loaded: true,
  exports: { ensureLogin: async () => false },
  children: [], paths: [],
};

let pageDef = null;
global.Page = (d) => { pageDef = d; };
require('../miniprogram/pages/my/my.js');
assert.ok(pageDef, 'my.js 应通过 Page() 交出页面对象');

function boot() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch) => Object.assign(p.data, patch || {});
  return p;
}

test('TB1 tabBar：第三格改为统计页（文案「统计」），图标文件齐全，足迹页退回普通页', () => {
  const app = JSON.parse(read('miniprogram/app.json'));
  assert.deepEqual(
    app.tabBar.list.map((t) => t.pagePath),
    ['pages/index/index', 'pages/tracks/tracks', 'pages/stats/stats', 'pages/my/my'],
    'tabBar 顺序：首页 / 轨迹 / 数据统计 / 我的',
  );
  const statsTab = app.tabBar.list[2];
  assert.equal(statsTab.text, '统计', 'tab 文案压成两字，与首页/轨迹/我的同宽');
  for (const p of [statsTab.iconPath, statsTab.selectedIconPath]) {
    assert.ok(fs.existsSync(path.join(root, 'miniprogram', p)), `tab 图标缺失：${p}`);
  }
  for (const t of app.tabBar.list) {
    assert.ok(app.pages.includes(t.pagePath), `tab 页必须注册在 pages：${t.pagePath}`);
  }
  assert.ok(app.pages.includes('pages/footprints/footprints'), '足迹页仍要保留（从「我的」进入）');
});

test('TB2 我的页：删掉数据统计卡，菜单加足迹入口', () => {
  const w = read('miniprogram/pages/my/my.wxml');
  assert.ok(!w.includes('stats-card'), '数据统计卡应整体移除');
  assert.ok(!w.includes('onTapStats'), '统计卡的点击处理不应残留');
  assert.ok(!w.includes('goStats'), '统计入口不应残留');
  assert.match(
    w,
    /<t-cell title="足迹"[^>]*bind:click="goFootprints"[^>]*>[\s\S]*?lucide-footprints\.png/,
    '菜单里要有足迹入口（图标 lucide-footprints）',
  );
});

test('TB3 我的页脚本：足迹走 navigateTo，统计入口处理函数已删除', () => {
  const js = read('miniprogram/pages/my/my.js');
  assert.equal(typeof pageDef.goFootprints, 'function', '要有 goFootprints');
  assert.equal(typeof pageDef.goStats, 'undefined', '统计入口已移除');
  assert.equal(typeof pageDef.onTapStats, 'undefined', '统计卡点击处理已移除');
  assert.ok(!js.includes("'/stats/overview'"), '统计卡移除后不再白拉 /stats/overview');
  navs.length = 0;
  boot().goFootprints();
  assert.deepEqual(navs, ['/pages/footprints/footprints']);
});

test('TB4 首页 / 报告页跳统计：必须 switchTab（navigateTo 跳 tab 页会失败）', () => {
  for (const f of ['miniprogram/pages/index/index.js', 'miniprogram/pages/report/report.js']) {
    const js = read(f);
    assert.match(
      js,
      /goStats\(\)\s*\{\s*wx\.switchTab\(\{\s*url:\s*'\/pages\/stats\/stats'\s*\}\);\s*\}/,
      `${f} 的 goStats 要改用 switchTab`,
    );
    assert.ok(
      !/wx\.navigateTo\(\{\s*url:\s*'\/pages\/stats\/stats'/.test(js),
      `${f} 不应再有 navigateTo 跳统计页`,
    );
  }
});

test('TB5 足迹页退回普通页：三个半屏恢复安全区，浮层与弹层底部垫 env()', () => {
  const w = read('miniprogram/pages/footprints/footprints.wxml');
  assert.ok(!w.includes('safe-bottom="{{false}}"'), '半屏组件要恢复默认安全区');
  assert.ok(!w.includes('on-tab="{{true}}"'), '表单半屏不再按 tab 页扣键盘基准差');
  const wxss = read('miniprogram/pages/footprints/footprints.wxss');
  assert.match(
    wxss,
    /\.tool-col-right\s*\{[^}]*bottom:\s*calc\(40rpx \+ env\(safe-area-inset-bottom\)\)/,
    '右下浮层要避开 Home 指示条',
  );
  assert.match(
    wxss,
    /\.tool-col-left-bottom\s*\{[^}]*bottom:\s*calc\(40rpx \+ env\(safe-area-inset-bottom\)\)/,
    '左下浮层同样垫安全区',
  );
  assert.match(
    wxss,
    /\.sheet\s*\{[^}]*padding:\s*0 32rpx calc\(24rpx \+ env\(safe-area-inset-bottom\)\)/,
    '成员列表半屏底边要垫安全区',
  );
});

test('TB6 统计页变 tab 页：根节点与半屏不再垫 env()', () => {
  const wxss = read('miniprogram/pages/stats/stats.wxss');
  const container = wxss.match(/\.container\s*\{[^}]*\}/);
  assert.ok(container, '应有 .container');
  assert.ok(!container[0].includes('env('), 'tab 页根节点不加安全区（README 规则 1）');
  const sheet = wxss.match(/\.sheet\s*\{[^}]*\}/);
  assert.ok(sheet, '应有 .sheet');
  assert.ok(!sheet[0].includes('env('), 'tab 页的底边弹层底边在 tabBar 上方，不再垫安全区');
});
