/**
 * 签到月历纯函数（积分页半屏日历 signin-calendar 组件用）。
 *
 * 月历矩阵的通用件（周一起始、月份平移、月标签）直接复用 utils/footprint-calendar.js，
 * 不另写一份；但格子里放什么由签到自己定——足迹那张网格是「某天有几条记录」，
 * 这里是「某天签没签、能不能补、未来能拿几分」，两者语义不同，硬合并只会把两边都写复杂。
 *
 * 状态一律取服务端 /points/signin/calendar 的 days（可补判据在那边与七格同源），
 * 这里只做展示映射，绝不自己判「这天能不能补」。
 */
const { WEEK_LABELS, shiftMonth, monthLabel } = require('./footprint-calendar.js');

const pad = (n) => String(n).padStart(2, '0');

/** 圆点里的内容：已签打勾、可补标「补」、未来日标能拿的分；今天没签和漏签都留空圈 */
function markOf(state, reward) {
  if (state === 'signed') return '✓';
  if (state === 'makeup') return '补';
  if (state === 'future') return reward > 0 ? `+${reward}` : '';
  return '';
}

/**
 * @param {string} month YYYY-MM
 * @param {{dateKey:string,state:string,reward:number}[]} days 接口下发的逐日状态（含首尾补位日期）
 * @param {{today?:string}} opts today = YYYY-MM-DD，决定哪格写「今天」
 */
function buildSigninMonth(month, days, opts) {
  const today = (opts && opts.today) || '';
  const byKey = new Map((days || []).filter((d) => d && typeof d.dateKey === 'string').map((d) => [d.dateKey, d]));
  const [y, m] = month.split('-').map(Number);
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // 周一 = 0
  const dim = new Date(y, m, 0).getDate();

  /** 某天 → 格子；补位格传进来的 dateKey 已跨月，日号从串上取，别用越界的偏移量 */
  const cellAt = (dateKey, out) => {
    const day = Number(dateKey.slice(8));
    const rec = byKey.get(dateKey);
    // 接口少发某天按漏签兜底：留空穴会让整月看起来缺一格，用户会以为是渲染坏了
    const state = rec ? rec.state : dateKey === today ? 'today' : 'missed';
    return {
      key: dateKey,
      date: dateKey,
      day,
      out,
      state,
      mark: markOf(state, rec ? rec.reward : 0),
      label: dateKey === today ? '今天' : day,
      isToday: dateKey === today,
      makeupable: state === 'makeup',
    };
  };

  const cells = [];
  // 首尾不留空圈：填相邻月份的日期（2026-10-28 用户点名「日历保持完整」），
  // 状态来自接口同一条 days（服务端把范围扩到当月 ±6 天），所以补位格不会把签过的日子画成灰圈
  for (let i = 0; i < lead; i += 1) {
    cells.push(cellAt(dateKeyOf(y, m, i + 1 - lead), true));
  }
  for (let d = 1; d <= dim; d += 1) cells.push(cellAt(`${month}-${pad(d)}`, false));
  const tail = cells.length % 7 === 0 ? 0 : 7 - (cells.length % 7);
  for (let i = 0; i < tail; i += 1) {
    cells.push(cellAt(dateKeyOf(y, m, dim + 1 + i), true));
  }
  return cells;
}

/** 按「某月第 day 天」取 YYYY-MM-DD，day 可为 0/负数或超过月末，靠 Date 自己进退位 */
function dateKeyOf(year, monthOneBase, day) {
  const d = new Date(year, monthOneBase - 1, day);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 只能往历史翻：未来月份没有任何数据可看，当月就是最新一格（与足迹月历同一口径） */
function canGoNext(month, latestMonth) {
  return month < latestMonth;
}

module.exports = { WEEK_LABELS, shiftMonth, monthLabel, buildSigninMonth, canGoNext };
