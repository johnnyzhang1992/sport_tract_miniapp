/**
 * 首页「一起运动」区块（pages/index/index.js 的 loadCampaigns / toCampaignCard）。
 * 为什么要测：区块改版把卡片从「堆 3 行 + 独立查看全部行」压成「标题行 + 横滑卡片（有活动就出现）」，
 * 副标题也随之**去掉活动日期**、只留「我的汇总」。这两点都落在 JS 侧的数据契约上：
 *   - 卡上不再有 rangeText（日期一旦算出来，WXML 就有机会再渲染回去）；
 *   - statsText 仍是「我的 X 次 · Y km · Z」。
 * 观感（卡片宽度档 / 横滑 / 高度）node 测不了，另外由模拟器截图核。
 * 运行：npm test；桩同 index-overview.test.js。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

/* ---------------------------------- 环境桩 ---------------------------------- */

const apiCalls = [];
/** 用例内改写：(path) => Promise<data> */
let respond = () => Promise.resolve({});
const fakeApi = {
  get(p) {
    apiCalls.push(p);
    return respond(p);
  },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  showToast: () => {},
  nextTick: (cb) => cb(),
  stopPullDownRefresh: () => {},
};
let pageDef = null;
global.Page = (def) => { pageDef = def; };
/**
 * 用例内可改写，两个开关要分开：
 *   sessionStub  = 本地有没有 token（app.hasSession()）——api.get 是从 storage 取 token 的
 *   loggedInStub = globalData.loggedIn —— 冷启动时静默恢复还没跑完，它是 false 但 token 已在
 * 分开才能钉住「闸门用 hasSession，不能用 loggedIn」，否则会把老用户误判成游客。
 */
let sessionStub = true;
let loggedInStub = true;
global.getApp = () => ({
  hasSession: () => sessionStub,
  globalData: { loggedIn: loggedInStub, api: fakeApi },
  maybeShowProfileGuide: () => {},
});

require('../miniprogram/pages/index/index.js');
assert.ok(pageDef, 'index.js 应通过 Page() 交出页面对象');

/* --------------------------------- 页面装配 --------------------------------- */

function makePage() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch) => Object.assign(p.data, patch);
  return p;
}

function resetEnv() {
  apiCalls.length = 0;
  respond = () => Promise.resolve({});
  sessionStub = true;
  loggedInStub = true;
}

/** 造一条活动列表项（服务端已派生 status / startAt / endAt / myStats） */
function campaign(over = {}) {
  return Object.assign(
    {
      id: 'c1',
      title: '晨跑队',
      status: 'active',
      startAt: Date.UTC(2026, 8, 30, 16),
      endAt: Date.UTC(2026, 9, 7, 16),
      myStats: { count: 3, distance: 4200, duration: 600 },
    },
    over,
  );
}

/* ---------------------------------- 用例 ---------------------------------- */

test('IC1 首页活动卡：不出日期，指标两格＝距离 / 时长（次数不展示）', async () => {
  resetEnv();
  respond = (p) => {
    if (p === '/campaigns?role=created') return Promise.resolve({ items: [campaign()] });
    if (p === '/campaigns?role=joined') return Promise.resolve({ items: [] });
    return Promise.resolve({});
  };

  const p = makePage();
  await p.loadCampaigns();

  assert.equal(p.data.campaigns.length, 1);
  const card = p.data.campaigns[0];
  assert.equal(card.rangeText, undefined, '日期不再下发——留在数据里 WXML 就会再渲染回去');
  assert.deepEqual(
    card.metricItems,
    [
      { key: 'dist', text: '4.20', label: '公里' },
      { key: 'dur', text: '10min', label: '' },
    ],
    '指标＝距离 + 时长，次数不再展示；时长自带 min/h+m 单位，label 留空',
  );
});

test('IC3 卡片成员面：人数 + 头像堆叠（url 优先、preset 回退、都没有则空）', async () => {
  resetEnv();
  respond = (p) => {
    if (p === '/campaigns?role=created') {
      return Promise.resolve({
        items: [
          campaign({
            memberCount: 5,
            memberAvatars: [
              { avatarUrl: 'https://oss.example/a.png?sig=1', avatarPreset: 'p1' },
              { avatarUrl: '', avatarPreset: 'p2' },
              { avatarUrl: '', avatarPreset: '' },
            ],
          }),
        ],
      });
    }
    if (p === '/campaigns?role=joined') return Promise.resolve({ items: [] });
    return Promise.resolve({});
  };

  const p = makePage();
  await p.loadCampaigns();

  const card = p.data.campaigns[0];
  assert.equal(card.memberText, '5 人');
  assert.deepEqual(
    card.avatarList.map((a) => a.src),
    ['https://oss.example/a.png?sig=1', '/assets/avatars/p2.png', ''],
    '有签名 url 用 url；否则回退 preset 图；都没有留空',
  );
});

test('IC2 选择规则不变：两路按 id 去重、只留 active、最多 3 条', async () => {
  resetEnv();
  respond = (p) => {
    if (p === '/campaigns?role=created') {
      return Promise.resolve({
        items: [campaign({ id: 'c1' }), campaign({ id: 'c2' }), campaign({ id: 'c3' }), campaign({ id: 'c4' })],
      });
    }
    if (p === '/campaigns?role=joined') {
      // c1 与 created 重复 → 去重；c9 已结束 → 过滤
      return Promise.resolve({ items: [campaign({ id: 'c1' }), campaign({ id: 'c9', status: 'ended' })] });
    }
    return Promise.resolve({});
  };

  const p = makePage();
  await p.loadCampaigns();

  assert.deepEqual(
    p.data.campaigns.map((c) => c.id),
    ['c1', 'c2', 'c3'],
    '去重 + 只留 active + 截前 3',
  );
});

test('IC4 只有 1 条时也按普通卡片宽度展示，不再占满整行', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../miniprogram/pages/index/index.wxml'),
    'utf8',
  );
  assert.ok(
    !src.includes('camp-scroll-single'),
    '单条的「占满宽」特例要拿掉：1 条与多条共用同一套卡片宽度，否则只有一条时卡片的观感跟其余情况完全不同',
  );
});

test('IC5 游客不发请求：两个列表接口必然 401，区块直接退化为引导', async () => {
  resetEnv();
  sessionStub = false; // 本地没有 token＝真游客
  loggedInStub = false; // 游客也不可能有登录态
  respond = () => Promise.resolve({ items: [campaign()] });

  const p = makePage();
  await p.loadCampaigns();

  assert.deepEqual(apiCalls, [], '游客一个请求都不该发（服务端 /campaigns 未登录直接 401）');
  assert.deepEqual(p.data.campaigns, [], 'campaigns 清空 → 区块走「发起一个活动」引导');
});

test('IC6 闸门判 hasSession 不判 loggedIn：冷启动静默恢复还没跑完时照样要发', async () => {
  resetEnv();
  sessionStub = true; // token 已在 storage 里，api.get 取得到
  loggedInStub = false; // 但 onShow 不 await app.login()，globalData.loggedIn 还是 false
  respond = () => Promise.resolve({ items: [campaign()] });

  const p = makePage();
  await p.loadCampaigns();

  assert.deepEqual(
    apiCalls,
    ['/campaigns?role=created', '/campaigns?role=joined'],
    '老用户冷启动不该被误判成游客：用 loggedIn 当闸门就会在这里把请求吞掉',
  );
  assert.equal(p.data.campaigns.length, 1, '恢复中的这一趟仍要渲染出卡片');
});
