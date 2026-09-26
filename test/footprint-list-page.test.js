/**
 * 足迹列表独立页（pages/footprint-list/footprint-list.js）页级回归：
 * 列表形态从 footprints 页迁出后独占一页，原「触底翻页三条件回退闸门」「seq 守卫」「toCard 字段映射」
 * 「详情/表单组件接线」都要保住，另加本页新增的下拉刷新与首屏/刷新失败分档。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 * 桩：wx / Page / getApp 就地 stub；services/api 用 require.cache 注入假实现（绕开 config/storage 的真实
 *     wx 依赖）；respond 钩子按 { path, params } 决定这一轮返回什么，用例内逐条改写。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/* ---------------------------------- 环境桩 ---------------------------------- */

const apiCalls = [];
/** 用例内改写的响应钩子：(path, params) => Promise<data> */
let respond = () => Promise.resolve({ items: [], total: 0 });
// /calendar 是总览 + 打点数据，与列表请求分开桩，避免两个请求互相踩默认值
let calendarRespond = () => Promise.resolve({ total: 0, placeCount: 0, photoCount: 0, days: [] });
const fakeApi = {
  get(p, params) {
    apiCalls.push({ path: p, params });
    return p === '/footprint-records/calendar' ? calendarRespond(p, params) : respond(p, params);
  },
  del() {
    return Promise.resolve({});
  },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const toasts = [];
const navs = [];
const modals = []; // 登录闸门调起的 wx.showModal（用例自己决定用户点了确认还是取消）
let stopPullDownCalls = 0;
global.wx = {
  showToast: (o) => toasts.push(o && o.title),
  navigateTo: (o) => navs.push(o && o.url),
  nextTick: (cb) => cb(),
  stopPullDownRefresh: () => { stopPullDownCalls++; },
  showModal: (o) => modals.push(o),
};
let pageDef = null;
global.Page = (def) => { pageDef = def; };

/**
 * getApp 桩：默认「已登录」（本页正常只能从地图页进来，是个已登录流程；分享链接直达才会是游客），
 * 登录态相关的用例自己调到游客档。hasSession = 本地有 token 的老用户，与 loggedIn 不同轴。
 */
let loginCalls = 0;
const appStub = {
  globalData: { loggedIn: true },
  hasSession: () => true,
  login() {
    loginCalls++;
    appStub.globalData.loggedIn = true;
    return Promise.resolve({});
  },
};
function resetAppStub(over = {}) {
  loginCalls = 0;
  appStub.globalData.loggedIn = over.loggedIn !== undefined ? over.loggedIn : true;
  appStub.globalData.fpDirty = over.fpDirty === true; // 跨页脏标记：默认干净，别让上一个用例漏过来
  appStub.hasSession = () => (over.hasSession !== undefined ? over.hasSession : true);
}
global.getApp = () => appStub;

require('../miniprogram/pages/footprint-list/footprint-list.js');
assert.ok(pageDef, 'footprint-list.js 应通过 Page() 交出页面对象');

/* --------------------------------- 页面装配 --------------------------------- */

function applyPath(target, keyPath, value) {
  const keys = keyPath.split('.');
  let o = target;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

function makePage() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch, cb) => {
    Object.keys(patch).forEach((k) => applyPath(p.data, k, patch[k]));
    if (cb) cb();
  };
  return p;
}

const tick = () => new Promise((r) => setImmediate(r));
/** 排空 promise 链（loadAll → fetchPage → setData） */
async function flush() {
  for (let i = 0; i < 5; i++) await tick();
}

/** 一条记录（卡片字段由 toCard 补齐，用例只给原始 DTO 形态：后端同时给 photos 原图与 photoThumbs 缩略图） */
function rec(id, over = {}) {
  return Object.assign({ id, title: '足迹' + id, visitDate: '2026-05-01', people: [], photos: [], photoThumbs: [], location: {} }, over);
}

/** 分页桩：按 params.page/pageSize 从 all 里切一页，total 恒为 all.length */
function pagedRespond(all) {
  return (p, params) => {
    const start = (params.page - 1) * params.pageSize;
    return Promise.resolve({ items: all.slice(start, start + params.pageSize), total: all.length });
  };
}

