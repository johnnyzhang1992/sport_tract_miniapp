/**
 * 会员中心页回归：
 * 1) 结构：app.json 注册路由、「我的」页有入口；
 * 2) 登录闸门走触点级：游客进页不发请求，点引导才 ensureLogin + 拉数据；
 * 3) 文案全部来自 /member/products（价格/日均/权益行/状态行/关闭态说明），端上不拼句；
 * 4) 关闭态不渲染任何档位与按钮；iOS 不显示付费入口；
 * 5) 支付：delivered 才写免广告缓存并 toast「已开通」，cancelled 不提示，pending 用自己的话；
 * 6) 连点只下一单；加载失败显示重试，重试会再发请求；
 * 7) 下拉刷新：游客不发请求；登录后静默重拉（不清屏），失败保留内容只 toast，spinner 必收。
 * 8) 进页防闪：成功拉取落盘缓存（带 userId 防串）；再进页先渲染缓存不切加载态，静默重拉；
 *    串用户/token 解不出不画缓存；进页静默失败保留内容不 toast。
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
  assert.ok(wxml.includes('{{item.text}}'), '页头权益文案逐个渲染服务端 perkLines');
});

/* --------------------------------- 环境桩 --------------------------------- */

let apiCalls = [];
let grantCalls = [];
let modals = [];
let productsRespond = null;
let reminderRespond = null;
let subscribeRespond = null;
let payRespond = null;
let payCalls = [];
let adFreeWrites = [];
let toasts = [];
let loginCalls = 0;
let token = { accessToken: 't' };
let sysInfo = { platform: 'android', SDKVersion: '3.0.0', version: '8.0.50' };
let storageMap = {};
/** 与 api plugins/jwt.ts 同构的假 access token（payload.userId），供缓存防串解析 */
const makeToken = (uid) => 'h.' + Buffer.from(JSON.stringify({ userId: uid, type: 'access' })).toString('base64') + '.s';

const fakeApi = {
  get(p) {
    apiCalls.push(p);
    if (p === '/member/reminder') return reminderRespond(p);
    return productsRespond(p);
  },
  post(p, body) {
    grantCalls.push({ path: p, body });
    return Promise.resolve({ subscribed: true });
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
  showModal: (o) => modals.push(o),
  requestSubscribeMessage: (o) => subscribeRespond(o),
  getStorageSync: (k) => (k in storageMap ? storageMap[k] : ''),
  setStorageSync: (k, v) => { storageMap[k] = v; },
  base64ToArrayBuffer: (b64) => Uint8Array.from(Buffer.from(b64, 'base64')).buffer,
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
  grantCalls = [];
  modals = [];
  payCalls = [];
  adFreeWrites = [];
  toasts = [];
  loginCalls = 0;
  storageMap = {};
  token = over && over.loggedOut ? null : { accessToken: makeToken('u1') };
  sysInfo = (over && over.sysInfo) || { platform: 'android', SDKVersion: '3.0.0', version: '8.0.50' };
  productsRespond = () => Promise.resolve(fixture((over && over.fixture) || {}));
  reminderRespond = () => Promise.resolve({ enabled: true, templateId: 'TPL_TEST', daysBefore: 3, subscribed: false });
  subscribeRespond = (o) => o.success({ TPL_TEST: 'accept' });
  payRespond = () => Promise.resolve({ status: 'delivered', entitlements: { adFreeUntil: 123 } });
}

function boot() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch) => {
    Object.entries(patch || {}).forEach(([k, v]) => {
      if (k.includes('.')) {
        const [sec, field] = k.split('.');
        p.data[sec] = Object.assign({}, p.data[sec], { [field]: v });
      } else {
        p.data[k] = v;
      }
    });
  };
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
  assert.deepEqual(apiCalls, ['/member/products', '/member/reminder']);
  assert.equal(p.data.cards.length, 2);
});

