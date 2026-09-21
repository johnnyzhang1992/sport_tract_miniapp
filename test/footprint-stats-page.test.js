/**
 * 足迹统计页（packageFootprint/pages/footprint-stats/footprint-stats.js）页级回归：
 * 本页是「足迹记录」口径的统计（/footprint-records/stats），与点亮地图页的运动轨迹口径（/stats/footprint）独立。
 * 覆盖：周期区间换算（visitDate 是 YYYY-MM-DD 字符串，客户端算 [from, to) 日期串）、tab 切换重置偏移、
 * 翻页边界、抽屉选项数、'all' 不带区间、seq 守卫、错误分档、省界地图只拉一次、地图初始化晚于数据到达、
 * 缩放按钮（+/− 乘系数、上下限夹取）、全屏（另起一张图 + 关闭销毁 + 全屏内缩放作用对象）。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 * 桩：wx / Page / getApp / echarts（自定义构建 1MB+，用 require.cache 换成假实现）就地 stub；
 *     api 走 getApp().globalData.api（分包页取 api 的既有方式）。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/* ---------------------------------- 环境桩 ---------------------------------- */

const apiCalls = [];
const statsResponses = []; // 按序弹出；空了就返回默认全 0
let geoMapCalls = 0;
let geoMapShouldFail = false;
const fakeApi = {
  get(p) {
    apiCalls.push(p);
    if (p === '/geo/china-map') {
      geoMapCalls++;
      return geoMapShouldFail ? Promise.reject(new Error('地图数据失败')) : Promise.resolve({ type: 'FeatureCollection', features: [] });
    }
    const next = statsResponses.length ? statsResponses.shift() : null;
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next || { total: 0, provinceCount: 0, cityCount: 0, provinces: [] });
  },
};

// echarts 自定义构建（1MB+ UMD）在 node 下没必要真跑：registerMap/init 换成可断言的假实现。
// 每次 init 落一个独立实例（卡片图 / 全屏图各一个），setOption 里回写 zoom，
// 模拟 getOption → setOption 的缩放往返（缩放按钮的读写口径）。
const registered = [];
const chartOptions = [];
const charts = [];
function makeChart() {
  const c = {
    zoom: 1,
    setOption(o) {
      chartOptions.push(o);
      if (o && o.series && o.series[0] && typeof o.series[0].zoom === 'number') this.zoom = o.series[0].zoom;
    },
    getOption() { return { series: [{ zoom: this.zoom }] }; },
    on() {},
  };
  charts.push(c);
  return c;
}
const echartsPath = require.resolve('../miniprogram/packageFootprint/components/ec-canvas/echarts.js');
const fakeEcharts = {
  registerMap: (name, data) => registered.push({ name, data }),
  init: () => makeChart(),
};
require.cache[echartsPath] = { id: echartsPath, filename: echartsPath, loaded: true, exports: fakeEcharts, children: [], paths: [] };

