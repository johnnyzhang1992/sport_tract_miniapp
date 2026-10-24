/**
 * 统计页「运动趋势」五张变化卡（utils/stats-metrics.js）。
 *
 * 口径（已与用户确认）：近 30 天 vs 再往前 30 天；时长/距离/消耗用**日均**、次数用**30 天总量**；
 * 配速按 distance ÷ (duration − standstillMs) 算并**方向反转**（数值变小＝变快＝向上）；
 * 相对变化落在 ±5% 内算持平。箭头一律表示「变好」，不是数值朝上。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMetricCards, buildTrendChart } = require('../miniprogram/utils/stats-metrics.js');

const DAY = '2026-09-01';

/** 造 60 天的桶：前 30 天（older）与近 30 天（recent）各把总量摊到其中一天，其余补 0 */
function dailyRows(older = {}, recent = {}) {
  const rows = [];
  for (let i = 0; i < 60; i++) {
    const isRecent = i >= 30;
    const seed = isRecent ? recent : older;
    const first = isRecent ? i === 30 : i === 0;
    rows.push({
      date: `${DAY}#${i}`,
      distance: first ? seed.distance || 0 : 0,
      duration: first ? seed.duration || 0 : 0,
      count: first ? seed.count || 0 : 0,
      calories: first ? seed.calories || 0 : 0,
      standstillMs: first ? seed.standstillMs || 0 : 0,
    });
  }
  return rows;
}

const byKey = (cards) => Object.fromEntries(cards.map((c) => [c.key, c]));

test('SM1 五张卡的算例：12 次/180km/26h/15750 千卡 vs 10 次/150km/24h/14400 千卡', () => {
  const cards = buildMetricCards(
    dailyRows(
      { distance: 150000, duration: 86400, count: 10, calories: 14400 },
      { distance: 180000, duration: 93600, count: 12, calories: 15750 },
    ),
  );
  assert.deepEqual(
    cards.map((c) => c.key),
    ['distance', 'duration', 'count', 'pace', 'calories'],
    '卡片顺序固定：距离 / 时长 / 次数 / 配速 / 消耗',
  );
  const m = byKey(cards);

  // 距离：180/30=6.0 日均 vs 150/30=5.0 → +20%
  assert.equal(m.distance.value, '6.0');
  assert.equal(m.distance.unit, '公里/天');
  assert.equal(m.distance.dir, 'up');
  assert.equal(m.distance.diffText, '+20%');
  assert.match(m.distance.arrowIcon, /lucide-trending-up-green\.png$/, '向上用 lucide 的 trending-up');

  // 时长：26h/30=52 分钟日均 vs 24h/30=48 分钟 → +8%
  assert.equal(m.duration.value, '52');
  assert.equal(m.duration.unit, '分钟/天');
  assert.equal(m.duration.dir, 'up');
  assert.equal(m.duration.diffText, '+8%');

  // 次数：用总量，不做日均（0.4 次/天 读着没意义）
  assert.equal(m.count.value, '12');
  assert.equal(m.count.unit, '次');
  assert.equal(m.count.dir, 'up');

  // 配速：93600s/180000m = 520 s/km = 8'40"；86400s/150000m = 576 = 9'36" → 变快
  assert.equal(m.pace.value, `8'40"`);
  assert.equal(m.pace.unit, '/公里');
  assert.equal(m.pace.dir, 'up', '配速变快是「变好」，箭头朝上');
  assert.match(m.pace.arrowIcon, /lucide-trending-up-green\.png$/, '配速变快也用同一个向上图标');
  assert.equal(m.pace.diffText, '+10%');

  // 消耗：15750/30=525 vs 14400/30=480 → +9%
  assert.equal(m.calories.value, '525');
  assert.equal(m.calories.unit, '千卡/天');
  assert.equal(m.calories.dir, 'up');
  assert.equal(m.calories.diffText, '+9%');
});

test('SM2 ±5% 内算持平；退化用向下箭头', () => {
  const flat = byKey(buildMetricCards(dailyRows({ distance: 100000 }, { distance: 103000 })));
  assert.equal(flat.distance.dir, 'flat');
  assert.match(flat.distance.arrowIcon, /lucide-minus-gray\.png$/, '持平用 lucide 的横杠');
  assert.equal(flat.distance.diffText, '+3%', '持平也照实报百分比，箭头才是「不变」');

  const down = byKey(buildMetricCards(dailyRows({ distance: 100000 }, { distance: 92000 })));
  assert.equal(down.distance.dir, 'down');
  assert.match(down.distance.arrowIcon, /lucide-trending-down-red\.png$/);
  assert.equal(down.distance.diffText, '-8%');
});

test('SM3 上一段没有数据 → 不编箭头和百分比，值照常显示', () => {
  const m = byKey(buildMetricCards(dailyRows({}, { distance: 180000, count: 12 })));
  assert.equal(m.distance.value, '6.0');
  assert.equal(m.distance.dir, 'none');
  assert.equal(m.distance.arrowIcon, '', '没得比时连图标都不给');
  assert.equal(m.distance.diffText, '');
  assert.equal(m.count.dir, 'none', '分母为 0 时次数也不编涨跌');
});