function resetEnv() {
  apiCalls.length = 0;
  toasts.length = 0;
  navs.length = 0;
  modals.length = 0;
  stopPullDownCalls = 0;
  respond = () => Promise.resolve({ items: [], total: 0 });
  calendarRespond = () => Promise.resolve({ total: 0, placeCount: 0, photoCount: 0, days: [] });
  resetAppStub();
}

/* ---------------------------------- 用例 ---------------------------------- */

test('L1 首屏：GET /footprint-records page=1 替换整页，卡片字段由 toCard 算好', async () => {
  resetEnv();
  respond = (p, params) => {
    assert.equal(p, '/footprint-records');
    assert.deepEqual(params, { page: 1, pageSize: 20 });
    return Promise.resolve({
      total: 2,
      items: [
        rec('a', { visitDate: '2026-09-05', description: 'make 北魏 Great again!', people: ['小李', '', null], photos: ['https://cdn/o1.jpg'], photoThumbs: ['https://cdn/t1.jpg'], location: { city: '杭州市', address: '浙江省杭州市西湖区' } }),
        rec('b', { visitDate: '2026-10-20', location: { name: '故宫' } }),
      ],
    });
  };
  const page = makePage();
  const running = page.loadAll();
  assert.equal(page.data.loading, true, '首屏进 loading 态');
  await running;
  assert.equal(page.data.loading, false);
  assert.equal(page.data.items.length, 2);
  const a = page.data.items[0];
  assert.equal(a.dayNum, '5', '日期徽章：日去前导零');
  assert.equal(a.monthNum, '9月');
  assert.equal(a.metaText, '浙江省杭州市西湖区 · 和小李', '地址优先，同行并到同一行（竞片卡片形态）');
  assert.equal(a.descText, 'make 北魏 Great again!');
  assert.deepEqual(a.photoThumbs, ['https://cdn/t1.jpg'], '照片行用缩略图档（一屏 30 图不该拉原图）');
  assert.deepEqual(a.photos, ['https://cdn/o1.jpg'], '原图字段原样透传（点开大图才用）');
  assert.equal(a.peopleText, '小李', 'people 过滤空值后 join（wxml 不能 join 数组）');
  const b = page.data.items[1];
  assert.equal(b.metaText, '故宫', '无 address/city 时回落地点名');
  assert.equal(b.descText, '');
  assert.deepEqual(b.photoThumbs, []);
  assert.equal(page.data.hasMore, false, '2 条已达 total → 到底');
  assert.deepEqual(
    page.data.groups.map((g) => g.label),
    ['2026年9月', '2026年10月'],
    '列表态按 visitDate 分组（跨页同月不重复开组由 groupByMonth 保证）',
  );
});

test('L2 触底翻页：第二页追加不覆盖，到底后闸门拦住不再请求', async () => {
  resetEnv();
  respond = pagedRespond([rec('a'), rec('b'), rec('c')]);
  const page = makePage();
  page.setData({ pageSize: 2 }); // 缩小页长，3 条数据刚好两页
  await page.loadAll();
  assert.deepEqual(page.data.items.map((r) => r.id), ['a', 'b']);
  assert.equal(page.data.hasMore, true, 'items(2) < total(3) → 还有下一页');

  page.onReachBottom();
  await flush();
  assert.deepEqual(page.data.items.map((r) => r.id), ['a', 'b', 'c'], '第二页追加（不覆盖第一页）');
  assert.equal(page.data.page, 2);
  assert.equal(page.data.hasMore, false, 'fresh 非空且 items.length === total');
  assert.equal(page.data.loadingList, false, '尾提示收起');

  const calls = apiCalls.length;
  page.onReachBottom();
  await flush();
  assert.equal(apiCalls.length, calls, '已到底：触底不再发请求');
});

test('L3 翻页失败：页码退回上一页（seq/loadingList/page 三条件）；加载中触底不重入', async () => {
  resetEnv();
  respond = pagedRespond([rec('a'), rec('b'), rec('c')]);
  const page = makePage();
  page.setData({ pageSize: 2 });
  await page.loadAll();

  respond = () => Promise.reject(new Error('网络错误'));
  page.onReachBottom();
  assert.equal(page.data.page, 2, '发请求前先占住页码');
  const inFlight = page.data.loadingList;
  assert.equal(inFlight, true, '翻页中 loadingList 为真');
  page.onReachBottom(); // 重入：闸门应拦住
  assert.equal(apiCalls.length, 2, '同一页不会重复发请求（总共 首屏 + 1 次翻页）');
  await flush();
  assert.equal(page.data.page, 1, '翻页失败要退回页码，否则这次触底白翻一页、数据留空洞');
  assert.equal(page.data.loadingList, false);
  assert.equal(page.data.items.length, 2, '失败不清空已渲染内容');
});

