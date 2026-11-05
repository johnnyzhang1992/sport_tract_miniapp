/**
 * 数据导出页（2026-11-04）：
 * - 登录闸门、会员权益闸门（轨迹 GPX 会员专属，CSV 登录即可）；
 * - 两张卡各自的时间档/类型/自定义日期，导出 query 正确；
 * - 导出中防重、失败原样展示后端文案。
 * 桩：wx / Page / services / export-file / loading 就地注入；纯函数用真实实现。
 * 运行：node --test test/export-page.test.js；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const realExport = require('../miniprogram/utils/export-file.js');

/* ------------------------------- 结构断言 ------------------------------- */

test('EP-1 结构：两张卡共用 export-filter，轨迹卡会员锁与自定义日期都在', () => {
  const w = read('miniprogram/pages/export/export.wxml');
  assert.match(w, /class="sec-title">运动记录/);
  assert.match(w, /class="sec-title">轨迹记录/);
  assert.match(w, /会员专属 · 开通后可打包导出轨迹/);
  assert.match(w, /bindtap="goMember"/);
  assert.equal((w.match(/<export-filter/g) || []).length, 1, '两种导出共用顶部一套筛选器');
  assert.ok(!w.includes('class="chip'), '卡片里不再重复写 chips 标记');
  assert.ok(!w.includes('mode="date"'), '日期 picker 收进组件');
  assert.match(w, /导出 CSV/);
  assert.match(w, /导出 GPX/);
  const comp = read('miniprogram/components/export-filter/export-filter.wxml');
  assert.equal((comp.match(/mode="date"/g) || []).length, 2, '组件内两个日期 picker');
  assert.match(comp, /bindtap="onRangeTap"/);
  assert.match(comp, /bindtap="onTypeTap"/);
  const pageJson = JSON.parse(read('miniprogram/pages/export/export.json'));
  assert.ok(pageJson.usingComponents['export-filter']);
  const app = JSON.parse(read('miniprogram/app.json'));
  assert.ok(app.pages.includes('pages/export/export'));
});

/* --------------------------------- 桩 --------------------------------- */

let entitlements = () => Promise.resolve({ canExportBundle: true });
let token = { accessToken: 't' };
let loginOk = true;
let downloads = [];
let shares = [];
let downloadError = null;
let toasts = [];
let loadingShows = 0;
let loadingHides = 0;
let entitlementsCalls = 0;

const fakeApi = {
  get(p) {
    if (p === '/member/entitlements') {
      entitlementsCalls += 1;
      return entitlements();
    }
    return Promise.resolve(null);
  },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const storagePath = require.resolve('../miniprogram/services/storage.js');
require.cache[storagePath] = {
  id: storagePath, filename: storagePath, loaded: true,
  exports: { getToken: () => token }, children: [], paths: [],
};

const loginGatePath = require.resolve('../miniprogram/utils/login-gate.js');
require.cache[loginGatePath] = {
  id: loginGatePath, filename: loginGatePath, loaded: true,
  exports: { ensureLogin: async () => loginOk }, children: [], paths: [],
};

const loadingPath = require.resolve('../miniprogram/utils/loading.js');
require.cache[loadingPath] = {
  id: loadingPath, filename: loadingPath, loaded: true,
  exports: { show: () => { loadingShows += 1; }, hide: () => { loadingHides += 1; } }, children: [], paths: [],
};

const exportPath = require.resolve('../miniprogram/utils/export-file.js');
require.cache[exportPath] = {
  id: exportPath, filename: exportPath, loaded: true,
  exports: Object.assign({}, realExport, {
    downloadExport: (p, name) => {
      downloads.push({ path: p, name });
      return downloadError ? Promise.reject(downloadError) : Promise.resolve('/tmp/file');
    },
    shareExportFile: (filePath, name) => {
      shares.push(name);
      return Promise.resolve(filePath);
    },
  }),
  children: [], paths: [],
};

const modals = [];
global.wx = {
  showToast: (o) => toasts.push((o && o.title) || ''),
  showModal: (o) => modals.push({ title: (o && o.title) || '', content: (o && o.content) || '' }),
  navigateTo() {},
};
let pageDef = null;
global.Page = (d) => { pageDef = d; };
require('../miniprogram/pages/export/export.js');
assert.ok(pageDef, 'export.js 应通过 Page() 交出页面对象');

function boot() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  // 模拟小程序 setData 的 'a.b' 路径写法
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
  return p;
}

function reset() {
  entitlements = () => Promise.resolve({ canExportBundle: true });
  token = { accessToken: 't' };
  loginOk = true;
  downloads = [];
  toasts.length = 0;
  modals.length = 0;
  shares = [];
  downloadError = null;
  toasts = [];
  loadingShows = 0;
  loadingHides = 0;
  entitlementsCalls = 0;
}

const tick = () => new Promise((r) => setImmediate(r));

/* -------------------------------- 用例 -------------------------------- */

