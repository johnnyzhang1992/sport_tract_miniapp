/**
 * 会员中心页回归：
 * 1) 结构：app.json 注册路由、「我的」页有入口；
 * 2) 登录闸门走触点级：游客进页不发请求，点引导才 ensureLogin + 拉数据；
 * 3) 文案全部来自 /member/products（价格/日均/权益行/状态行/关闭态说明），端上不拼句；
 * 4) 关闭态不渲染任何档位与按钮；iOS 不显示付费入口；
 * 5) 支付：delivered 才写免广告缓存并 toast「已开通」，cancelled 不提示，pending 用自己的话；
 * 6) 连点只下一单；加载失败显示重试，重试会再发请求；
 * 7) 下拉刷新：游客不发请求；登录后静默重拉（不清屏），失败保留内容只 toast，spinner 必收。
 * 桩：wx / Page 就地 stub，services/api、services/storage、utils/member-pay、utils/ad-free、utils/login-gate 用 require.cache 注入。
 * 运行：node --test test/member-page.test.js；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/* ------------------------------- 结构断言 ------------------------------- */

test('MP1 app.json 注册会员页，「我的」页有入口且指向它', () => {
  const app = JSON.parse(read('miniprogram/app.json'));
  assert.ok(app.pages.includes('pages/member/member'));
  assert.ok(read('miniprogram/pages/my/my.wxml').includes('quick-card'));
  assert.ok(read('miniprogram/pages/my/my.wxml').includes('>会员<'));
  assert.ok(read('miniprogram/pages/my/my.js').includes("'/pages/member/member'"));
});

test('MP2 页面文案位全部绑变量，不写死价格/日均/权益句', () => {
  const wxml = read('miniprogram/pages/member/member.wxml');
  assert.ok(!wxml.includes('/100'), '端上不许把分换算成元');
  assert.ok(!wxml.includes('元/天'), '日均价必须来自接口');
  assert.ok(!wxml.includes('免广告'), '权益行必须来自接口 perkLines');
  assert.ok(wxml.includes('{{plan.priceText}}') && wxml.includes('{{plan.perDayText}}'));
  assert.ok(wxml.includes('{{item}}'), '页头权益行逐个渲染服务端 perkLines');
});

/* --------------------------------- 环境桩 --------------------------------- */

let apiCalls = [];
let productsRespond = null;
let payRespond = null;
let payCalls = [];
let adFreeWrites = [];
let toasts = [];
let loginCalls = 0;
let token = { accessToken: 't' };
let sysInfo = { platform: 'android', SDKVersion: '3.0.0', version: '8.0.50' };