test('L4 失败分档：首屏失败整页错误态，刷新失败保留内容只 toast', async () => {
  resetEnv();
  respond = () => Promise.reject(new Error('加载失败X'));
  const page = makePage();
  await page.loadAll();
  assert.equal(page.data.error, '加载失败X', '首屏失败没有可展示内容 → 整页错误态');
  assert.equal(page.data.loading, false);

  respond = pagedRespond([rec('a')]);
  await page.loadAll();
  assert.equal(page.data.error, '');
  assert.equal(page.data.items.length, 1);

  respond = () => Promise.reject(new Error('刷新失败Y'));
  await page.loadAll();
  assert.equal(page.data.error, '', '刷新失败仍保留已渲染列表，不切整页错误态');
  assert.equal(page.data.items.length, 1, '刷新失败不清空 items');
  assert.equal(toasts[toasts.length - 1], '刷新失败Y', '刷新失败用 toast 提示');
});

test('L5 下拉刷新：重拉第一页并收起下拉指示器', async () => {
  resetEnv();
  respond = pagedRespond([rec('a'), rec('b')]);
  const page = makePage();
  await page.loadAll();
  page.setData({ page: 2 });
  page.onPullDownRefresh(); // 页面方法自己不返回 promise，收尾在 syncData().finally 里
  await flush();
  assert.equal(page.data.page, 1, '下拉刷新回第一页');
  assert.equal(stopPullDownCalls, 1, 'syncData 完成后必须 stopPullDownRefresh');
  // 用列表口径筛，不取 apiCalls 末条：syncData 里 list 与 /calendar 的先后顺序不是本用例的契约
  assert.equal(listCalls()[listCalls().length - 1].params.page, 1);
});

test('L6 详情/表单接线：点卡片走完整 DTO 快路径；保存与删除后都重拉第一页', async () => {
  resetEnv();
  respond = pagedRespond([rec('a'), rec('b'), rec('c')]);
  const page = makePage();
  page.setData({ pageSize: 2 });
  await page.loadAll();

  const callsBefore = apiCalls.length;
  page.onCardTap({ currentTarget: { dataset: { id: 'b' } } });
  assert.equal(page.data.detailVisible, true);
  assert.equal(page.data.detailRecord.id, 'b', 'items 是完整 DTO：详情组件走快路径');
  assert.equal(apiCalls.length, callsBefore, '点卡片不再补拉详情');
  page.onCardTap({ currentTarget: { dataset: { id: '不存在' } } });
  assert.equal(page.data.detailRecord.id, 'b', '按 id 找不到记录时不开详情、不覆盖已开内容');

  page.onDetailEdit({ detail: page.data.detailRecord });
  assert.equal(page.data.detailVisible, false, '开表单前先关详情');
  assert.equal(page.data.detailRecord, null);
  assert.equal(page.data.formVisible, true);
  assert.equal(page.data.formRecord.id, 'b');

  page.setData({ page: 3 }); // 页码停在深页时保存
  page.onFormSaved();
  assert.equal(page.data.formVisible, false);
  await flush();
  assert.equal(apiCalls[apiCalls.length - 1].params.page, 1, '保存后重拉第一页（不留在深页区间）');
  assert.equal(page.data.page, 1);

  page.setData({ detailVisible: true, detailRecord: rec('a') });
  page.onDetailDeleted();
  assert.equal(page.data.detailVisible, false);
  assert.equal(page.data.detailRecord, null);
  await flush();
  assert.equal(apiCalls[apiCalls.length - 1].params.page, 1, '删除后也回第一页重拉');

  page.closeDetail();
  assert.equal(page.data.detailVisible, false);
});

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