test('SM4 配速剔静止；整段没距离时给「—」不算涨跌', () => {
  // 近 30 天 26h 里有 1h 静止 → (93600-3600)/180000 = 500 s/km = 8'20"
  const m = byKey(
    buildMetricCards(
      dailyRows(
        { distance: 150000, duration: 86400 },
        { distance: 180000, duration: 93600, standstillMs: 3600000 },
      ),
    ),
  );
  assert.equal(m.pace.value, `8'20"`, '静止要扣掉，否则比详情页的平均配速偏慢');

  const noDistance = byKey(buildMetricCards(dailyRows({ count: 3 }, { count: 4 })));
  assert.equal(noDistance.pace.value, '—');
  assert.equal(noDistance.pace.dir, 'none');
});

test('SM5 不足 60 天：按实际天数当分母，不把缺的天数算成 0 日均', () => {
  // 只有 40 天：近段 30 天、前段只有 10 天。前段 10 天共 50km → 日均 5.0（不是 50/30=1.7）
  const zeros = (tag) => ({ date: tag, distance: 0, duration: 0, count: 0, calories: 0, standstillMs: 0 });
  const rows = [{ date: 'p0', distance: 50000, duration: 0, count: 0, calories: 0, standstillMs: 0 }];
  for (let i = 1; i < 10; i++) rows.push(zeros(`p${i}`));
  rows.push({ date: 'r0', distance: 180000, duration: 0, count: 0, calories: 0, standstillMs: 0 });
  for (let i = 1; i < 30; i++) rows.push(zeros(`r${i}`));
  assert.equal(rows.length, 40);
  const m = byKey(buildMetricCards(rows));
  assert.equal(m.distance.value, '6.0');
  assert.equal(m.distance.dir, 'up');
  assert.equal(m.distance.diffText, '+20%', '50km/10 天 = 5.0，跟 6.0 比是 +20%');
});

test('SM6 没有数据时返回空数组（页面据此隐藏整块）', () => {
  assert.deepEqual(buildMetricCards([]), []);
  assert.deepEqual(buildMetricCards(null), []);
  assert.deepEqual(buildMetricCards(dailyRows({}, {})), []);
});

test('SM7 半屏图：五个指标各自的单位与取值（配速用分钟/公里，Y 轴读数才直观）', () => {
  const rows = [
    { date: '2026-10-01', distance: 5000, duration: 1800, count: 1, calories: 300, standstillMs: 0 },
    { date: '2026-10-02', distance: 10000, duration: 3600, count: 2, calories: 600, standstillMs: 0 },
  ];
  const dist = buildTrendChart(rows, 'distance', 'week');
  assert.equal(dist.title, '距离趋势');
  assert.equal(dist.unit, 'km');
  assert.deepEqual(dist.data.map((d) => d.value), [5, 10]);

  const dur = buildTrendChart(rows, 'duration', 'week');
  assert.equal(dur.unit, '分钟');
  assert.deepEqual(dur.data.map((d) => d.value), [30, 60]);

  const cnt = buildTrendChart(rows, 'count', 'week');
  assert.deepEqual(cnt.data.map((d) => d.value), [1, 2]);

  const cal = buildTrendChart(rows, 'calories', 'week');
  assert.equal(cal.unit, '千卡');
  assert.deepEqual(cal.data.map((d) => d.value), [300, 600]);

  // 1800/5=360s=6 分钟/公里；3600/10=360s 同样 6 分钟/公里
  const pace = buildTrendChart(rows, 'pace', 'week');
  assert.equal(pace.unit, '分钟/公里');
  assert.deepEqual(pace.data.map((d) => d.value), [6, 6]);
  assert.equal(pace.note, '数值越小越快', '配速的柱子越低越快，别让用户按「越高越好」理解');
});

test('SM8 配速半屏跳过没运动的日子（空桶会画成 0 配速＝看起来最快）', () => {
  const rows = [
    { date: '2026-10-01', distance: 5000, duration: 1800, count: 1, calories: 300, standstillMs: 0 },
    { date: '2026-10-02', distance: 0, duration: 0, count: 0, calories: 0, standstillMs: 0 },
    { date: '2026-10-03', distance: 5000, duration: 1500, count: 1, calories: 300, standstillMs: 0 },
  ];
  const pace = buildTrendChart(rows, 'pace', 'week');
  assert.deepEqual(pace.data.map((d) => d.label), ['10-01', '10-03'], '空桶整根不画');
  assert.deepEqual(pace.data.map((d) => d.value), [6, 5], '静止也要扣掉');

  // 其它四个指标照旧保留空桶（0 就是 0，语义正确）
  assert.equal(buildTrendChart(rows, 'distance', 'week').data.length, 3);
});

test('SM9 X 轴标签随窗口粒度变：年＝M月、6个月＝周号、周/月＝MM-DD', () => {
  const rows = [{ date: '2026-10-05', distance: 1000, duration: 600, count: 1, calories: 100, standstillMs: 0 }];
  assert.equal(buildTrendChart(rows, 'distance', 'week').data[0].label, '10-05');
  assert.equal(buildTrendChart(rows, 'distance', 'year').data[0].label, '10月');
  assert.equal(buildTrendChart([{ ...rows[0], date: '2026-W41' }], 'distance', 'week6').data[0].label, 'W41');
});
