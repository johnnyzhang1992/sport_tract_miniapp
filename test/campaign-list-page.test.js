/**
 * 一起运动活动列表页（pages/campaign-list/campaign-list.js）页级回归：
 * 默认档位必须是「我参与」——Tab 顺序「我参与 | 我发起」，进页首个请求就是 role=joined；
 * 「我发起」退到第二档，只有用户点了才请求。
 * 运行：npm test；桩：wx / Page / getApp 就地 stub，services/api 用 require.cache 注入假实现。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

/* ---------------------------------- 环境桩 ---------------------------------- */

const apiCalls = [];
let respond = () => Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20 });
const fakeApi = {
  get(p) {
    apiCalls.push(p);
    return respond(p);
  },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

global.wx = { showToast: () => {}, stopPullDownRefresh: () => {} };
let pageDef = null;
global.Page = (def) => { pageDef = def; };
global.getApp = () => ({ globalData: { loggedIn: true }, hasSession: () => true, login: () => Promise.resolve() });

require('../miniprogram/pages/campaign-list/campaign-list.js');
assert.ok(pageDef, 'campaign-list.js 应通过 Page() 交出页面对象');

/* --------------------------------- 页面装配 --------------------------------- */

/** switchTab 不 return refresh 的 promise：测试要等它跑完就得把这次调用截下来 */
function makePage() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch = {}) => Object.assign(p.data, patch);
  let done = Promise.resolve();
  p.refresh = (...a) => { done = pageDef.refresh.apply(p, a); return done; };
  p.done = () => done;
  return p;
}

/* ---------------------------------- 用例 ---------------------------------- */

test('CL1 默认档位是「我参与」', () => {
  assert.equal(pageDef.data.tab, 'joined');
});

test('CL2 Tab 顺序「我参与」在前', () => {
  assert.deepEqual(pageDef.data.tabs.map((t) => t.key), ['joined', 'created']);
});

test('CL3 进页请求 role=joined，点「我发起」才请求 role=created', async () => {
  const p = makePage();
  await p.refresh();
  p.switchTab({ currentTarget: { dataset: { tab: 'created' } } });
  await p.done();
  assert.deepEqual(apiCalls, ['/campaigns?role=joined', '/campaigns?role=created']);
});

test('CL4 卡片字段：带标签时间行 + 头像堆叠（前 3）+ 人数', async () => {
  respond = () =>
    Promise.resolve({
      items: [
        {
          id: 'c1',
          title: '晨跑',
          status: 'active',
          startAt: Date.UTC(2026, 8, 30, 16, 0, 0), // 东八区 10-01
          endAt: Date.UTC(2026, 9, 7, 16, 0, 0), // 结束日 10-07
          myStats: { count: 2, distance: 12340, duration: 600 },
          memberCount: 5,
          memberAvatars: [
            { avatarUrl: 'https://x/a.png?sig=1', avatarPreset: 'default-1' },
            { avatarUrl: '', avatarPreset: 'default-2' },
            { avatarUrl: '', avatarPreset: '' },
          ],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });

  const p = makePage();
  await p.refresh();
  const card = p.data.items[0];

  assert.equal(card.timeText, '开始 2026/10/01 · 结束 2026/10/07');
  assert.equal(card.memberText, '5 人已加入');
  assert.deepEqual(card.avatarList, [
    { key: 0, src: 'https://x/a.png?sig=1' },
    { key: 1, src: '/assets/avatars/default-2.png' },
    { key: 2, src: '' },
  ]);
  assert.equal(card.statsText, '我的运动 2 次 · 12.34 km · 10min');
  assert.equal(card.statusTag, 'campaign-tag--active', '卡片也要带共享修饰类');
});

test('CL5 状态标签改用共享类，且不再按状态过滤（进行中也渲染，与详情页一致）', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../miniprogram/pages/campaign-list/campaign-list.wxml'),
    'utf8',
  );
  assert.match(
    src,
    /class="campaign-tag \{\{item\.statusTag\}\}"/,
    '列表卡片要改用 app.wxss 的共享 .campaign-tag，别再留一份 .cp-tag',
  );
  assert.ok(
    !/status\s*!==\s*'active'/.test(src),
    "不能再有 status !== 'active' 的过滤：三态都要出标签，否则列表和详情页对同一个活动显示不一致",
  );
  assert.ok(!src.includes('cp-tag'), '.cp-tag 应已从列表 wxml 消失');
});
