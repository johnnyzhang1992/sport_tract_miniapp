/**
 * 计划编辑半屏（components/plan-edit-sheet）：
 * - 打开时预填：有已保存计划用它；否则用该周期草稿；再否则默认值（每天 3/30/1、每周 15/150/5）；
 * - 步进器步长与下限；输入落草稿（切周期/重开可还原）；
 * - 校验与保存（km→米）、保存成功抛 saved 事件。
 * 运行：node --test test/plan-edit-sheet.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let apiPuts = [];
const fakeApi = {
  get: () => Promise.resolve({}),
  put(p, body) {
    apiPuts.push({ p, body });
    return Promise.resolve({ period: body.period, targets: body.targets });
  },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const storage = new Map();
const toasts = [];
global.wx = {
  getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
  setStorageSync: (k, v) => storage.set(k, v),
  showToast: (o) => toasts.push(o && o.title),
};
let compDef = null;
global.Component = (d) => { compDef = d; };
require('../miniprogram/components/plan-edit-sheet/plan-edit-sheet.js');
assert.ok(compDef, '组件应通过 Component() 注册');

function boot(props = {}) {
  const c = {
    data: JSON.parse(JSON.stringify(compDef.data)),
    events: [],
    triggerEvent(name, detail) {
      this.events.push({ name, detail });
    },
  };
  c.data = Object.assign(c.data, {
    visible: true,
    plan: props.plan || null,
  });
  c.setData = (patch) => Object.assign(c.data, patch);
  // 绑定组件方法
  for (const [k, fn] of Object.entries(compDef.methods)) c[k] = fn.bind(c);
  return c;
}

test('PES1 打开预填：无计划 → 每天默认 3/30/1；切每周 → 15/150/5', () => {
  storage.clear();
  const c = boot();
  c.init();
  assert.deepEqual(
    { d: c.data.distanceKm, t: c.data.durationMin, c: c.data.count },
    { d: '3', t: '30', c: '1' },
  );
  c.onPeriod({ currentTarget: { dataset: { value: 'weekly' } } });
  assert.deepEqual(
    { d: c.data.distanceKm, t: c.data.durationMin, c: c.data.count },
    { d: '15', t: '150', c: '5' },
  );
});

test('PES2 有已保存计划：按计划预填，切周期不被默认值覆盖已保存的那一档', () => {
  storage.clear();
  const c = boot({ plan: { period: 'daily', targets: { distanceM: 5000, durationMin: 45, count: 2 } } });
  c.init();
  assert.equal(c.data.period, 'daily');
  assert.equal(c.data.distanceKm, '5');
  assert.equal(c.data.durationMin, '45');
  assert.equal(c.data.count, '2');

  c.onPeriod({ currentTarget: { dataset: { value: 'weekly' } } });
  assert.equal(c.data.distanceKm, '15', '每周没有保存值 → 默认值 15km');
  c.onPeriod({ currentTarget: { dataset: { value: 'daily' } } });
  assert.equal(c.data.distanceKm, '5', '切回每天 → 已保存的 5km 不被默认值覆盖');
});

test('PES3 步进器：距离 0.5、时间 5、次数 1，且有下限', () => {
  storage.clear();
  const c = boot();
  c.init();
  c.onStep({ currentTarget: { dataset: { key: 'distance', delta: '1' } } });
  assert.equal(c.data.distanceKm, '3.5');
  c.onStep({ currentTarget: { dataset: { key: 'duration', delta: '1' } } });
  assert.equal(c.data.durationMin, '35');
  c.onStep({ currentTarget: { dataset: { key: 'count', delta: '1' } } });
  assert.equal(c.data.count, '2');

  c.setData({ distanceKm: '0.5', count: '1' });
  c.onStep({ currentTarget: { dataset: { key: 'distance', delta: '-1' } } });
  c.onStep({ currentTarget: { dataset: { key: 'count', delta: '-1' } } });
  assert.equal(c.data.distanceKm, '0.5', '距离下限 0.5');
  assert.equal(c.data.count, '1', '次数下限 1');
});

test('PES4 校验：三项都必须 > 0，非法不发请求', async () => {
  storage.clear();
  apiPuts = [];
  toasts.length = 0;
  const c = boot();
  c.init();

  c.setData({ distanceKm: '0' });
  await c.onSave();
  assert.equal(apiPuts.length, 0);
  assert.match(toasts[0], /距离/);

  c.setData({ distanceKm: '5', durationMin: '0' });
  await c.onSave();
  assert.equal(apiPuts.length, 0);

  c.setData({ durationMin: '30', count: '' });
  await c.onSave();
  assert.equal(apiPuts.length, 0);
});

test('PES5 保存：km→米上送 + 抛 saved 事件；草稿持久化可重开还原', async () => {
  storage.clear();
  apiPuts = [];
  const c = boot();
  c.init();
  // 走真实输入回调（草稿在这条路径上落库）
  c.onDistance({ detail: { value: '6.5' } });
  c.onDuration({ detail: { value: '40' } });
  c.onCount({ detail: { value: '2' } });
  await c.onSave();

  assert.equal(apiPuts.length, 1);
  assert.equal(apiPuts[0].p, '/plan');
  assert.deepEqual(apiPuts[0].body, {
    period: 'daily',
    targets: { distanceM: 6500, durationMin: 40, count: 2 },
  });
  assert.equal(c.events.filter((e) => e.name === 'saved').length, 1, '保存成功要通知外层刷新');

  // 重开半屏（同一份 storage）→ 还原用户填过的值
  const c2 = boot();
  c2.init();
  assert.equal(c2.data.distanceKm, '6.5');
  assert.equal(c2.data.durationMin, '40');
});

test('PES6 关闭：点击遮罩/关闭按钮触发 close 事件', () => {
  const c = boot();
  c.onClose();
  assert.equal(c.events.filter((e) => e.name === 'close').length, 1);
});