test('L7 搜索：输入不请求；点搜索/回车才带 keyword 重拉；清空 ✕ 去词重搜', async () => {
  resetEnv();
  respond = pagedRespond([rec('a')]);
  const page = makePage();
  await page.loadAll();

  page.onKeywordInput({ detail: { value: '西湖' } });
  assert.equal(page.data.keywordInput, '西湖');
  assert.equal(page.data.keyword, '', '输入框内容未提交前不生效');
  assert.equal(apiCalls.length, 1, '输入不触发请求');

  page.onSearch();
  await flush();
  assert.equal(page.data.keyword, '西湖');
  assert.equal(page.data.filtered, true);
  assert.equal(apiCalls[apiCalls.length - 1].params.keyword, '西湖');
  assert.equal(apiCalls[apiCalls.length - 1].params.page, 1, '搜索重拉第一页');

  page.onKeywordInput({ detail: { value: '  故宫  ' } });
  page.onSearch();
  await flush();
  assert.equal(page.data.keyword, '故宫', '首尾空格被 trim');
  assert.equal(page.data.keywordInput, '故宫', '回填去空格后的词');

  page.onClearKeyword();
  await flush();
  assert.equal(page.data.keyword, '');
  assert.equal(page.data.keywordInput, '');
  assert.equal(page.data.filtered, false);
  assert.equal('keyword' in apiCalls[apiCalls.length - 1].params, false, '清空后请求不带 keyword');
});

test('L8 时间筛选：默认全部不带区间；切月/翻页/抽屉都带对 from/to；切档偏移归零', async () => {
  resetEnv();
  respond = pagedRespond([rec('a')]);
  const page = makePage();
  page.onLoad(); // 真实生命周期：applyPeriod + loadAll
  await flush();
  assert.deepEqual(apiCalls[0].params, { page: 1, pageSize: 20 }, '默认「全部」不带 from/to');
  assert.equal(page.data.activeRange, 'all');
  assert.equal(page.data.filtered, false);

  const now = new Date();
  page.onRangeChange({ currentTarget: { dataset: { value: 'month' } } });
  await flush();
  assert.equal(page.data.periodLabel, `${now.getFullYear()}年${now.getMonth() + 1}月`);
  assert.equal(apiCalls[apiCalls.length - 1].params.from, fmt(new Date(now.getFullYear(), now.getMonth(), 1)));
  assert.equal(apiCalls[apiCalls.length - 1].params.to, fmt(new Date(now.getFullYear(), now.getMonth() + 1, 1)));
  assert.equal(page.data.filtered, true, '时间筛选也算生效筛选');

  page.onPrevPeriod();
  await flush();
  assert.equal(page.data.periodOffset, 1);
  assert.equal(page.data.canGoNext, true);
  assert.equal(apiCalls[apiCalls.length - 1].params.from, fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)));

  page.onTapPeriodLabel();
  assert.equal(page.data.periodOptions.length, 12, '月粒度最近 12 个月');
  assert.equal(page.data.pickerScrollInto, 'period-1', '滚动定位到当前周期');
  page.onSelectPeriod({ currentTarget: { dataset: { offset: 3 } } });
  await flush();
  assert.equal(page.data.periodOffset, 3);
  const start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  assert.equal(apiCalls[apiCalls.length - 1].params.from, fmt(start));
  assert.equal(apiCalls[apiCalls.length - 1].params.to, fmt(new Date(start.getFullYear(), start.getMonth() + 1, 1)));

  page.onRangeChange({ currentTarget: { dataset: { value: 'year' } } });
  await flush();
  assert.equal(page.data.periodOffset, 0, '切档偏移归零');
  assert.equal(apiCalls[apiCalls.length - 1].params.from, `${now.getFullYear()}-01-01`);

  page.onRangeChange({ currentTarget: { dataset: { value: 'all' } } });
  await flush();
  assert.equal('from' in apiCalls[apiCalls.length - 1].params, false, '回「全部」不带区间');
  assert.equal(page.data.filtered, false);
  assert.equal(page.data.periodLabel, '');
});

test('L9 空态分档：有筛选才置 filtered；「清空筛选」清搜索并回全部', async () => {
  resetEnv();
  respond = () => Promise.resolve({ items: [], total: 0 });
  const page = makePage();
  page.onLoad();
  await flush();
  assert.equal(page.data.items.length, 0);
  assert.equal(page.data.filtered, false, '无筛选空列表 → wxml 走原文案（去地图页记录）');

  page.onKeywordInput({ detail: { value: '不存在的地方' } });
  page.onSearch();
  await flush();
  assert.equal(page.data.filtered, true, '有筛选空列表 → wxml 走「没有匹配的足迹」+ 清空筛选');

  page.onClearFilter();
  await flush();
  assert.equal(page.data.keyword, '');
  assert.equal(page.data.keywordInput, '');
  assert.equal(page.data.activeRange, 'all');
  assert.equal(page.data.filtered, false);
  assert.deepEqual(apiCalls[apiCalls.length - 1].params, { page: 1, pageSize: 20 }, '清空后回到无筛选请求');
});

