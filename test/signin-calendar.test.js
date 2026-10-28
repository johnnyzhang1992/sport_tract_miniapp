/**
 * 签到月历纯函数（miniprogram/utils/signin-calendar.js）单测。
 *
 * 月历矩阵的通用件（周一起始、月份平移、月标签）复用 utils/footprint-calendar.js，
 * 这里只钉签到特有的东西：状态 → 圆点内容/下方标签的映射、缺日兜底、跨月脏数据、翻月上限。
 * 运行：npm test；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const sc = require('../miniprogram/utils/signin-calendar.js');
const day = (dateKey, state, reward = 0, streakDay = 0) => ({ dateKey, state, reward, streakDay });

test('SC1 网格填满：2026-10 周四开局 → 首行补 9/28-9/30、末行补 11/1，不留空圈', () => {
  const cells = sc.buildSigninMonth('2026-10', [], { today: '2026-10-28' });
  assert.equal(cells.length, 35, '3 格上月补位 + 31 天 + 1 格下月补位');
  assert.equal(cells.filter((c) => c.out).length, 4);
  assert.deepEqual(cells.slice(0, 3).map((c) => c.date), ['2026-09-28', '2026-09-29', '2026-09-30'],
    '首行补位是上月的真实日期，不是空占位');
  assert.equal(cells[3].date, '2026-10-01');
  assert.equal(cells[33].date, '2026-10-31');
  assert.equal(cells[34].date, '2026-11-01', '末行补位是下月 1 号');
  assert.deepEqual(cells.slice(0, 3).map((c) => c.day), [28, 29, 30], '补位格的 day 是它自己的日号，不是负偏移');
  assert.deepEqual(cells[0].label, 28, '补位格下方显示它自己的日号');
  assert.equal(cells.filter((c) => !c.out && c.date.startsWith('2026-10')).length, 31, '当月 31 天一天不落');
  assert.deepEqual(sc.WEEK_LABELS, ['一', '二', '三', '四', '五', '六', '日']);
});

test('SC2 状态映射：已签✓ / 可补补 / 未来+N / 漏签空 / 今天标「今天」', () => {
  const days = [
    day('2026-10-01', 'signed', 1, 1),
    day('2026-10-02', 'makeup', 2, 2),
    day('2026-10-27', 'missed', 0, 0),
    day('2026-10-29', 'future', 7, 30),
  ];
  const cells = sc.buildSigninMonth('2026-10', days, { today: '2026-10-28' });
  const at = (d) => cells.find((c) => c.date === d);
  assert.equal(at('2026-10-01').mark, '✓');
  assert.equal(at('2026-10-01').state, 'signed');
  assert.equal(at('2026-10-02').mark, '补');
  assert.equal(at('2026-10-02').makeupable, true, '可补格要带标记，组件据此决定点不点得动');
  assert.equal(at('2026-10-27').mark, '', '漏签格留空，不显示 0');
  assert.equal(at('2026-10-29').mark, '+7', '未来格显示一路签下去能拿的分，不是日期推算');
  const today = at('2026-10-28');
  assert.equal(today.state, 'today');
  assert.equal(today.isToday, true);
  assert.equal(today.label, '今天', '今天格下方写「今天」而不是日号');
  assert.equal(at('2026-10-01').label, 1, '其余格下方是日号');
});

test('SC3 缺日兜底：接口少发某天按漏签渲染，不崩也不留空穴', () => {
  const cells = sc.buildSigninMonth('2026-10', [day('2026-10-01', 'signed')], { today: '2026-10-05' });
  const missing = cells.find((c) => c.date === '2026-10-15');
  assert.equal(missing.state, 'missed');
  assert.equal(missing.mark, '');
});

test('SC4 补位格也带真实状态：上月签过的日子在首行显示✓，不被画成灰圈', () => {
  const days = [
    day('2026-09-30', 'signed', 5),   // 落在 10 月视图的首行补位
    day('2026-10-01', 'signed', 6),
    day('2026-11-01', 'future', 7),   // 落在末行补位
  ];
  const cells = sc.buildSigninMonth('2026-10', days, { today: '2026-10-28' });
  assert.equal(cells[2].date, '2026-09-30');
  assert.equal(cells[2].mark, '✓', '补位格的状态来自同一条 days，不能一律置灰');
  assert.equal(cells[2].out, true, '但仍标着不属于本月，样式上要淡一档');
  assert.equal(cells[34].mark, '+7');
  assert.equal(cells.filter((c) => !c.out).length, 31, '补位不挤掉当月任何一天');
});

test('SC5 翻月上限：当月及以后不可再往前翻，历史月可以', () => {
  assert.equal(sc.canGoNext('2026-10', '2026-10'), false, '当月就是最新，没有下个月可看');
  assert.equal(sc.canGoNext('2026-11', '2026-10'), false, '未来月份没数据');
  assert.equal(sc.canGoNext('2026-09', '2026-10'), true);
});

test('SC6 复用足迹那份通用件：周标签与月份平移跨年同源', () => {
  assert.deepEqual(sc.WEEK_LABELS, ['一', '二', '三', '四', '五', '六', '日']);
  assert.equal(sc.shiftMonth('2026-12', 1), '2027-01', '跨年进位');
  assert.equal(sc.shiftMonth('2027-01', -1), '2026-12');
  assert.equal(sc.monthLabel('2026-10'), '2026年10月');
});