test('MP4 登录后渲染服务端文案：价格、日均、权益四行、状态行', async () => {
  reset({ fixture: { statusText: '会员生效中 · 有效期至 2026年12月3日' } });
  const p = boot();
  await tick();
  assert.equal(p.data.loading, false);
  assert.equal(p.data.statusText, '会员生效中 · 有效期至 2026年12月3日');
  assert.equal(p.data.heroTitle, '会员生效中', '状态句前半段做大标题');
  assert.equal(p.data.heroSub, '有效期至 2026年12月3日', '有效期做副标题，不重复整句');
  assert.equal(p.data.cards[0].priceText, '1.99 元');
  assert.equal(p.data.cards[1].perDayText, '约 0.05 元/天');
  assert.equal(p.data.selectedPriceText, '1.99 元', '按钮上的实付价跟随默认第一档');
  assert.equal(p.data.bestValueKey, 'year_card', '日均最低落在年卡（1699/365 < 199/30）');
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

test('MP14 页头会员卡：渐变底 + 权益图标，五个蓝色字形都入包', () => {
  const w = read('miniprogram/pages/member/member.wxml');
  assert.ok(w.includes('class="member-hero"'), '应有页头会员卡');
  assert.ok(w.includes('class="hero-perks"') && w.includes('heroPerksView'), '权益走图标宫格');
  const css = read('miniprogram/pages/member/member.wxss');
  assert.ok(!css.includes('member-hero-img'), '不再用插画底图');
  ['ban', 'download', 'image', 'bell', 'gem'].forEach((n) => {
    assert.ok(
      fs.existsSync(path.join(root, `miniprogram/assets/icons/lucide-${n}-blue.png`)),
      `蓝色字形 ${n} 要入包`,
    );
  });
});

test('MP15 页面结构：页头卡 → 三列套餐卡 → 统一支付按钮', () => {
  const w = read('miniprogram/pages/member/member.wxml');
  const posHero = w.indexOf('class="member-hero"');
  const posCards = w.indexOf('class="plan-cards"');
  const posCard = w.indexOf('class="plan-card ');
  const posCta = w.indexOf('data-key="{{selectedKey}}"');
  assert.ok(posHero > 0 && posCards > posHero, '页头卡在前，套餐区在后');
  assert.ok(posCard > posCards && posCta > posCard, '套餐卡之后才是统一支付按钮');
  assert.match(w, /bindtap="onSelectPlan"/, '套餐卡可切换选中');
  assert.equal((w.match(/bindtap="onBuy"/g) || []).length, 1, '只保留一个统一支付按钮');
  assert.match(w, /plan\.key === bestValueKey/, '日均最低一档挂角标');
  assert.match(w, /{{selectedPriceText}}/, '按钮显示实付价');
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
  assert.equal(p.data.selectedPriceText, '1.99 元', '按钮实付价跟随默认档');
  assert.equal(p.data.heroPerksView[0].icon, '/assets/icons/lucide-gem-blue.png', '认不出的权益用中性字形兜底');

  p.onSelectPlan({ currentTarget: { dataset: { key: 'year_card' } } });
  assert.equal(p.data.selectedKey, 'year_card');
  assert.deepEqual(p.data.heroPerks, ['年卡权益'], '页头权益跟随选中档位');
  assert.equal(p.data.heroTitle, '会员年卡', '页头标题跟随选中档位');
  assert.equal(p.data.selectedPriceText, '16.99 元', '按钮实付价跟随选中档');

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

test('MP18 页头状态句只出现一次：heroTitle 已承担，不再重复渲染 statusText', () => {
  const w = read('miniprogram/pages/member/member.wxml');
  assert.equal((w.match(/\{\{statusText\}\}/g) || []).length, 0, 'statusText 不进模板，只通过 heroTitle 输出');
  assert.ok(!w.includes('class="hero-status"'), '旧的状态行已删除，避免与标题重复');
  assert.ok(w.includes('class="hero-title"') && w.includes('{{heroTitle}}'), '标题位仍在');
});


test('MP19 到期提醒：读取服务端开关/模板/状态，会员才展示', async () => {
  reset({ fixture: { entitlements: { memberActive: true, memberUntil: Date.now() + 86400000, adFreeUntil: 0 } } });
  const p = boot();
  await tick();
  assert.equal(p.data.reminder.enabled, true);
  assert.equal(p.data.reminder.templateId, 'TPL_TEST');
  assert.equal(p.data.reminder.subscribed, false);
  const w = read('miniprogram/pages/member/member.wxml');
  assert.match(w, /entitlements.memberActive && reminder.enabled/);
});

test('MP20 开启提醒：accept 才上报 grant，成功后状态变已开启', async () => {
  reset({ fixture: { entitlements: { memberActive: true, memberUntil: Date.now() + 86400000, adFreeUntil: 0 } } });
  const p = boot();
  await tick();
  subscribeRespond = (o) => o.success({ TPL_TEST: 'accept' });
  p.onEnableReminder();
  await tick();
  assert.equal(grantCalls.length, 1);
  assert.equal(grantCalls[0].path, '/member/reminder/grant');
  assert.equal(grantCalls[0].body.scene, 'member_center');
  assert.equal(p.data.reminder.subscribed, true);
  assert.ok(toasts.includes('已开启到期提醒'));
});

test('MP21 拒绝/失败：不上报 grant、状态不变', async () => {
  reset({ fixture: { entitlements: { memberActive: true, memberUntil: Date.now() + 86400000, adFreeUntil: 0 } } });
  const p = boot();
  await tick();
  subscribeRespond = (o) => o.success({ TPL_TEST: 'reject' });
  p.onEnableReminder();
  await tick();
  assert.equal(grantCalls.length, 0);
  assert.equal(p.data.reminder.subscribed, false);

  subscribeRespond = (o) => o.fail();
  p.onEnableReminder();
  await tick();
  assert.equal(grantCalls.length, 0);
  assert.ok(toasts.includes('微信订阅未完成'));
});

test('MP22 支付成功：弹开启提醒；点开启走订阅并上报', async () => {
  reset({ fixture: { entitlements: { memberActive: true, memberUntil: Date.now() + 86400000, adFreeUntil: 0 } } });
  const p = boot();
  await tick();
  await p.onBuy({ currentTarget: { dataset: { key: 'month_card' } } });
  await tick();
  assert.equal(modals.length, 1);
  assert.match(modals[0].content, /到期前 3 天/);
  modals[0].success({ confirm: true });
  await tick();
  assert.equal(grantCalls.length, 1);
  assert.equal(p.data.reminder.subscribed, true);
});

/* ------------------------- 进页防闪（缓存先渲染） ------------------------- */

const CACHE_KEY = 'memberCenterCache_v1';

test('MP23 进页防闪：成功落盘缓存；再进页先渲染缓存不切加载态，仍静默重拉', async () => {
  reset();
  const p1 = boot();
  await tick();
  assert.equal(p1.data.cards.length, 2);
  const cached = storageMap[CACHE_KEY];
  assert.ok(cached && cached.payload && cached.userId === 'u1', '成功拉取后落盘缓存，带 userId 防串用户');

  const callsBefore = apiCalls.length;
  productsRespond = () => new Promise(() => {}); // 重拉挂起：观察进页瞬间的屏上状态
  const p2 = boot();
  assert.equal(p2.data.loading, false, '有缓存进页瞬间不切加载态（旧实现会先 setData loading:true）');
  assert.equal(p2.data.cards.length, 2, '缓存直接渲染套餐卡');
  assert.equal(p2.data.heroTitle, '会员月卡', '页头标题也从缓存渲染，不闪空白');
  assert.equal(p2.data.loggedIn, true);
  assert.ok(apiCalls.length > callsBefore, '渲染缓存后仍发静默重拉');
});

test('MP24 串用户防护：缓存 userId 与当前用户不一致不画缓存', async () => {
  reset();
  const p1 = boot();
  await tick();
  storageMap[CACHE_KEY].userId = 'someone_else';
  productsRespond = () => new Promise(() => {});
  const p2 = boot();
  assert.equal(p2.data.loading, true, '别人的缓存不渲染，走正常加载态');
  assert.equal(p2.data.cards.length, 0);
});

test('MP25 token 解不出 userId：不画缓存，走正常加载', async () => {
  reset();
  const p1 = boot();
  await tick();
  storageMap[CACHE_KEY].userId = null; // 历史脏缓存（旧版 userInfo 竞态写下的 null）
  token = { accessToken: 'not-a-jwt' };
  productsRespond = () => new Promise(() => {});
  const p2 = boot();
  assert.equal(p2.data.loading, true);
  assert.equal(p2.data.cards.length, 0);
});

test('MP26 缓存进页后静默重拉失败：保留内容、不转错误态、不 toast', async () => {
  reset();
  const p1 = boot();
  await tick();
  productsRespond = () => Promise.reject(new Error('network'));
  const p2 = boot();
  await tick();
  await tick();
  assert.equal(p2.data.cards.length, 2, '重拉失败不清屏');
  assert.equal(p2.data.failed, false);
  assert.equal(p2.data.loading, false);
  assert.deepEqual(toasts, [], '进页静默失败不弹 toast（下拉刷新才弹）');
});
