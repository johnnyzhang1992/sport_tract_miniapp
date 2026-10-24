/**
 * 运动日历（统计页）：把「近 365 天每日 count」摊成月历格子。
 *
 * 纯函数，不碰网络：调用方把 /stats/trend?days=365 的 rows 传进来（[{date:'YYYY-MM-DD', count}]）。
 * 口径：
 * - 一周从周日开始（参考 Keep 的日历：日 一 二 三 四 五 六）；
 * - 首行用上月末尾、末行用下月开头补满 7 列，这些格子标 inMonth=false（页面置灰）；
 * - 有运动＝当天 count > 0；跨月补位格不参与「当月累计天数」。
 * 日期一律用 UTC 构造（YYYY-MM-DD 是纯日期串，用本地时区会在夏令时/时差机器上偏移一天）。
 */

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** 当月天数 */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dateKey(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * @param {Array<{date:string, count:number}>} rows 近 365 天按天升序
 * @param {number} year
 * @param {number} month 1-12
 * @param {string} today 'YYYY-MM-DD'（缺省取系统当天，仅用于标记今天）
 * @returns {{weeks: Array<Array<{day:number, inMonth:boolean, hasActivity:boolean, isToday:boolean}>>, activeDays:number}}
 */
function buildMonthGrid(rows, year, month, today) {
  const active = new Set(
    (Array.isArray(rows) ? rows : [])
      .filter((r) => r && Number(r.count) > 0)
      .map((r) => String(r.date)),
  );
  const todayKey = today || new Date().toISOString().slice(0, 10);

  const total = daysInMonth(year, month);
  const offset = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=周日
  const cells = Math.ceil((offset + total) / 7) * 7;

  const weeks = [];
  let activeDays = 0;
  for (let i = 0; i < cells; i++) {
    const dayNum = i - offset + 1;
    // 首行/末行的补位格：借用上/下月的日期（只为了排版，不参与统计）
    let cellYear = year;
    let cellMonth = month;
    let cellDay = dayNum;
    let inMonth = true;
    if (dayNum < 1) {
      inMonth = false;
      cellMonth = month - 1;
      if (cellMonth < 1) {
        cellMonth = 12;
        cellYear -= 1;
      }
      cellDay = daysInMonth(cellYear, cellMonth) + dayNum;
    } else if (dayNum > total) {
      inMonth = false;
      cellMonth = month + 1;
      if (cellMonth > 12) {
        cellMonth = 1;
        cellYear += 1;
      }
      cellDay = dayNum - total;
    }

    const key = dateKey(cellYear, cellMonth, cellDay);
    const hasActivity = active.has(key);
    if (inMonth && hasActivity) activeDays += 1;
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push({
      day: cellDay,
      inMonth,
      hasActivity,
      isToday: inMonth && key === todayKey,
    });
  }
  return { weeks, activeDays };
}

/** 往前/后挪一个月（跨年自动进位），返回 {year, month} */
function shiftMonth(year, month, delta) {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** 两个年月的大小比较：a<b 返回负数 */
function compareMonth(a, b) {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

module.exports = { buildMonthGrid, shiftMonth, compareMonth, WEEKDAYS };
