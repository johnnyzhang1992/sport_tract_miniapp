/**
 * 足迹日历纯函数（miniprogram/utils/footprint-calendar.js）单测：
 * 月历矩阵（周一开头、行数按月份实际天数收放）、跨月日期不渲染、今天/选中/打点三态互不覆盖、
 * 月份平移跨年、总览文案、列表按月分组。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fc = require('../miniprogram/utils/footprint-calendar.js');

test('C1 月历矩阵：2026-09 周二开局 → 首格补白、共 5 行 35 格、末格是 30 号', () => {
  const cells = fc.buildMonthGrid('2026-09', {}, { today: '2026-09-22' });
  assert.equal(cells.length, 35, '9月1日是周二（lead=1）+ 30 天 = 31 格 → 补到 5 行');
  assert.equal(cells[0].out, true, '首格是上月补白');
  assert.equal(cells[0].day, '');
  assert.equal(cells[0].date, '', '补白格不可点：不带 date');
  assert.equal(cells[1].day, 1);
  assert.equal(cells[1].date, '2026-09-01');
  assert.equal(cells[30].day, 30);
  assert.equal(cells[30].date, '2026-09-30');
  assert.equal(cells[34].out, true, '末行不满一周，补白占位保住七列栅格');
  assert.equal(cells.filter((c) => c.out).length, 5, '1 个开头补白 + 4 个末尾补白');
  assert.ok(cells.filter((c) => c.out).length < 7, '不留整周空行');
  assert.deepEqual(fc.WEEK_LABELS, ['一', '二', '三', '四', '五', '六', '日']);
});

test('C2 月历矩阵：需要 6 行的月份补齐（2026-11 周日开局）', () => {
  const cells = fc.buildMonthGrid('2026-11', {}, { today: '2026-11-02' });
  assert.equal(cells[0].out, true);
  assert.equal(cells[5].out, true, '周日开局 → 前面 6 格补白');
  assert.equal(cells[6].date, '2026-11-01', '1 号落在最后一列（周日）');
  assert.equal(cells.length, 42, 'lead=6 + 30 天 = 36 格 → 6 行 42 格');
  assert.equal(cells[35].date, '2026-11-30');
  assert.equal(cells[41].out, true);
});

test('C3 打点/今天/选中三态：各自独立标记，count 透传', () => {
  const counts = { '2026-09-19': 2, '2026-09-20': 1 };
  const cells = fc.buildMonthGrid('2026-09', counts, { today: '2026-09-20', selected: '2026-09-19' });
  const d19 = cells.find((c) => c.date === '2026-09-19');
  const d20 = cells.find((c) => c.date === '2026-09-20');
  const d21 = cells.find((c) => c.date === '2026-09-21');
  assert.deepEqual([d19.count, d19.marked, d19.isToday, d19.selected], [2, true, false, true]);
  assert.deepEqual([d20.count, d20.marked, d20.isToday, d20.selected], [1, true, true, false]);
  assert.deepEqual([d21.count, d21.marked, d21.isToday, d21.selected], [0, false, false, false]);
  const empty = fc.buildMonthGrid('2026-09', {}, { today: '2026-09-20' });
  assert.equal(empty.find((c) => c.date === '2026-09-20').isToday, true, '无打点时今天照样描边');
});

test('C4 月份平移：跨年正确、双向、0 位移恒等', () => {
  assert.equal(fc.shiftMonth('2026-09', 1), '2026-10');
  assert.equal(fc.shiftMonth('2026-12', 1), '2027-01', '12 月往后进位到次年');
  assert.equal(fc.shiftMonth('2026-01', -1), '2025-12', '1 月往前退位到上年');
  assert.equal(fc.shiftMonth('2026-12', -12), '2025-12');
  assert.equal(fc.shiftMonth('2026-09', 0), '2026-09');
  assert.equal(fc.shiftMonth('2026-09', 14), '2027-11');
  assert.equal(fc.shiftMonth('2026-09', -14), '2025-07');
});

test('C5 月份区间与文案：左闭右开、月标签与日标签', () => {
  assert.deepEqual(fc.monthRange('2026-09'), { from: '2026-09-01', to: '2026-10-01' });
  assert.deepEqual(fc.monthRange('2026-12'), { from: '2026-12-01', to: '2027-01-01' }, '跨年右开');
  assert.deepEqual(fc.monthRange('2026-02'), { from: '2026-02-01', to: '2026-03-01' });
  assert.equal(fc.monthLabel('2026-09'), '2026年9月', '月份数字不补零');
  assert.equal(fc.monthLabel('2026-12'), '2026年12月');
  assert.equal(fc.dayLabel('2026-09-05'), '9月5日');
  assert.equal(fc.monthOf('2026-09-05'), '2026-09');
});

test('C6 总览文案：三项齐全才拼，缺项不写出「0 个」这种半成品', () => {
  assert.equal(fc.summaryText({ total: 4, placeCount: 4, photoCount: 18 }), '4 条记录 · 4 个地方 · 18 张照片');
  assert.equal(fc.summaryText({ total: 0, placeCount: 0, photoCount: 0 }), '0 条记录 · 0 个地方 · 0 张照片');
  assert.equal(fc.summaryText({ total: 7, placeCount: 3 }), '7 条记录 · 3 个地方', '照片数缺失（接口未返回）时不硬凑 0');
  assert.equal(fc.summaryText(null), '');
  assert.equal(fc.summaryText({}), '');
});

test('C7 列表按月分组：组内保持原顺序，跨页同月不重复开组', () => {
  const cards = [
    { visitDate: '2026-09-20' },
    { visitDate: '2026-09-19' },
    { visitDate: '2026-08-31' },
    { visitDate: '2026-08-05' },
  ];
  const groups = fc.groupByMonth(cards);
  assert.deepEqual(groups.map((g) => g.label), ['2026年9月', '2026年8月']);
  assert.deepEqual(groups[0].items.map((r) => r.visitDate), ['2026-09-20', '2026-09-19']);
  assert.equal(groups[1].items.length, 2);
  assert.deepEqual(fc.groupByMonth([]), []);
  // 脏数据（缺 visitDate）不炸：归到「其他」组，仍能被点开
  const dirty = fc.groupByMonth([{ visitDate: '' }, { visitDate: '2026-09-01' }]);
  assert.equal(dirty.length, 2);
  assert.equal(dirty[0].label, '其他');
});

test('C8 打点计数按天聚合成 map：同月多条累加，跨月互不干扰', () => {
  const days = [
    { date: '2026-09-20', count: 2 },
    { date: '2026-09-19', count: 1 },
    { date: '2026-08-05', count: 4 },
  ];
  const map = fc.toCountMap(days);
  assert.equal(map['2026-09-20'], 2);
  assert.equal(map['2026-08-05'], 4);
  assert.equal(map['2026-09-01'], undefined);
  assert.deepEqual(fc.toCountMap(null), {});
  assert.deepEqual(fc.toCountMap([{ date: '2026-09-01' }]), { '2026-09-01': 1 }, '缺 count 视为 1 条');
});