const fakeApi = {
  get(p) {
    apiCalls.push(p);
    return productsRespond(p);
  },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const storagePath = require.resolve('../miniprogram/services/storage.js');
require.cache[storagePath] = {
  id: storagePath, filename: storagePath, loaded: true,
  exports: { getToken: () => token }, children: [], paths: [],
};

const payPath = require.resolve('../miniprogram/utils/member-pay.js');
require.cache[payPath] = {
  id: payPath, filename: payPath, loaded: true,
  exports: {
    payForMember: (key, info) => {
      payCalls.push({ key, info });
      return payRespond(key, info);
    },
  },
  children: [], paths: [],
};

const adFreePath = require.resolve('../miniprogram/utils/ad-free.js');
require.cache[adFreePath] = {
  id: adFreePath, filename: adFreePath, loaded: true,
  exports: { setAdFreeUntil: (ts) => adFreeWrites.push(ts) },
  children: [], paths: [],
};

const loginGatePath = require.resolve('../miniprogram/utils/login-gate.js');
require.cache[loginGatePath] = {
  id: loginGatePath, filename: loginGatePath, loaded: true,
  exports: {
    ensureLogin: () => {
      loginCalls += 1;
      token = { accessToken: 't2' };
      return Promise.resolve(true);
    },
  },
  children: [], paths: [],
};

global.wx = {
  getSystemInfoSync: () => sysInfo,
  showToast: (o) => toasts.push(o && o.title),
};

let pageDef = null;
global.Page = (def) => { pageDef = def; };
require('../miniprogram/pages/member/member.js');
assert.ok(pageDef, 'member.js 应通过 Page() 交出页面对象');

/* --------------------------------- 装配 --------------------------------- */

const tick = () => new Promise((r) => setImmediate(r));

const fixture = (over) => ({
  enabled: true,
  notice: '',
  statusText: '',
  items: [
    {
      key: 'month_card', name: '会员月卡', priceFen: 199, durationDays: 30,
      priceText: '1.99 元', perDayText: '约 0.07 元/天', durationText: '30 天',
      perkLines: ['免广告', '多条轨迹打包导出 GPX', '照片额度 300 张', '订阅消息提醒'],
    },
    {
      key: 'year_card', name: '会员年卡', priceFen: 1699, durationDays: 365,
      priceText: '16.99 元', perDayText: '约 0.05 元/天', durationText: '365 天',
      perkLines: ['免广告', '多条轨迹打包导出 GPX', '照片额度 300 张', '订阅消息提醒'],
    },
  ],
  entitlements: { memberActive: false, memberUntil: 0, adFreeUntil: 0 },
  ...over,
});

function reset(over) {
  apiCalls = [];
  payCalls = [];
  adFreeWrites = [];
  toasts = [];
  loginCalls = 0;
  token = over && over.loggedOut ? null : { accessToken: 't' };
  sysInfo = (over && over.sysInfo) || { platform: 'android', SDKVersion: '3.0.0', version: '8.0.50' };
  productsRespond = () => Promise.resolve(fixture((over && over.fixture) || {}));
  payRespond = () => Promise.resolve({ status: 'delivered', entitlements: { adFreeUntil: 123 } });
}

function boot() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch) => Object.assign(p.data, patch || {});
  p.onShow();
  return p;
}

/* ---------------------------------- 用例 ---------------------------------- */

test('MP3 游客进页：不发请求；点引导才登录并拉数据', async () => {
  reset({ loggedOut: true });
  const p = boot();
  await tick();
  assert.deepEqual(apiCalls, []);
  assert.equal(p.data.loggedIn, false);
  assert.equal(p.data.loading, false);

  await p.onTapGate();
  await tick();
  assert.equal(loginCalls, 1);
  assert.deepEqual(apiCalls, ['/member/products']);
  assert.equal(p.data.cards.length, 2);
});

test('MP4 登录后渲染服务端文案：价格、日均、权益四行、状态行', async () => {
  reset({ fixture: { statusText: '会员生效中 · 有效期至 2026年12月3日' } });
  const p = boot();
  await tick();
  assert.equal(p.data.loading, false);
  assert.equal(p.data.statusText, '会员生效中 · 有效期至 2026年12月3日');
  assert.equal(p.data.heroTitle, '会员生效中 · 有效期至 2026年12月3日', '有状态行时页头标题优先用状态行');
  assert.equal(p.data.cards[0].priceText, '1.99 元');
  assert.equal(p.data.cards[1].perDayText, '约 0.05 元/天');
  assert.deepEqual(p.data.cards[0].perkLines, ['免广告', '多条轨迹打包导出 GPX', '照片额度 300 张', '订阅消息提醒']);
});

test('MP5 关闭态：不渲染档位与按钮，展示服务端说明', async () => {
  reset({ fixture: { enabled: false, notice: '会员购买暂未开放', items: [] } });
  const p = boot();
  await tick();
  assert.equal(p.data.enabled, false);
  assert.equal(p.data.notice, '会员购买暂未开放');
  assert.equal(p.data.cards.length, 0);
  assert.equal(p.data.showPay, false);
});

