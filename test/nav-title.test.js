/**
 * 导航栏标题防串页闸门（utils/nav-title.js）单测。
 * 事故场景：详情页的动态标题写在异步回调里，回调返回时页面已退场，
 * wx.setNavigationBarTitle 会把标题写到当前前台页（常是首页）头上。
 * 闸门口径：只有调用页是页面栈顶实例时才真正设置。
 * 运行：npm test；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const setCalls = [];
global.wx = { setNavigationBarTitle: (o) => setCalls.push(o.title) };

const detailPage = { route: 'pages/campaign-detail/campaign-detail' };
let stack = [detailPage];
global.getCurrentPages = () => stack;

const { setPageTitle } = require('../miniprogram/utils/nav-title.js');

test('NT1 调用页是栈顶：标题正常设置', () => {
  setPageTitle(detailPage, '周末徒步局');
  assert.deepEqual(setCalls, ['周末徒步局']);
});

test('NT2 调用页已退场（栈顶是别的页）：迟到回调丢弃，不写标题', () => {
  setCalls.length = 0;
  stack = [{ route: 'pages/index/index' }]; // 用户已回到首页
  setPageTitle(detailPage, '周末徒步局'); // 详情页迟到的回调
  assert.deepEqual(setCalls, [], '不得把详情标题写到首页头上');
});

test('NT3 空标题兜底：undefined → 空串（调用方已挡，这里只兜形状）', () => {
  stack = [detailPage];
  setPageTitle(detailPage, undefined);
  assert.deepEqual(setCalls, ['']);
});
