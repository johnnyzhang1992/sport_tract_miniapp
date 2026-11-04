/**
 * 订单与退款页回归（2026-11-04）：
 * 1) 结构：app.json 注册、会员中心有入口；
 * 2) 列表渲染服务端旗标（canPay/canCancel/canRefund），分→元换算在端上仅兜底展示；
 * 3) 游客不发请求；退款提交必选原因（未选不发请求）；提交带 reasonCode + note；
 * 4) 取消/继续支付打对端点。
 * 桩：wx / Page 就地 stub，services/api、services/storage、utils/member-pay、utils/login-gate 用 require.cache 注入。
 * 运行：node --test test/member-orders-page.test.js；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('MO1 app.json 注册订单页，会员中心有「订单与退款」入口', () => {
  const app = JSON.parse(read('miniprogram/app.json'));
  assert.ok(app.pages.includes('pages/member-orders/member-orders'));
  assert.ok(read('miniprogram/pages/member/member.wxml').includes('订单与退款'));
  assert.ok(read('miniprogram/pages/member/member.js').includes("'/pages/member-orders/member-orders'"));
});

/* --------------------------------- 环境桩 --------------------------------- */

let apiGets = [];
let apiPosts = [];
let ordersRespond = null;
let modalRespond = null;
let modals = [];
let toasts = [];
let loginCalls = 0;
let pullStops = 0;
let token = { accessToken: 't' };
const sysInfo = { platform: 'android', SDKVersion: '3.0.0', version: '8.0.50' };

const fakeApi = {
  get(p) { apiGets.push(p); return ordersRespond(p); },
  post(p, body) { apiPosts.push({ p, body }); return postRespond(p, body); },
};
let postRespond = () => Promise.resolve({ status: 'refunding' });

const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const storagePath = require.resolve('../miniprogram/services/storage.js');
require.cache[storagePath] = {
  id: storagePath, filename: storagePath, loaded: true, exports: { getToken: () => token }, children: [], paths: [],
};

const payPath = require.resolve('../miniprogram/utils/member-pay.js');
require.cache[payPath] = {
  id: payPath, filename: payPath, loaded: true,
  exports: { repayForMember: () => Promise.resolve({ status: 'pending' }) }, children: [], paths: [],
};

const loginGatePath = require.resolve('../miniprogram/utils/login-gate.js');
require.cache[loginGatePath] = {
  id: loginGatePath, filename: loginGatePath, loaded: true,
  exports: { ensureLogin: () => { loginCalls += 1; token = { accessToken: 't2' }; return Promise.resolve(true); } },
  children: [], paths: [],
};

global.wx = {
  getSystemInfoSync: () => sysInfo,
  showToast: (o) => toasts.push(o && o.title),
  showModal: (o) => { modals.push(o && o.title); if (modalRespond) modalRespond(o); },
  stopPullDownRefresh: () => { pullStops += 1; },
};

let pageDef = null;
global.Page = (def) => { pageDef = def; };
require('../miniprogram/pages/member-orders/member-orders.js');
assert.ok(pageDef, 'member-orders.js 应通过 Page() 交出页面对象');

/* --------------------------------- 装配 --------------------------------- */

const tick = () => new Promise((r) => setImmediate(r));

const ordersFixture = (over) => ({
  notice: '退款金额按剩余天数折算，以提交时微信侧额度为准',
  items: [
    { outTradeNo: 'OTN1', status: 'created', statusText: '待支付', name: '会员月卡', priceFen: 199, refundedFen: 0, periodText: '', createdAtText: '2026-11-04 00:01', canPay: true, canCancel: true, canRefund: false },
    { outTradeNo: 'OTN2', status: 'delivered', statusText: '已生效', name: '会员月卡', priceFen: 199, refundedFen: 0, periodText: '2026年11月4日 ~ 2026年12月3日', createdAtText: '2026-11-03 23:59', canPay: false, canCancel: false, canRefund: true },
    ...((over && over.extra) || []),
  ],
  ...over,
});

function reset(over) {
  apiGets = []; apiPosts = []; modals = []; toasts = []; loginCalls = 0; pullStops = 0;
  token = over && over.loggedOut ? null : { accessToken: 't' };
  ordersRespond = () => Promise.resolve(ordersFixture(over));
  postRespond = () => Promise.resolve({ status: 'refunding', refundOrderId: 'R1', refundFeeFen: 199, refundedFen: 199 });
  pageDef.data = { loading: true, failed: false, loggedIn: false, items: [], notice: '', reasonLabels: pageDef.data.reasonLabels, expanded: '', reasonIndex: -1, note: '', busy: '' };
  pageDef.setData = (patch) => { Object.assign(pageDef.data, patch || {}); };
  pageDef.setData({ loading: true, failed: false, loggedIn: true, items: [], notice: '', expanded: '', reasonIndex: -1, note: '', busy: '' });
  return pageDef;
}