test('MP6 付费入口可见性：iOS IAP 已开通，需微信 ≥ 8.0.68；安卓看基础库', async () => {
  reset({ sysInfo: { platform: 'ios', SDKVersion: '3.0.0', version: '8.0.68' } });
  let p = boot();
  await tick();
  assert.equal(p.data.showPay, true, 'iOS IAP 已开通且客户端达标 → 显示');

  reset({ sysInfo: { platform: 'ios', SDKVersion: '3.0.0', version: '8.0.50' } });
  p = boot();
  await tick();
  assert.equal(p.data.showPay, false, 'iOS 老微信（< 8.0.68，spec §2.1 MIN_IOS_CLIENT）仍隐藏');

  reset({ sysInfo: { platform: 'android', SDKVersion: '2.19.1', version: '8.0.50' } });
  p = boot();
  await tick();
  assert.equal(p.data.showPay, false, '基础库低于 2.19.2');

  reset({ sysInfo: { platform: 'android', SDKVersion: '2.19.2', version: '8.0.50' } });
  p = boot();
  await tick();
  assert.equal(p.data.showPay, true);
});

test('MP7 支付成功：写免广告缓存 + toast「已开通」+ 刷新页面', async () => {
  reset();
  const p = boot();
  await tick();
  await p.onBuy({ currentTarget: { dataset: { key: 'month_card' } } });
  await tick();
  assert.deepEqual(payCalls.map((c) => c.key), ['month_card']);
  assert.deepEqual(adFreeWrites, [123]);
  assert.deepEqual(toasts, ['已开通']);
  assert.ok(apiCalls.length >= 2, '成功后要重新拉一次（状态行/按钮文案会变）');
});

test('MP8 取消支付不提示；pending 用自己的话；失败展示服务端句子', async () => {
  reset();
  let p = boot();
  await tick();
  payRespond = () => Promise.resolve({ status: 'cancelled' });
  await p.onBuy({ currentTarget: { dataset: { key: 'month_card' } } });
  assert.deepEqual(toasts, [], '用户主动取消不算失败');

  reset();
  p = boot();
  await tick();
  payRespond = () => Promise.resolve({ status: 'pending', outTradeNo: 'X' });
  await p.onBuy({ currentTarget: { dataset: { key: 'month_card' } } });
  assert.deepEqual(toasts, ['支付结果确认中，稍后回来看']);

  reset();
  p = boot();
  await tick();
  payRespond = () => Promise.resolve({ status: 'failed', message: '道具尚未生效，请几分钟后再试' });
  await p.onBuy({ currentTarget: { dataset: { key: 'month_card' } } });
  assert.deepEqual(toasts, ['道具尚未生效，请几分钟后再试']);
});

test('MP9 连点两次只下一单', async () => {
  reset();
  let release;
  payRespond = () => new Promise((r) => { release = () => r({ status: 'cancelled' }); });
  const p = boot();
  await tick();
  const first = p.onBuy({ currentTarget: { dataset: { key: 'month_card' } } });
  const second = p.onBuy({ currentTarget: { dataset: { key: 'month_card' } } });
  await tick();
  assert.equal(payCalls.length, 1, '同一时刻只允许一个支付流程');
  release();
  await first;
  await second;
});

test('MP10 加载失败显示重试，重试会再发请求', async () => {
  reset();
  let fail = true;
  productsRespond = () => (fail ? Promise.reject(new Error('network')) : Promise.resolve(fixture()));
  const p = boot();
  await tick();
  assert.equal(p.data.failed, true);
  assert.ok(read('miniprogram/pages/member/member.wxml').includes('重试'));
  fail = false;
  p.onRetry();
  await tick();
  assert.equal(p.data.failed, false);
  assert.equal(p.data.cards.length, 2);
});

test('MP14 页头会员卡使用独立底图，图标文件已入包', () => {
  const w = read('miniprogram/pages/member/member.wxml');
  assert.ok(w.includes('class="member-hero"'), '应有页头会员卡');
  assert.ok(w.includes('src="/assets/icons/member-hero.png"'), '页头卡使用会员卡插画底图');
  assert.ok(
    fs.existsSync(path.join(root, 'miniprogram/assets/icons/member-hero.png')),
    '底图文件要入包',
  );
});