test('L10 带筛选翻页：第二页请求仍携带 keyword 与 from/to，追加不覆盖', async () => {
  resetEnv();
  respond = pagedRespond([rec('a'), rec('b'), rec('c')]);
  const page = makePage();
  page.setData({ pageSize: 2 });
  page.onLoad();
  await flush();

  page.onKeywordInput({ detail: { value: '西湖' } });
  page.onSearch();
  page.onRangeChange({ currentTarget: { dataset: { value: 'year' } } });
  await flush();
  assert.equal(page.data.hasMore, true, '3 条 / 每页 2 → 还有下一页');

  page.onReachBottom();
  await flush();
  const last = apiCalls[apiCalls.length - 1].params;
  assert.equal(last.page, 2);
  assert.equal(last.keyword, '西湖', '翻页仍带搜索词');
  assert.equal(last.from, `${new Date().getFullYear()}-01-01`, '翻页仍带时间区间');
  assert.deepEqual(page.data.items.map((r) => r.id), ['a', 'b', 'c'], '第二页追加');
});

/* ------------------------------ 两态改版：总览 / 日历态 / 顶部入口 ------------------------------ */

const calCalls = () => apiCalls.filter((c) => c.path === '/footprint-records/calendar');
const listCalls = () => apiCalls.filter((c) => c.path === '/footprint-records');

test('L11 总览与打点：onLoad 拉一次 /calendar 拼出总览文案；失败给具体原因不静默', async () => {
  resetEnv();
  respond = pagedRespond([rec('a')]);
  calendarRespond = () => Promise.resolve({ total: 4, placeCount: 4, photoCount: 18, days: [{ date: '2026-09-20', count: 2 }] });
  const page = makePage();
  page.onLoad();
  await flush();
  assert.equal(calCalls().length, 1, '首屏拉一次日历/总览');
  assert.equal(page.data.summaryText, '4 条记录 · 4 个地方 · 18 张照片');
  assert.equal(page.data.calendarDays.length, 1);
  assert.equal(page.data.calendarMonth, `${new Date().getFullYear()}-${pad(new Date().getMonth() + 1)}`, '默认落在当前月');

  resetEnv();
  respond = pagedRespond([rec('a')]);
  calendarRespond = () => Promise.reject(new Error('日历接口 500'));
  const p2 = makePage();
  p2.onLoad();
  await flush();
  assert.ok(toasts.includes('日历接口 500'), '总览拉不到要 toast，不能凭空少一行');
  assert.equal(p2.data.summaryText, '');
});

test('L12 切日历态：请求带整月区间、不清 items（防闪屏）、标题变「本月 N 条」；切回列表态恢复', async () => {
  resetEnv();
  respond = pagedRespond([rec('a', { visitDate: '2026-09-20' }), rec('b', { visitDate: '2026-08-11' })]);
  const page = makePage();
  page.onLoad();
  await flush();
  assert.equal(page.data.view, 'list');

  page.onSwitchView({ currentTarget: { dataset: { view: 'calendar' } } });
  assert.equal(page.data.items.length, 2, '切态瞬间保留旧内容，不出现空窗闪屏');
  await flush();
  const now = new Date();
  const last = listCalls()[listCalls().length - 1].params;
  assert.equal(last.from, fmt(new Date(now.getFullYear(), now.getMonth(), 1)), '日历态默认整月区间');
  assert.equal(last.to, fmt(new Date(now.getFullYear(), now.getMonth() + 1, 1)));
  assert.equal('keyword' in last, false);
  assert.equal(page.data.sectionTitle, `本月 ${page.data.total} 条`);
  assert.deepEqual(page.data.groups, [], '日历态不分组（单月，直接渲染 items）');
  assert.equal(page.data.filtered, false, '整月不算筛选态');

  page.onSwitchView({ currentTarget: { dataset: { view: 'calendar' } } });
  assert.equal(listCalls().length, 2, '重复点当前态不再发请求');

  page.onSwitchView({ currentTarget: { dataset: { view: 'list' } } });
  await flush();
  const back = listCalls()[listCalls().length - 1].params;
  assert.equal('from' in back, false, '回列表态（默认「全部」）不带区间');
  assert.equal(page.data.sectionTitle, '', '列表态分组标题走 groups，不用 sectionTitle');
  assert.deepEqual(
    page.data.groups.map((g) => g.label),
    ['2026年9月', '2026年8月'],
    '列表态恢复按月分组',
  );
});

