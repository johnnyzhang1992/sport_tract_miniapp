/**
 * 足迹周期换算（列表页 pages/footprint-list 与统计页 packageFootprint/pages/footprint-stats 共用）
 * visitDate 存的是 YYYY-MM-DD 字符串，故区间由客户端按自然月/自然年算日期串（左闭右开），
 * 直接交给接口做字符串 $gte/$lt 比对，不走 epoch ms。
 */
const RANGES = [
  { value: 'month', label: '月' },
  { value: 'year', label: '年' },
  { value: 'all', label: '全部' },
];

/** 周期选择弹窗：每个粒度展示最近 N 个周期 */
const PICKER_COUNT = { month: 12, year: 5 };

const pad = (n) => String(n).padStart(2, '0');
/** Date → 'YYYY-MM-DD'（本地时区） */
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 月/年周期区间 [from, to)（自然月/自然年），offset 为往前的周期数（0=当前周期） */
function periodRange(range, offset) {
  const now = new Date();
  if (range === 'month') {
    return {
      from: dateStr(new Date(now.getFullYear(), now.getMonth() - offset, 1)),
      to: dateStr(new Date(now.getFullYear(), now.getMonth() - offset + 1, 1)),
    };
  }
  return {
    from: dateStr(new Date(now.getFullYear() - offset, 0, 1)),
    to: dateStr(new Date(now.getFullYear() - offset + 1, 0, 1)),
  };
}

/** 周期文案：月 → "2026年9月"，年 → "2026年"（手工拆串，避开 new Date('YYYY-MM-DD') 的 UTC 解析） */
function periodLabelOf(range, p) {
  const [y, m] = p.from.split('-').map(Number);
  return range === 'month' ? `${y}年${m}月` : `${y}年`;
}

module.exports = { RANGES, PICKER_COUNT, periodRange, periodLabelOf };