test('MP15 页面结构：页头卡 → 套餐行 → 统一开通按钮', () => {
  const w = read('miniprogram/pages/member/member.wxml');
  const posHero = w.indexOf('class="member-hero"');
  const posList = w.indexOf('class="plan-list"');
  const posRow = w.indexOf('class="plan-row');
  const posCta = w.indexOf('data-key="{{selectedKey}}"');
  assert.ok(posHero > 0 && posList > posHero, '页头卡在前，套餐列表在后');
  assert.ok(posRow > posList && posCta > posRow, '套餐行之后才是统一开通按钮');
  assert.match(w, /bindtap="onSelectPlan"/, '套餐行可切换选中');
  assert.equal((w.match(/bindtap="onBuy"/g) || []).length, 1, '每档不再各带一个开通按钮');
});

test('MP16 选中档位：默认第一档，切换后页头权益与下单 key 一起变', async () => {
  reset({ fixture: { items: [
    { key: 'month_card', name: '会员月卡', priceFen: 199, priceText: '1.99 元', perDayText: '约 0.07 元/天', durationText: '30 天', perkLines: ['月卡权益'] },
    { key: 'year_card', name: '会员年卡', priceFen: 1699, priceText: '16.99 元', perDayText: '约 0.05 元/天', durationText: '365 天', perkLines: ['年卡权益'] },
  ] } });
  const p = boot();
  await tick();
  assert.equal(p.data.selectedKey, 'month_card', '首次进页默认选第一档');
  assert.deepEqual(p.data.heroPerks, ['月卡权益']);
  assert.equal(p.data.heroTitle, '会员月卡', '无状态行时页头标题用选中套餐名');

  p.onSelectPlan({ currentTarget: { dataset: { key: 'year_card' } } });
  assert.equal(p.data.selectedKey, 'year_card');
  assert.deepEqual(p.data.heroPerks, ['年卡权益'], '页头权益跟随选中档位');
  assert.equal(p.data.heroTitle, '会员年卡', '页头标题跟随选中档位');

  p.onSelectPlan({ currentTarget: { dataset: { key: 'nope' } } });
  assert.equal(p.data.selectedKey, 'year_card', '未知 key 不改变选择');

  await p.onBuy({ currentTarget: { dataset: {} } });
  assert.deepEqual(payCalls.map((c) => c.key), ['year_card'], '统一按钮用当前选中档位下单');
});

test('MP17 刷新后保留已选档位', async () => {
  reset();
  const p = boot();
  await tick();
  p.onSelectPlan({ currentTarget: { dataset: { key: 'year_card' } } });
  await p.syncData({ silent: true });
  assert.equal(p.data.selectedKey, 'year_card', '刷新不能把选择重置回第一档');
});

test('MP11 会员中心开启下拉刷新', () => {
  const cfg = JSON.parse(read('miniprogram/pages/member/member.json'));
  assert.equal(cfg.enablePullDownRefresh, true);
});

test('MP12 游客下拉：不发请求，spinner 立即收起', async () => {
  reset({ loggedOut: true });
  const p = boot();
  await tick();
  let stops = 0;
  wx.stopPullDownRefresh = () => { stops += 1; };
  await p.onPullDownRefresh();
  assert.deepEqual(apiCalls, []);
  assert.equal(stops, 1);
});

test('MP13 登录后下拉：静默重拉不闪加载态；失败保留内容并 toast', async () => {
  reset();
  const p = boot();
  await tick();
  assert.equal(p.data.cards.length, 2);

  let release = null;
  productsRespond = () => new Promise((r) => { release = r; });
  let stops = 0;
  wx.stopPullDownRefresh = () => { stops += 1; };

  const pending = p.onPullDownRefresh();
  assert.equal(p.data.loading, false, '下拉刷新不能把页面切回加载态');
  release(fixture({ statusText: '会员生效中 · 有效期至 2026年12月3日' }));
  await pending;
  await tick();
  assert.equal(p.data.statusText, '会员生效中 · 有效期至 2026年12月3日');
  assert.equal(stops, 1, '成功后要收 spinner');

  productsRespond = () => Promise.reject(new Error(''));
  await p.onPullDownRefresh();
  await tick();
  assert.equal(p.data.cards.length, 2, '刷新失败不清屏');
  assert.equal(p.data.failed, false, '下拉失败不整页转错误态');
  assert.ok(toasts.includes('刷新失败'), '失败要给一句反馈');
  assert.equal(stops, 2, '失败也要收 spinner');
});