test('L13 点某天：区间收成那一天，再点同一天取消回整月', async () => {
  resetEnv();
  respond = pagedRespond([rec('a')]);
  calendarRespond = () => Promise.resolve({ total: 1, placeCount: 1, photoCount: 0, days: [{ date: '2026-09-20', count: 1 }] });
  const page = makePage();
  page.onLoad();
  page.onSwitchView({ currentTarget: { dataset: { view: 'calendar' } } });
  await flush();

  const day = `${page.data.calendarMonth}-20`;
  page.onCalendarDayTap({ detail: { date: day } });
  await flush();
  let last = listCalls()[listCalls().length - 1].params;
  assert.equal(last.from, day, '点选后区间起点就是那天');
  assert.equal(last.to, `${page.data.calendarMonth}-21`, '右开到次日');
  assert.equal(page.data.calendarSelected, day);
  assert.equal(page.data.filtered, true, '点选某天算筛选态');
  assert.equal(page.data.sectionTitle, `9月20日 · ${page.data.total} 条`);

  page.onCalendarDayTap({ detail: { date: day } });
  await flush();
  last = listCalls()[listCalls().length - 1].params;
  assert.equal(page.data.calendarSelected, '', '再点同一天取消选中');
  assert.equal(last.from, `${page.data.calendarMonth}-01`, '取消后回到整月区间');

  page.onCalendarDayTap({ detail: { date: '' } });
  assert.equal(listCalls().length, 4, '补白格（无 date）不触发请求');
});

test('L14 换月：区间跟随、选中清空、同月不重复请求', async () => {
  resetEnv();
  respond = pagedRespond([rec('a')]);
  const page = makePage();
  page.onLoad();
  page.onSwitchView({ currentTarget: { dataset: { view: 'calendar' } } });
  await flush();
  const before = listCalls().length;

  page.onCalendarMonthChange({ detail: { month: '2026-08' } });
  await flush();
  let last = listCalls()[listCalls().length - 1].params;
  assert.deepEqual({ from: last.from, to: last.to }, { from: '2026-08-01', to: '2026-09-01' });
  assert.equal(page.data.calendarMonth, '2026-08');

  page.onCalendarDayTap({ detail: { date: '2026-08-15' } });
  await flush();
  assert.equal(page.data.calendarSelected, '2026-08-15');
  page.onCalendarMonthChange({ detail: { month: '2026-07' } });
  await flush();
  assert.equal(page.data.calendarSelected, '', '换月要清掉上一月的点选，否则区间与月历对不上');
  last = listCalls()[listCalls().length - 1].params;
  assert.deepEqual({ from: last.from, to: last.to }, { from: '2026-07-01', to: '2026-08-01' });

  const n = listCalls().length;
  page.onCalendarMonthChange({ detail: { month: '2026-07' } });
  page.onCalendarMonthChange({ detail: { month: '' } });
  assert.equal(listCalls().length, n, '同月/空月都不再发请求');
  assert.equal(listCalls().length - before >= 3, true, '前面确实换过月');
});

test('L15 顶部入口：统计跳页、＋ 开新增态表单', async () => {
  resetEnv();
  respond = pagedRespond([rec('a')]);
  const page = makePage();
  page.onLoad();
  await flush();

  page.goStats();
  assert.deepEqual(navs, ['/packageFootprint/pages/footprint-stats/footprint-stats'], '统计仍是独立页');

  page.setData({ detailVisible: true, detailRecord: rec('a') });
  page.openAdd();
  assert.equal(page.data.formVisible, true);
  assert.equal(page.data.formRecord, null, 'record 为 null 即新增态（组件按此判定）');
  assert.equal(page.data.detailVisible, true, '＋ 不动详情弹层（此处仅验不误关）');
  page.closeForm();
  assert.equal(page.data.formVisible, false);
});