test('EP-2 未登录：不拉权益；点登录成功后重新进页并拉权益', async () => {
  reset();
  token = null;
  const p = boot();
  p.onShow();
  assert.equal(p.data.loggedIn, false);
  assert.equal(entitlementsCalls, 0);
  token = { accessToken: 't' };
  await p.guestLogin();
  await tick();
  assert.equal(p.data.loggedIn, true);
  assert.equal(entitlementsCalls, 1);
});

test('EP-3 会员权益：成功落 memberActive；失败按非会员但结束加载态', async () => {
  reset();
  const p = boot();
  p.onShow();
  await tick();
  assert.equal(p.data.canExportBundle, true);
  assert.equal(p.data.memberLoaded, true);

  reset();
  entitlements = () => Promise.reject(new Error('down'));
  const q = boot();
  q.onShow();
  await tick();
  assert.equal(q.data.canExportBundle, false, '拉不到按无权益（宁可少给）');
  assert.equal(q.data.memberLoaded, true);
});

test('EP-4 自定义日期：切到自定义自动补近 30 天，已有日期不被覆盖', () => {
  reset();
  const p = boot();
  p.onRangeTap({ detail: { key: 'custom' } });
  assert.equal(p.data.filter.range, 'custom');
  assert.match(p.data.filter.start, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(p.data.filter.end, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(p.data.filter.start <= p.data.filter.end);

  p.onStartDate({ detail: { value: '2026-10-01' } });
  p.onRangeTap({ detail: { key: 'custom' } });
  assert.equal(p.data.filter.start, '2026-10-01', '已有日期不被默认值覆盖');
  p.onTypeTap({ detail: { type: 'running' } });
  assert.equal(p.data.filter.type, 'running');
});

test('EP-5 CSV 导出：自定义 + 类型走 summary 接口，名字 .csv，分享一次', async () => {
  reset();
  const p = boot();
  p.onShow();
  await tick();
  p.setData({ 'filter.range': 'custom', 'filter.start': '2026-10-01', 'filter.end': '2026-10-31', 'filter.type': 'running' });
  await p.onExportCsv();
  const from = realExport.parseExportDate('2026-10-01', false);
  const to = realExport.parseExportDate('2026-10-31', true);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].path, `/activities/export/summary?from=${from}&to=${to}&type=running`);
  assert.match(downloads[0].name, /^运动记录_\d{8}-\d{6}\.csv$/);
  assert.equal(shares.length, 1);
  assert.ok(toasts.includes('已导出'));
  assert.equal(p.data.busy, '');
  assert.equal(loadingShows, 1);
  assert.equal(loadingHides, 1);
});

test('EP-6 轨迹 GPX：非会员只提示不发请求；会员按范围+类型打包', async () => {
  reset();
  const p = boot();
  p.onShow();
  await tick();
  p.setData({ canExportBundle: false });
  await p.onExportGpx();
  assert.equal(downloads.length, 0, '非会员不发导出请求');
  assert.ok(toasts.includes('会员专属功能，开通后可导出轨迹'));

  p.setData({ canExportBundle: true, 'filter.range': '30d', 'filter.type': 'walking' });
  const now = Date.now();
  await p.onExportGpx();
  assert.equal(downloads.length, 1);
  assert.ok(downloads[0].path.startsWith('/activities/export/gpx?from='));
  assert.ok(downloads[0].path.endsWith('&type=walking'));
  const from = Number(downloads[0].path.match(/from=(\d+)/)[1]);
  assert.ok(Math.abs(from - (now - 30 * 86400000)) < 5000, '近 30 天 = now 回退 30 天');
  assert.match(downloads[0].name, /^轨迹导出_\d{8}-\d{6}\.zip$/);
});

test('EP-7 自定义缺日期 / 起止颠倒：toast 拦截，不发请求', async () => {
  reset();
  const p = boot();
  p.onShow();
  await tick();
  p.setData({ 'filter.range': 'custom', 'filter.start': '', 'filter.end': '' });
  await p.onExportCsv();
  assert.equal(downloads.length, 0);
  assert.ok(toasts.includes('请选择开始和结束日期'));

  toasts = [];
  p.setData({ 'filter.start': '2026-11-02', 'filter.end': '2026-11-01' });
  await p.onExportCsv();
  assert.equal(downloads.length, 0);
  assert.ok(toasts.includes('开始日期不能晚于结束日期'));
});

test('EP-8 导出失败：原样展示后端文案并复位 busy；导出中不接受第二次点击', async () => {
  reset();
  const p = boot();
  p.onShow();
  await tick();
  downloadError = new Error('共 101 条，超出单次导出上限 100 条，请缩小时间范围，或按运动类型分批导出');
  await p.onExportGpx();
  // 超限类文案必须整句可读：走 modal（toast 会被截断成半句，用户看不到「怎么缩小」）
  assert.equal(modals.length, 1, '应弹 modal 而不是 toast');
  assert.match(modals[0].title, /上限/);
  assert.equal(modals[0].content, '共 101 条，超出单次导出上限 100 条，请缩小时间范围，或按运动类型分批导出');
  assert.equal(p.data.busy, '');
  assert.equal(loadingHides, 1);

  downloads = [];
  p.setData({ busy: 'csv' });
  await p.onExportGpx();
  assert.equal(downloads.length, 0, 'busy 时第二次点击不发起');
});
