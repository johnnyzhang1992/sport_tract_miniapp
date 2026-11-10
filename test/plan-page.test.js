/**
 * 运动计划设置页（pages/plan/plan.js）页级回归：
 * - 三项目标校验（镜像服务端：距离 0–500km、时长 0–10080 分钟、次数 0–999，均须 > 0）；
 * - 保存换算（km → 米）与 PUT 请求体；周期切换；GET 预填与进度摘要。
 * 运行：node --test test/plan-page.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let apiGets = [];
let apiPuts = [];
let planResponse = { plan: null, progress: { distanceM: 0, durationSec: 0, count: 0 }, rings: [] };
const fakeApi = {
  get(p) {
    apiGets.push(p);
    if (p === '/plan/current') return Promise.resolve(planResponse);
    return Promise.resolve({});
  },
  put(p, body) {
    apiPuts.push({ p, body });
    return Promise.resolve({ period: body.period, targets: body.targets });
  },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };


global.wx = {
  showToast: (o) => toasts.push(o && o.title),
  navigateBack: () => navBacks.push(1),
  getSystemInfoSync: () => ({ pixelRatio: 2 }),
};

let toasts = [];
let navBacks = [];
let pageDef = null;
global.Page = (d) => { pageDef = d; };
require('../miniprogram/pages/plan/plan.js');
assert.ok(pageDef, 'plan.js 应通过 Page() 交出页面对象');

function makePage() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch) => Object.assign(p.data, patch);
  return p;
}

const flush = () => new Promise((r) => setImmediate(r));
const legal = { period: 'daily', distanceKm: '5', durationMin: '30', count: '1' };

test('PL1 校验：三项都必须设置，非法值一个请求都不发', async () => {
  toasts = []; apiPuts = [];
  const p = makePage();
  Object.assign(p.data, legal, { distanceKm: '0' });
  await p.onSave();
  assert.equal(apiPuts.length, 0, '距离为 0 → 不提交');
  assert.match(toasts[0], /距离/);

  Object.assign(p.data, legal, { durationMin: '0' });
  await p.onSave();
  assert.equal(apiPuts.length, 0, '时间为 0 → 不提交');
  assert.match(toasts[toasts.length - 1], /时间/);

  Object.assign(p.data, legal, { count: '' });
  await p.onSave();
  assert.equal(apiPuts.length, 0, '次数为空 → 不提交');
  assert.match(toasts[toasts.length - 1], /次数/);

  Object.assign(p.data, legal, { distanceKm: '501' });
  await p.onSave();
  assert.equal(apiPuts.length, 0, '距离超上限 → 不提交');
});

test('PL2 保存成功：km 换算成米上送，成功后返回上一页', async () => {
  toasts = []; apiPuts = []; navBacks = [];
  const p = makePage();
  Object.assign(p.data, legal);
  await p.onSave();
  assert.equal(apiPuts.length, 1);
  assert.equal(apiPuts[0].p, '/plan');
  assert.deepEqual(apiPuts[0].body, {
    period: 'daily',
    targets: { distanceM: 5000, durationMin: 30, count: 1 },
  });
  await new Promise((r) => setTimeout(r, 650)); // navigateBack 在 600ms 延时里
  assert.equal(navBacks.length, 1, '保存成功后返回上一页');
});

test('PL3 周期切换：每天/每周', () => {
  const p = makePage();
  p.onPeriod({ currentTarget: { dataset: { value: 'weekly' } } });
  assert.equal(p.data.period, 'weekly');
  p.onPeriod({ currentTarget: { dataset: { value: 'daily' } } });
  assert.equal(p.data.period, 'daily');
});

test('PL4 进入页面拉取当前计划：预填表单 + 进度摘要', async () => {
  planResponse = {
    plan: { period: 'weekly', targets: { distanceM: 20000, durationMin: 120, count: 3 }, updatedAt: 1 },
    progress: { distanceM: 8000, durationSec: 2400, count: 1 },
    rings: [],
  };
  apiGets = [];
  const p = makePage();
  await p.load();
  assert.deepEqual(apiGets, ['/plan/current']);
  assert.equal(p.data.period, 'weekly');
  assert.equal(p.data.distanceKm, '20', '米 → km 一位小数');
  assert.equal(p.data.durationMin, '120');
  assert.equal(p.data.count, '3');
  assert.equal(p.data.progressText, '本周已完成');
  assert.match(p.data.progressDetail, /8\.0 km/);
});

test('PL5 无计划：表单为空、进度摘要走今天口径、不炸', async () => {
  planResponse = { plan: null, progress: { distanceM: 0, durationSec: 0, count: 0 }, rings: [] };
  const p = makePage();
  await p.load();
  assert.equal(p.data.plan === undefined || p.data.plan === null, true);
  assert.equal(p.data.progressText, '今天已完成');
});

test('PL6 默认值：无计划时按周期预填；切周期跟随；手动改过后不再覆盖', async () => {
  planResponse = { plan: null, progress: { distanceM: 0, durationSec: 0, count: 0 }, today: { distanceM: 0, durationSec: 0, count: 0 }, rings: [] };
  const p = makePage();
  await p.load();
  assert.deepEqual(
    { d: p.data.distanceKm, t: p.data.durationMin, c: p.data.count },
    { d: '3', t: '30', c: '1' },
    '无计划 → 每天默认 3km/30 分钟/1 次',
  );

  p.onPeriod({ currentTarget: { dataset: { value: 'weekly' } } });
  assert.deepEqual(
    { d: p.data.distanceKm, t: p.data.durationMin, c: p.data.count },
    { d: '21', t: '210', c: '7' },
    '切每周 → 21km/210 分钟/7 次',
  );

  p.onPeriod({ currentTarget: { dataset: { value: 'daily' } } });
  assert.equal(p.data.distanceKm, '3', '切回每天 → 恢复每天默认');

  // 手动改过目标：再切周期不覆盖用户输入
  p.onDistance({ detail: { value: '8' } });
  p.onPeriod({ currentTarget: { dataset: { value: 'weekly' } } });
  assert.equal(p.data.distanceKm, '8', '手动改过就不套默认值');
  assert.equal(p.data.period, 'weekly');
});

test('PL7 步进器步长：距离 0.5、时间 5、次数 1，且不降到 0', () => {
  const p = makePage();
  Object.assign(p.data, { distanceKm: '3', durationMin: '30', count: '1' });

  p.onStep({ currentTarget: { dataset: { key: 'distance', delta: '1' } } });
  assert.equal(p.data.distanceKm, '3.5');
  p.onStep({ currentTarget: { dataset: { key: 'duration', delta: '1' } } });
  assert.equal(p.data.durationMin, '35');
  p.onStep({ currentTarget: { dataset: { key: 'count', delta: '1' } } });
  assert.equal(p.data.count, '2');

  // 减到下限停住（三项都不能为 0）
  p.onStep({ currentTarget: { dataset: { key: 'count', delta: '-1' } } });
  p.onStep({ currentTarget: { dataset: { key: 'count', delta: '-1' } } });
  assert.equal(p.data.count, '1', '次数下限 1');
  Object.assign(p.data, { distanceKm: '0.5' });
  p.onStep({ currentTarget: { dataset: { key: 'distance', delta: '-1' } } });
  assert.equal(p.data.distanceKm, '0.5', '距离下限 0.5');
});