test('L16 新增/编辑/删除后：列表与总览一起刷新（打点与「N 条记录」都会变）', async () => {
  resetEnv();
  respond = pagedRespond([rec('a')]);
  const page = makePage();
  page.onLoad();
  await flush();
  const calBefore = calCalls().length;

  page.openAdd();
  page.onFormSaved();
  await flush();
  assert.equal(calCalls().length, calBefore + 1, '保存后要重取总览/打点');
  assert.equal(listCalls()[listCalls().length - 1].params.page, 1, '列表回第一页');

  page.setData({ detailVisible: true, detailRecord: rec('a') });
  page.onDetailDeleted();
  await flush();
  assert.equal(calCalls().length, calBefore + 2, '删除后同样两处都刷');
});

test('L17 空态文案分档：日历整月 / 日历点选 / 列表无筛选各说各话', async () => {
  resetEnv();
  respond = () => Promise.resolve({ items: [], total: 0 });
  const page = makePage();
  page.onLoad();
  await flush();
  assert.equal(page.data.emptyText, '', '列表态无筛选 → wxml 走「点右上角 ＋ 记录第一个去过的地方」兜底');

  page.onSwitchView({ currentTarget: { dataset: { view: 'calendar' } } });
  await flush();
  assert.equal(page.data.emptyText, '本月没有足迹');
  assert.equal(page.data.sectionTitle, '本月 0 条');

  page.onCalendarDayTap({ detail: { date: '2026-09-20' } });
  await flush();
  assert.equal(page.data.emptyText, '9月20日 没有足迹');
  assert.equal(page.data.filtered, true, '点选态空列表要给「清空筛选」出口');

  page.onClearFilter();
  await flush();
  assert.equal(page.data.calendarSelected, '', '清空筛选在日历态顺带取消点选');
  assert.equal(page.data.filtered, false);
});

test('L18 分类标签：卡片带中文名与透明底图标，未分类给空串', async () => {
  resetEnv();
  respond = () => Promise.resolve({ total: 2, items: [rec('a', { category: 'museum' }), rec('b')] });
  const page = makePage();
  await page.loadAll();
  assert.equal(page.data.items[0].categoryLabel, '博物馆展馆');
  assert.equal(page.data.items[0].categoryIcon, '/assets/icons/fp-cat-museum.png');
  assert.equal(page.data.items[1].categoryLabel, '', '未分类不显示标签');
  assert.equal(page.data.items[1].categoryIcon, '');
});

test('L20 分享：文案走全局口径（/calendar 的 total/placeCount），不被列表筛选带偏', async () => {
  resetEnv();
  calendarRespond = () => Promise.resolve({ total: 70, placeCount: 68, photoCount: 3, days: [] });
  respond = () => Promise.resolve({ items: [rec('a')], total: 1 }); // 列表被筛成 1 条
  const page = makePage();
  page.onLoad();
  await flush();

  const msg = page.onShareAppMessage();
  assert.equal(msg.path, '/pages/footprint-list/footprint-list', '转发的就是足迹列表页');
  assert.match(msg.title, /70 条足迹/, `总览口径要写进文案：${msg.title}`);
  assert.match(msg.title, /68 个地方/);
  assert.equal(page.onShareTimeline().title, msg.title, '朋友圈与转发文案一致');
});

test('L21 分享：没有记录时不报数字', async () => {
  resetEnv();
  calendarRespond = () => Promise.resolve({ total: 0, placeCount: 0, photoCount: 0, days: [] });
  respond = () => Promise.resolve({ items: [], total: 0 });
  const page = makePage();
  page.onLoad();
  await flush();

  const msg = page.onShareAppMessage();
  assert.doesNotMatch(msg.title, /0 条/, `没记录过就别报数字：${msg.title}`);
  assert.ok(msg.title.length > 0);
});

/* ---------------- 登录态闸门（2026-09-23：游客别再撞 401） ----------------
 * 本页正常只能从地图页进来（已登录流程），游客只可能从分享链接直达；但一旦是游客，
 * 列表与总览两个接口都会 401，所以同样一个请求都不发，只摆登录引导。 */

