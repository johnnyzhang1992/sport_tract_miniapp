/**
 * 步数统计页口径：时间档只驱动柱状图；概况与每日明细始终全量。
 * 桩：api / login-gate / werun 就地注入；页面真实 load/onRangeTap 参与断言。
 * 运行：node --test test/werun-stats-range-scope.test.js。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const calls = [];
const report = {
  overview: { totalStep: 50000, avgStep: 5000, bestDate: '2026-10-25', bestStep: 18000, syncedDays: 10 },
  startDate: '2026-10-01',
  endDate: '2026-10-31',
};
const daysPage1 = {
  items: [{ date: '2026-10-25', step: 18000, weekday: '周日' }],
  total: 1,
  page: 1,
  hasMore: false,
};
const statsByRange = {
  7: { trend: [{ label: '10/25', step: 1000 }], bucket: 'day' },
  30: { trend: [{ label: '10/25', step: 2000 }, { label: '10/26', step: 3000 }], bucket: 'day' },
};

const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = {
  id: apiPath, filename: apiPath, loaded: true,
  exports: {
    get(p) {
      calls.push(p);
      if (p === '/werun/report') return Promise.resolve(report);
      if (p.indexOf('/werun/days?range=all') === 0) return Promise.resolve(daysPage1);
      const m = p.match(/^\/werun\/stats\?range=(\d+)$/);
      if (m) return Promise.resolve(statsByRange[m[1]]);
      if (p.indexOf('/werun/stats?range=30&compare=1') === 0) {
        return Promise.resolve({
          overview: { totalStep: 3000, avgStep: 1500, bestStep: 2000, syncedDays: 2 },
          prevOverview: { totalStep: 6000, avgStep: 3000, bestStep: 4000, syncedDays: 2 },
        });
      }
      return Promise.resolve(null);
    },
  },
  children: [], paths: [],
};
const loginPath = require.resolve('../miniprogram/utils/login-gate.js');
require.cache[loginPath] = {
  id: loginPath, filename: loginPath, loaded: true,
  exports: { waitSession: async () => true, ensureLogin: async () => true }, children: [], paths: [],
};
const werunPath = require.resolve('../miniprogram/utils/werun.js');
require.cache[werunPath] = {
  id: werunPath, filename: werunPath, loaded: true,
  exports: { syncDailySteps: async () => null }, children: [], paths: [],
};

global.wx = { showToast() {}, stopPullDownRefresh() {} };
let pageDef = null;
global.Page = (d) => { pageDef = d; };
require('../miniprogram/pages/werun-stats/werun-stats.js');

function boot() {
  const p = Object.assign({}, pageDef);
  p.data = JSON.parse(JSON.stringify(pageDef.data));
  p.setData = (patch) => Object.assign(p.data, patch || {});
  return p;
}

test('WSR-1 首屏：概况/明细全量，图表取当前档', async () => {
  calls.length = 0;
  const p = boot();
  await p.load();
  assert.ok(calls.includes('/werun/report'), '概况走全量报告');
  assert.ok(calls.includes('/werun/days?range=all&page=1&pageSize=20'), '明细走全量');
  assert.ok(calls.includes('/werun/stats?range=7'), '图表按当前档');
  assert.equal(p.data.overview.totalText, '5万');
  assert.equal(p.data.overview.bestDateText, '10/25');
  assert.equal(p.data.days.length, 1);
  assert.equal(p.data.trend.data.length, 1);
  assert.equal(p.data.trend.data[0].value, 1000);
});

test('WSR-2 切档：只重拉图表，概况与明细原样保留', async () => {
  calls.length = 0;
  const p = boot();
  await p.load();
  const overviewBefore = JSON.stringify(p.data.overview);
  const daysBefore = JSON.stringify(p.data.days);

  calls.length = 0;
  await p.onRangeTap({ currentTarget: { dataset: { range: 30 } } });

  assert.deepEqual(calls, ['/werun/stats?range=30'], '切档不应再拉概况/明细');
  assert.equal(JSON.stringify(p.data.overview), overviewBefore, '概况不随档位变');
  assert.equal(JSON.stringify(p.data.days), daysBefore, '明细不随档位变');
  assert.equal(p.data.range, 30);
  assert.equal(p.data.trend.data.length, 2, '图表换成 30 日数据');
  assert.equal(p.data.trend.data[1].value, 3000);
});

test('WSR-3 图表失败：保留旧图与全量内容，不清空页面', async () => {
  const realGet = require.cache[apiPath].exports.get;
  require.cache[apiPath].exports.get = (p) => (
    p === '/werun/stats?range=30' ? Promise.reject(new Error('down')) : realGet(p)
  );
  try {
    const p = boot();
    await p.load();
    p.setData({ range: 7 });
    await p.onRangeTap({ currentTarget: { dataset: { range: 30 } } });
    assert.equal(p.data.overview.totalText, '5万', '概况保留');
    assert.equal(p.data.days.length, 1, '明细保留');
    assert.equal(p.data.trend.data.length, 1, '旧图保留');
  } finally {
    require.cache[apiPath].exports.get = realGet;
  }
});
