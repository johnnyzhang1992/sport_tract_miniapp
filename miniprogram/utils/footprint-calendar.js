/**
 * 足迹日历形态纯函数（列表页 pages/footprint-list 的日历态与 footprint-calendar 组件共用）
 *
 * 约定沿用 utils/footprint-period.js：visitDate 是 YYYY-MM-DD 字符串，
 * 一切区间都按字符串字典序比较，不 new Date('YYYY-MM-DD')（那会按 UTC 解析、跨时区偏一天）。
 * 只有「某月 1 日是周几 / 这月有几天」必须走 Date，故统一用 new Date(y, m-1, d) 的本地构造重载形式。
 */

/** 周一起始（竞品与国人行历习惯一致） */
const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

const pad = (n) => String(n).padStart(2, '0');

/** Date → 'YYYY-MM-DD'（本地时区） */
function dateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' → 'YYYY-MM'（脏数据原样返回空串，由调用方兜底） */
function monthOf(date) {
  return typeof date === 'string' && date.length >= 7 ? date.slice(0, 7) : '';
}

/** 今天的 YYYY-MM-DD */
function todayStr() {
  return dateStr(new Date());
}

/** 当前月 YYYY-MM */
function currentMonth() {
  return monthOf(todayStr());
}

/** 月份平移：'2026-12' +1 → '2027-01'（跨年靠 Date 的月份进位） */
function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** 月区间 [from, to)：左闭右开，直接喂接口的 from/to */
function monthRange(month) {
  return { from: `${month}-01`, to: `${shiftMonth(month, 1)}-01` };
}

/** 单日区间 [date, 次日)：日历态点某天时用 */
function dayRange(date) {
  const [y, m, d] = date.split('-').map(Number);
  return { from: date, to: dateStr(new Date(y, m - 1, d + 1)) };
}

/** '2026-09' → '2026年9月'（月份不补零） */
function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${y}年${m}月`;
}

/** '2026-09-05' → '9月5日'（脏数据返回空串，交由调用方兜底文案） */
function dayLabel(date) {
  const parts = typeof date === 'string' ? date.split('-') : [];
  if (parts.length < 3) return '';
  return `${Number(parts[1])}月${Number(parts[2])}日`;
}

/** [{date, count}] → { 'YYYY-MM-DD': count }；缺 count 视为 1 条 */
function toCountMap(days) {
  const map = {};
  (Array.isArray(days) ? days : []).forEach((row) => {
    if (!row || !row.date) return;
    map[row.date] = (map[row.date] || 0) + (Number(row.count) || 1);
  });
  return map;
}

/**
 * 月历矩阵：周一起始，开头补白（上月）、末尾按实际行数收放（不留整周空行）
 * 补白格 out=true 且不带 date —— 前端据此渲染空格且点不动。
 * @param counts  toCountMap 的结果，决定 marked/count
 * @param opts    { today, selected }：默认取本机今天；显式传入便于单测与「回到今天」
 */
function buildMonthGrid(month, counts, opts) {
  const today = (opts && opts.today) || todayStr();
  const selected = (opts && opts.selected) || '';
  const map = counts || {};
  const [y, m] = month.split('-').map(Number);
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // 周一=0
  const dim = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push({ key: `lead-${i}`, date: '', day: '', out: true });
  for (let d = 1; d <= dim; d++) {
    const date = `${month}-${pad(d)}`;
    const count = map[date] || 0;
    cells.push({
      key: date,
      date,
      day: d,
      out: false,
      count,
      marked: count > 0,
      isToday: date === today,
      selected: date === selected,
    });
  }
  // 行数按 lead+dim 实收，末尾若已满整周则不再补，否则补到当周结束
  const tail = cells.length % 7 === 0 ? 0 : 7 - (cells.length % 7);
  for (let i = 0; i < tail; i++) cells.push({ key: `tail-${i}`, date: '', day: '', out: true });
  return cells;
}

/**
 * 顶部总览文案：「4 条记录 · 4 个地方 · 18 张照片」
 * 缺字段就不拼那一项（宁缺不凑 0，接口没返回照片数时不该显示「0 张照片」）。
 */
function summaryText(summary) {
  if (!summary) return '';
  const parts = [];
  if (typeof summary.total === 'number') parts.push(`${summary.total} 条记录`);
  if (typeof summary.placeCount === 'number') parts.push(`${summary.placeCount} 个地方`);
  if (typeof summary.photoCount === 'number') parts.push(`${summary.photoCount} 张照片`);
  return parts.join(' · ');
}

/**
 * 列表按月分组（visitDate 倒序入参 → 组序与组内序都保持原样）
 * 缺日期的脏数据归到「其他」组而不是丢掉，否则卡片数与 total 对不上。
 */
function groupByMonth(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const groups = [];
  let last = null;
  for (const card of list) {
    const month = monthOf(card && card.visitDate);
    if (!last || last.month !== month) {
      last = { month, label: month ? monthLabel(month) : '其他', items: [] };
      groups.push(last);
    }
    last.items.push(card);
  }
  return groups;
}

module.exports = {
  WEEK_LABELS,
  monthOf,
  todayStr,
  currentMonth,
  shiftMonth,
  monthRange,
  dayRange,
  monthLabel,
  dayLabel,
  toCountMap,
  buildMonthGrid,
  summaryText,
  groupByMonth,
};