test('L22 游客进页：列表与总览一个都不请求，只摆登录引导（不是错误态）', async () => {
  resetEnv();
  resetAppStub({ loggedIn: false, hasSession: false });
  respond = () => Promise.reject(new Error('未授权，请先登录')); // 真发出去就是这个结果
  const page = makePage();
  page.onLoad();
  await flush();
  assert.equal(apiCalls.length, 0, '游客两个接口都不该发（发出去只会落成整页错误态）');
  assert.equal(page.data.notLoggedIn, true);
  assert.equal(page.data.error, '', '游客不是失败态');
  assert.equal(page.data.loading, false, '别停在「加载中…」');
  assert.equal(page.data.items.length, 0);
  assert.equal(page.data.summaryText, '', '总览文案不该凭空说数');
  assert.equal(page.data.hasMore, false, '压掉触底翻页，否则游客一触底就白挨一个 401');
});

test('L23 游客触底/下拉：都不发请求，也不把登录引导顶成整页错误态', async () => {
  resetEnv();
  resetAppStub({ loggedIn: false, hasSession: false });
  const page = makePage();
  page.onLoad();
  await flush();

  page.onReachBottom();
  await flush();
  assert.equal(apiCalls.length, 0, '触底不翻页');

  // 本页 enablePullDownRefresh: true，游客下拉同样会触发（唯一的入口是分享链接直达）
  page.onPullDownRefresh();
  await flush();
  assert.equal(apiCalls.length, 0, '下拉也不能发：两个接口都 401，首屏失败会把登录引导顶成整页错误态');
  assert.equal(page.data.error, '', '仍是游客态，不是错误态');
  assert.equal(page.data.notLoggedIn, true);
  assert.equal(stopPullDownCalls, 1, '下拉指示器要收起，否则一直转');
});

test('L24 游客点 ＋：取消不开表单；确认登录后开表单并把页面数据补上', async () => {
  resetEnv();
  resetAppStub({ loggedIn: false, hasSession: false });
  respond = pagedRespond([rec('a')]);
  const page = makePage();
  page.openAdd();
  assert.equal(page.data.formVisible, false, '游客不能直接开表单：填完整张表才被告知未登录是 bug');
  assert.equal(modals.length, 1);
  modals[0].success({ confirm: false });
  await flush();
  assert.equal(loginCalls, 0);
  assert.equal(page.data.formVisible, false);

  page.openAdd();
  modals[1].success({ confirm: true });
  await flush();
  assert.equal(loginCalls, 1);
  assert.equal(page.data.formVisible, true, '登录成功接着把表单打开');
  assert.equal(page.data.formRecord, null, '仍是新增态');
  assert.equal(page.data.notLoggedIn, false);
  assert.ok(listCalls().length >= 1, '登录后顺手把游客态缺的列表补上');
  assert.equal(calCalls().length, 1, '总览/打点也要补（分享文案与日历打点都靠它）');
});

test('L25 老用户（本地有会话）进页：静默恢复后照常拉列表与总览', async () => {
  resetEnv();
  resetAppStub({ loggedIn: false, hasSession: true });
  respond = pagedRespond([rec('a')]);
  calendarRespond = () => Promise.resolve({ total: 1, placeCount: 1, photoCount: 0, days: [] });
  const page = makePage();
  page.onLoad();
  await flush();
  assert.equal(loginCalls, 1, '本地有 token 就静默恢复，不让老用户重登一次');
  assert.equal(page.data.notLoggedIn, false);
  assert.equal(listCalls().length, 1);
  assert.equal(calCalls().length, 1);
  assert.equal(page.data.summaryText, '1 条记录 · 1 个地方 · 0 张照片');
});

/* --------- 跨页脏标记（2026-09-25：本页改动要让地图 tab 的打点跟上） --------- */
/**
 * 地图页是 tabBar 页，本页用 navigateTo 推在它上面 → 返回时地图页只走 onShow，
 * 而 onShow 原本只在登录态变化时重对齐，删掉的点会一直挂在地图上。
 * 消费方断言见 footprints-page.test.js 的 P29/P30。
 */
test('L26 保存/删除都打跨页脏标记，供地图页 onShow 补拉', async () => {
  resetEnv();
  respond = pagedRespond([rec('a'), rec('b')]);
  const page = makePage();
  await page.loadAll();
  appStub.globalData.fpDirty = false;

  page.onFormSaved();
  assert.equal(appStub.globalData.fpDirty, true, '存完新记录，地图页还挂着旧点，要标脏');
  appStub.globalData.fpDirty = false;

  page.setData({ detailVisible: true, detailRecord: rec('a') });
  page.onDetailDeleted();
  assert.equal(appStub.globalData.fpDirty, true, '删除后同理');
  await flush();
});