/* --------------------------------- 用例 --------------------------------- */

test('MO2 游客进页不发请求；登录后拉一次列表并做元换算', async () => {
  reset({ loggedOut: true });
  pageDef.onShow();
  await tick();
  assert.equal(apiGets.length, 0, '游客态不能发请求');
  assert.equal(pageDef.data.loggedIn, false);

  reset();
  pageDef.onShow();
  await tick();
  assert.deepEqual(apiGets, ['/member/orders']);
  assert.equal(pageDef.data.items[0].priceText, '1.99');
  assert.match(pageDef.data.notice, /剩余天数/);
});

test('MO3 退款必选原因：未选不发请求；选了带 reasonCode+note 提交', async () => {
  reset();
  pageDef.onShow();
  await tick();
  const p = pageDef;
  p.toggleRefund({ currentTarget: { dataset: { id: 'OTN2' } } });
  assert.equal(p.data.expanded, 'OTN2');
  const postCount = apiPosts.length;
  p.onSubmitRefund({ currentTarget: { dataset: { id: 'OTN2' } } });
  assert.equal(toasts.filter((t) => /请选择退款原因/.test(t)).length, 1, '未选原因要拦');
  assert.equal(apiPosts.length, postCount, '拦截后不许发请求');

  p.onReason({ detail: { value: 2 } });
  p.onNote({ detail: { value: '用着不舒服' } });
  modalRespond = (o) => o.success({ confirm: true });
  p.onSubmitRefund({ currentTarget: { dataset: { id: 'OTN2' } } });
  await tick();
  const refund = apiPosts.find((c) => c.p === '/member/order/OTN2/refund');
  assert.ok(refund, '要打退款端点');
  assert.deepEqual(refund.body, { reasonCode: '3', note: '用着不舒服' });
});

test('MO4 取消订单走确认弹窗并打 cancel 端点', async () => {
  reset();
  pageDef.onShow();
  await tick();
  modalRespond = (o) => o.success({ confirm: true });
  pageDef.onCancel({ currentTarget: { dataset: { id: 'OTN1' } } });
  await tick();
  const cancel = apiPosts.find((c) => c.p === '/member/order/OTN1/cancel');
  assert.ok(cancel, '要打取消端点');
  assert.ok(modals.some((t) => t === '取消订单'), '取消要有确认弹窗');
});

test('MO5 订单页开启下拉刷新，按钮不再使用原生 size=mini', () => {
  const cfg = JSON.parse(read('miniprogram/pages/member-orders/member-orders.json'));
  assert.equal(cfg.enablePullDownRefresh, true);
  assert.ok(!read('miniprogram/pages/member-orders/member-orders.wxml').includes('size="mini"'));
});

test('MO6 游客下拉：不发请求，spinner 立即收起', async () => {
  reset({ loggedOut: true });
  pageDef.onShow();
  await tick();
  await pageDef.onPullDownRefresh();
  assert.deepEqual(apiGets, []);
  assert.equal(pullStops, 1);
});

test('MO7 登录后下拉：静默重拉不闪加载态；失败保留列表并 toast', async () => {
  reset();
  pageDef.onShow();
  await tick();
  assert.equal(pageDef.data.items.length, 2);

  let release = null;
  ordersRespond = () => new Promise((r) => { release = r; });
  const pending = pageDef.onPullDownRefresh();
  assert.equal(pageDef.data.loading, false, '下拉刷新不能把页面切回加载态');
  release(ordersFixture({ notice: '刷新后的提示' }));
  await pending;
  await tick();
  assert.equal(pageDef.data.notice, '刷新后的提示');
  assert.equal(pullStops, 1);

  ordersRespond = () => Promise.reject(new Error(''));
  await pageDef.onPullDownRefresh();
  await tick();
  assert.equal(pageDef.data.items.length, 2, '刷新失败不清空列表');
  assert.equal(pageDef.data.failed, false, '下拉失败不整页转错误态');
  assert.ok(toasts.includes('刷新失败'));
  assert.equal(pullStops, 2);
});

test('MO8 订单卡结构：状态胶囊、价格主行、退款字段带可见描边', () => {
  const w = read('miniprogram/pages/member-orders/member-orders.wxml');
  assert.ok(w.includes('class="status-pill s-{{item.status}}"'));
  assert.ok(w.includes('class="price-row"'));
  assert.ok(w.includes('class="meta-row"'));
  assert.ok(w.includes('class="field"'), '退款原因要有可见字段框');
  const css = read('miniprogram/pages/member-orders/member-orders.wxss');
  assert.match(css, /\.field\s*\{[^}]*border:\s*2rpx solid/, '下拉框要有可见边框');
  assert.match(css, /\.note\s*\{[^}]*border:\s*2rpx solid/, '备注输入框要有可见边框');
  assert.match(css, /\.order button\.act\s*\{[^}]*width:\s*auto/, '按钮宽度要自己钉，别落回原生 184px');
});