const toasts = [];
const albumCalls = []; // saveImageToPhotosAlbum 入参
let albumResult = 'ok'; // ok | deny | other
const modalCalls = [];
let modalConfirm = false;
let openSettingCalls = 0;
global.wx = {
  showToast: (o) => toasts.push(o && o.title),
  nextTick: (cb) => cb(),
  saveImageToPhotosAlbum: (o) => {
    albumCalls.push(o);
    if (albumResult === 'ok') o.success();
    else if (albumResult === 'deny') o.fail({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' });
    else o.fail({ errMsg: 'saveImageToPhotosAlbum:fail system error' });
  },
  showModal: (o) => {
    modalCalls.push(o);
    o.success({ confirm: modalConfirm });
  },
  openSetting: () => { openSettingCalls++; },
};

// loading 模块（utils/loading.js）与导出模块（packageFootprint/utils/map-image.js）注入假实现：
// 页面只负责 loading/toast/预览态，导出本身的像素细节由 test/map-image.test.js 直测
const loadingCalls = [];
const loadingPath = require.resolve('../miniprogram/utils/loading.js');
require.cache[loadingPath] = {
  id: loadingPath, filename: loadingPath, loaded: true,
  exports: { show: (t) => loadingCalls.push(['show', t]), hide: () => loadingCalls.push(['hide']) },
  children: [], paths: [],
};
const exportCalls = [];
let exportBehavior = () => Promise.resolve('wxfile://tmp/share.png');
const mapImagePath = require.resolve('../miniprogram/packageFootprint/utils/map-image.js');
require.cache[mapImagePath] = {
  id: mapImagePath, filename: mapImagePath, loaded: true,
  exports: { exportChartImage: (comp, opts) => { exportCalls.push({ comp, opts }); return exportBehavior(comp, opts); } },
  children: [], paths: [],
};

let pageDef = null;
global.Page = (def) => { pageDef = def; };
const fakeApp = { globalData: { api: fakeApi, loggedIn: true }, hasSession: () => false };
global.getApp = () => fakeApp;

require('../miniprogram/packageFootprint/pages/footprint-stats/footprint-stats.js');
assert.ok(pageDef, 'footprint-stats.js 应通过 Page() 交出页面对象');

/* --------------------------------- 页面装配 --------------------------------- */

function applyPath(target, keyPath, value) {
  const keys = keyPath.split('.');
  let o = target;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

/** ec-canvas 组件桩：init(cb) 立刻回调，cb 返回值即 chart（ec-canvas 内部据此挂 this.chart） */
function makeMapComp() {
  return {
    init(cb) {
      this.chart = cb({ setChart() {} }, 300, 300, 2);
      return this.chart;
    },
  };
}

function makePage(withMap) {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch, cb) => {
    Object.keys(patch).forEach((k) => applyPath(p.data, k, patch[k]));
    if (cb) cb();
  };
  p.selectComponent = (sel) => {
    if (!withMap) return null;
    if (sel === '#fsMap') return (p._fsComp = makeMapComp());
    return (p._mapComp = makeMapComp());
  };
  return p;
}

const tick = () => new Promise((r) => setImmediate(r));
async function flush() {
  for (let i = 0; i < 5; i++) await tick();
}

/** 数据概要桩 */
function stats(total, provinceCount, cityCount, provinces) {
  return { total, provinceCount, cityCount, provinces: provinces || [] };
}

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function resetEnv() {
  apiCalls.length = 0;
  statsResponses.length = 0;
  chartOptions.length = 0;
  charts.length = 0;
  registered.length = 0;
  geoMapCalls = 0;
  geoMapShouldFail = false;
  toasts.length = 0;
  albumCalls.length = 0;
  modalCalls.length = 0;
  loadingCalls.length = 0;
  exportCalls.length = 0;
  albumResult = 'ok';
  modalConfirm = false;
  openSettingCalls = 0;
  exportBehavior = () => Promise.resolve('wxfile://tmp/share.png');
}

/** 最后一次 stats 请求的 query 串（去掉 /footprint-records/stats 前缀） */
function lastStatsQuery() {
  const call = apiCalls.filter((p) => p.startsWith('/footprint-records/stats')).pop();
  return call ? call.slice('/footprint-records/stats'.length) : null;
}

/* ---------------------------------- 用例 ---------------------------------- */

test('S1 周期换算：月/年区间是 YYYY-MM-DD 日期串，覆盖当前周期且左闭右开', async () => {
  resetEnv();
  const page = makePage();
  page.onLoad();
  await flush();

  const now = new Date();
  const monthFrom = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  assert.equal(lastStatsQuery(), `?from=${monthFrom}&to=${fmt(nextMonth)}`, '默认「月」= 自然月 [本月1日, 下月1日)');
  assert.equal(page.data.periodLabel, `${now.getFullYear()}年${now.getMonth() + 1}月`);
  assert.equal(page.data.canGoNext, false, '当前周期不能再往后翻');

  // 切到「年」：自然年 [1月1日, 次年1月1日)
  page.onRangeChange({ currentTarget: { dataset: { value: 'year' } } });
  await flush();
  const y = now.getFullYear();
  assert.equal(lastStatsQuery(), `?from=${y}-01-01&to=${y + 1}-01-01`);
  assert.equal(page.data.periodLabel, `${y}年`);

  // 「全部」：不带 from/to
  page.onRangeChange({ currentTarget: { dataset: { value: 'all' } } });
  await flush();
  assert.equal(lastStatsQuery(), '', '「全部」不带区间');
  assert.equal(page.data.periodLabel, '', '「全部」无周期文案');
  assert.equal(page.data.canGoNext, false);
});

test('S2 概况与地图数据落地：数字、点亮省 data、loaded 闸门；省界地图只拉一次', async () => {
  resetEnv();
  statsResponses.push(stats(5, 2, 3, [{ name: '浙江省', count: 4 }, { name: '北京市', count: 1 }]));
  const page = makePage(true);
  page.onLoad();
  page.onReady(); // 真实生命周期：onLoad(起请求) → onReady(组件就绪) → 响应到达
  await flush();

  assert.equal(page.data.total, 5);
  assert.equal(page.data.provinceCount, 2);
  assert.equal(page.data.cityCount, 3);
  assert.equal(page.data.loaded, true, '响应落地后才把「—」换成数字');
  assert.equal(page.data.loading, false);
  assert.equal(page.data.error, '');
  assert.deepEqual(registered.map((r) => r.name), ['china'], '省界 GeoJSON 注册为 china');
  assert.deepEqual(chartOptions[0].series[0].data, [{ name: '浙江省', value: 4 }, { name: '北京市', value: 1 }], '点亮省按 count 上色');

  // 翻到上个月：地图数据缓存复用，不重复拉
  statsResponses.push(stats(1, 1, 1, [{ name: '上海市', count: 1 }]));
  page.onPrevPeriod();
  await flush();
  assert.equal(geoMapCalls, 1, '省界地图按需拉取后缓存（只拉一次）');
  assert.deepEqual(chartOptions[chartOptions.length - 1].series[0].data, [{ name: '上海市', value: 1 }]);
});

test('S3 翻页边界与偏移重置：‹ 每次往前一档，› 到当前周期为止，切 tab 偏移归零', async () => {
  resetEnv();
  const page = makePage();
  page.onLoad();
  await flush();
  const now = new Date();

  page.onNextPeriod();
  await flush();
  assert.equal(page.data.periodOffset, 0, '当前周期点 › 不动');
  assert.equal(apiCalls.filter((p) => p.startsWith('/footprint-records/stats')).length, 1, '点了也不发请求');

  page.onPrevPeriod();
  await flush();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  assert.equal(page.data.periodOffset, 1);
  assert.equal(lastStatsQuery(), `?from=${fmt(prevMonth)}&to=${fmt(new Date(now.getFullYear(), now.getMonth(), 1))}`);
  assert.equal(page.data.canGoNext, true, '离开当前周期后才能往后翻');

  page.onPrevPeriod();
  page.onNextPeriod();
  await flush();
  assert.equal(page.data.periodOffset, 1, '往前两档再回来一档 = 上一月');
  assert.equal(lastStatsQuery(), `?from=${fmt(prevMonth)}&to=${fmt(new Date(now.getFullYear(), now.getMonth(), 1))}`);

  // 切到「年」：偏移必须归零（否则会停在「12 个月前的年」这种错位）
  page.onRangeChange({ currentTarget: { dataset: { value: 'year' } } });
  await flush();
  assert.equal(page.data.periodOffset, 0);
  assert.equal(page.data.periodLabel, `${now.getFullYear()}年`);
  assert.equal(page.data.canGoNext, false);
});

test('S4 周期抽屉：选项数按粒度（月 12 / 年 5），选中当前项只关抽屉，选中别的项才切换重拉', async () => {
  resetEnv();
  const page = makePage();
  page.onLoad();
  await flush();
  const now = new Date();

  page.onTapPeriodLabel();
  assert.equal(page.data.showPeriodPicker, true);
  assert.equal(page.data.periodOptions.length, 12, '月粒度展示最近 12 个月');
  assert.equal(page.data.periodOptions.filter((o) => o.selected).length, 1);
  assert.equal(page.data.periodOptions[0].selected, true, '默认选中当前周期（offset 0）');
  assert.equal(page.data.pickerScrollInto, 'period-0', 'nextTick 后滚动定位到当前周期');

  const callsBefore = apiCalls.length;
  page.onSelectPeriod({ currentTarget: { dataset: { offset: 0 } } });
  assert.equal(page.data.showPeriodPicker, false);
  await flush();
  assert.equal(apiCalls.length, callsBefore, '选中的就是当前周期：只关抽屉，不重复请求');

  page.onTapPeriodLabel();
  const opt3 = page.data.periodOptions[3];
  page.onSelectPeriod({ currentTarget: { dataset: { offset: 3 } } });
  await flush();
  assert.equal(page.data.periodOffset, 3);
  const start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  assert.equal(lastStatsQuery(), `?from=${fmt(start)}&to=${fmt(new Date(start.getFullYear(), start.getMonth() + 1, 1))}`, opt3.label + ' 的区间');

  // 年粒度 5 项
  page.onRangeChange({ currentTarget: { dataset: { value: 'year' } } });
  await flush();
  page.onTapPeriodLabel();
  assert.equal(page.data.periodOptions.length, 5, '年粒度展示最近 5 年');
  page.onClosePeriodPicker(); // 抽屉有遮罩，真实交互里打开时点不到 tab

  // 「全部」点标签不弹抽屉
  page.onRangeChange({ currentTarget: { dataset: { value: 'all' } } });
  await flush();
  page.onTapPeriodLabel();
  assert.equal(page.data.showPeriodPicker, false, '「全部」没有周期可选');
});

test('S5 seq 守卫与错误分档：过期响应不覆盖，失败置 error 且可重试', async () => {
  resetEnv();
  const page = makePage();
  let releaseSlow = null;
  let call = 0;
  const slow = new Promise((r) => { releaseSlow = r; });
  const original = fakeApi.get.bind(fakeApi);
  fakeApi.get = (p) => {
    apiCalls.push(p);
    if (p === '/geo/china-map') return Promise.resolve({ type: 'FeatureCollection', features: [] });
    call++;
    if (call === 1) return slow.then(() => stats(9, 9, 9, [])); // 第一次响应卡住
    return Promise.resolve(stats(2, 1, 1, []));
  };
  const running1 = page.fetch();
  const running2 = page.fetch(); // 后一次先返回
  await running2;
  releaseSlow();
  await running1;
  await flush();
  fakeApi.get = original;
  assert.equal(page.data.total, 2, '过期响应（先发后到）不得覆盖最新一次的数据');
  assert.equal(page.data.provinceCount, 1);

  // 失败分档：error 置位 + loading 收起，重试成功后清空
  statsResponses.push(new Error('统计失败'));
  await page.fetch();
  assert.equal(page.data.error, '统计失败');
  assert.equal(page.data.loading, false);
  assert.equal(page.data.total, 2, '失败保留上一次的数据（不闪空）');
  statsResponses.push(stats(3, 2, 2, []));
  await page.fetch();
  assert.equal(page.data.error, '');
  assert.equal(page.data.total, 3);
});

test('S6 地图初始化晚于数据到达：onReady 时用已缓存的数据出图（不空白）', async () => {
  resetEnv();
  statsResponses.push(stats(4, 1, 1, [{ name: '广东省', count: 4 }]));
  const page = makePage(false); // 先不挂组件：模拟 fetch 先于 onReady 完成
  page.onLoad();
  await flush();
  assert.equal(page.data.total, 4);
  assert.equal(chartOptions.length, 0, '组件还没就绪时不去碰 chart');

  // 组件就绪：init 回调里应把缓存的省界 + 点亮数据一次性画上
  const comp = (page._mapComp = makeMapComp());
  page.selectComponent = () => comp;
  page.onReady();
  assert.equal(chartOptions.length, 1, 'onReady 时补画（否则首屏地图空白）');
  assert.deepEqual(chartOptions[0].series[0].data, [{ name: '广东省', value: 4 }]);
  assert.ok(!chartOptions[0].backgroundColor, '不能设 backgroundColor（不透明画布会盖住页面按钮）');
});

test('S7 分享导出：未加载完拒绝导出；成功落预览态并带统计行与布局参数；关闭清态', async () => {
  resetEnv();
  const page = makePage(true);
  page.onReady(); // _mapComp 就绪
  page.openSharePreview();
  assert.equal(exportCalls.length, 0, '数据未到不发导出');
  assert.equal(toasts[toasts.length - 1], '还没有数据可分享');

  statsResponses.push(stats(5, 2, 3, [{ name: '浙江省', count: 5 }]));
  page.onLoad();
  await flush();
  assert.equal(page.data.loaded, true);

  page.openSharePreview();
  assert.equal(exportCalls.length, 1);
  assert.equal(exportCalls[0].comp, page._mapComp, '导出的是本页地图组件');
  assert.equal(exportCalls[0].opts.statsText, `${page.data.periodLabel} · 足迹 5 · 省份 2 · 城市 3`);
  assert.deepEqual(exportCalls[0].opts.layoutCenter, ['50%', '62%'], '地图下移给顶部统计行让位');
  assert.deepEqual(exportCalls[0].opts.restoreLayout, { layoutCenter: ['50%', '52%'], layoutSize: '108%' });
  assert.deepEqual(loadingCalls[0], ['show', '生成中…']);
  await flush();
  assert.equal(page.data.sharePreview, true);
  assert.equal(page.data.shareImageSrc, 'wxfile://tmp/share.png');
  assert.deepEqual(loadingCalls[loadingCalls.length - 1], ['hide'], '导出结束收起 loading');

  page.onRangeChange({ currentTarget: { dataset: { value: 'all' } } });
  await flush();
  page.openSharePreview();
  await flush();
  assert.ok(exportCalls[1].opts.statsText.startsWith('全部时间 · '), '「全部」档统计行前缀换成全部时间');

  page.closeSharePreview();
  assert.equal(page.data.sharePreview, false);
});

test('S8 导出失败：toast 兜底 + 收起 loading，不落预览态', async () => {
  resetEnv();
  exportBehavior = () => Promise.reject(new Error('地图尚未就绪'));
  const page = makePage(true);
  page.onReady();
  statsResponses.push(stats(1, 1, 1, []));
  page.onLoad();
  await flush();
  page.openSharePreview();
  await flush();
  assert.equal(toasts[toasts.length - 1], '地图尚未就绪');
  assert.equal(page.data.sharePreview, false);
  assert.deepEqual(loadingCalls[loadingCalls.length - 1], ['hide']);
});

test('S9 转发与保存相册：标题带统计、封面用分享图；权限被拒引导去设置', async () => {
  resetEnv();
  const page = makePage(true);
  page.onReady();
  statsResponses.push(stats(5, 2, 3, []));
  page.onLoad();
  await flush();

  // 转发：标题带省市数；未生成分享图时封面留空走默认
  assert.equal(page.onShareAppMessage().title, '我的足迹统计 · 2 省 3 城');
  assert.equal(page.onShareAppMessage().path, '/packageFootprint/pages/footprint-stats/footprint-stats');
  assert.equal(page.onShareAppMessage().imageUrl, '');
  assert.equal(page.onShareTimeline().title, '我的足迹统计 · 2 省 3 城');

  page.openSharePreview();
  await flush();
  assert.equal(page.onShareAppMessage().imageUrl, 'wxfile://tmp/share.png', '生成后转发封面用分享图');
  assert.equal(page.onShareTimeline().imageUrl, 'wxfile://tmp/share.png');

  // 保存成功：底部按钮拿的是同一张临时图
  page.saveShareImage();
  assert.equal(albumCalls.length, 1);
  assert.equal(albumCalls[0].filePath, 'wxfile://tmp/share.png');
  assert.equal(toasts[toasts.length - 1], '已保存到相册');

  // 权限被拒 → 弹「去设置」，确认后 openSetting
  albumResult = 'deny';
  modalConfirm = true;
  page.saveShareImage();
  assert.equal(modalCalls.length, 1);
  assert.equal(modalCalls[0].title, '需要相册权限');
  assert.equal(openSettingCalls, 1);

  // 其他失败：只 toast
  albumResult = 'other';
  page.saveShareImage();
  assert.equal(modalCalls.length, 1, '非权限失败不弹设置引导');
  assert.equal(toasts[toasts.length - 1], '保存失败');
});

test('S10 缩放按钮：+/− 按当前 zoom 乘 1.3，夹在 0.5–8；chart 未就绪时点按钮不炸', () => {
  resetEnv();
  const page = makePage(true);
  page.onReady();
  const cardChart = page.chart;
  assert.ok(cardChart, 'onReady 后卡片图就绪');

  page.zoomIn();
  assert.equal(cardChart.zoom, 1.3, '+ 从 1 放大到 1.3');
  assert.equal(chartOptions[chartOptions.length - 1].series[0].zoom, 1.3, '经 setOption 更新 series.zoom');
  page.zoomOut();
  assert.equal(cardChart.zoom, 1, '− 从 1.3 缩回 1（基于当前值，不是回到默认 1）');

  for (let i = 0; i < 20; i++) page.zoomIn();
  assert.equal(cardChart.zoom, 8, '放大夹在上限 8');
  for (let i = 0; i < 40; i++) page.zoomOut();
  assert.equal(cardChart.zoom, 0.5, '缩小夹在下限 0.5');

  const fresh = makePage(false); // onReady 前（组件未就绪）点按钮
  fresh.zoomIn();
  fresh.zoomOut();
  assert.equal(fresh.chart, undefined);
});

test('S11 全屏：另起一张图并按当前周期数据绘制，关闭销毁；全屏内缩放只作用于全屏图', async () => {
  resetEnv();
  statsResponses.push(stats(5, 2, 3, [{ name: '浙江省', count: 5 }]));
  const page = makePage(true);
  page.onLoad();
  await flush(); // 数据先落地
  page.onReady(); // 卡片图用缓存省数据出图
  assert.equal(chartOptions.length, 1, '卡片图已出图');

  page.openFullscreen();
  assert.equal(page.data.fullscreen, true, '全屏层打开');
  assert.equal(chartOptions.length, 2, '全屏图进入即出图（不等下一次请求）');
  assert.deepEqual(chartOptions[1].series[0].data, [{ name: '浙江省', value: 5 }], '用的是当前周期点亮数据');
  const cardChart = page.chart;
  const fsChart = page.fsChart;
  assert.ok(fsChart && fsChart !== cardChart, '全屏是独立 chart 实例');

  const cardZoom = cardChart.zoom;
  page.zoomIn();
  assert.equal(fsChart.zoom, 1.3, '全屏时缩放作用于全屏图');
  assert.equal(cardChart.zoom, cardZoom, '不串到卡片图');

  // 全屏期间在途请求落地：两张图都要刷新（否则全屏停在旧数据）
  statsResponses.push(stats(1, 1, 1, [{ name: '上海市', count: 1 }]));
  await page.fetch();
  assert.deepEqual(chartOptions[chartOptions.length - 1].series[0].data, [{ name: '上海市', value: 1 }]);

  page.closeFullscreen();
  assert.equal(page.data.fullscreen, false, '全屏层关闭');
  assert.equal(page.fsChart, null, '销毁 chart 引用，下次打开重新初始化');
});
