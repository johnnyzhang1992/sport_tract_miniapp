/**
 * 报告页步数展示值（运动报告 / 年度报告 / 统计页最佳记录共用）。
 * 只做展示格式化，数据口径全部由 /werun/report 下发。
 * 运行：node --test test/step-report-view.test.js。
 */
const { formatCompactCn } = require('./format.js');

const ICON_DAY = '/assets/icons/lucide-footprints.png';
// 与同排其它纪录图标同色（#1f2329）：原先用 -blue 变体，在一排黑色图标里很跳（2026-11-20）
const ICON_MONTH = '/assets/icons/lucide-calendar.png';

/** 'YYYY-MM-DD' → 'YYYY/MM/DD'（全站日期分隔符） */
/** 'YYYY-MM-DD' → 该日 00:00（东八区）的时间戳；解析失败返回 0（排序时沉底） */
function dayStartOf(date) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(date || ''));
  if (!m) return 0;
  const ts = Date.parse(`${m[1]}-${m[2]}-${m[3] || '01'}T00:00:00+08:00`);
  return Number.isFinite(ts) ? ts : 0;
}

function slashDate(date) {
  return String(date || '').replace(/-/g, '/');
}

/** 'YYYY-MM-DD' → 'MM/DD'（四列一格里的日期后缀） */
function mmdd(date) {
  return String(date || '').slice(5).replace('-', '/');
}

/** 'YYYY-MM' → '2026年2月' */
function monthCn(month) {
  const [y, m] = String(month || '').split('-');
  return y && m ? `${y}年${Number(m)}月` : '';
}

/** 概况：总/日均/最多步数日/记录天数；无记录时各值保持可渲染的占位 */
function buildStepSummary(o) {
  const hasData = !!(o && o.syncedDays > 0);
  return {
    hasData,
    totalText: formatCompactCn((o && o.totalStep) || 0),
    avgText: formatCompactCn((o && o.avgStep) || 0),
    bestText: hasData ? formatCompactCn(o.bestStep) : '—',
    bestDateText: hasData && o.bestDate ? slashDate(o.bestDate) : '',
    bestDateShort: hasData && o.bestDate ? mmdd(o.bestDate) : '',
    syncedDays: (o && o.syncedDays) || 0,
  };
}

/**
 * 月趋势：style='short' → 1月（年度 12 个月）；'full' → 2026/02（跨年窗口）。
 * labelSlot 供 stat-chart 计算 X 标签留位。
 */
function buildStepMonths(months, style) {
  const list = (months || []).map((m) => {
    const month = String(m.month || '');
    const mm = Number(month.slice(5));
    return {
      label: style === 'full' ? month.replace('-', '/') : (mm ? `${mm}月` : ''),
      value: Number(m.step) || 0,
    };
  });
  return { data: list, labelSlot: style === 'full' ? 36 : 28 };
}

/** 两条步数纪录：最多步数日 / 步数最多月份（无数据返回空数组） */
function buildStepRecords(report) {
  const o = report && report.overview;
  if (!o || !(o.syncedDays > 0)) return [];
  const out = [];
  // at：可排序的时间戳（2026-11-20）。步数纪录只有日期/月份字符串，
  // 但「全部纪录」要按最近刷新倒序统一排序，所以这里补一个 epoch ms，
  // 与轨迹纪录的 startTime 同口径（东八区自然日/月的起点）。
  if (o.bestStep > 0 && o.bestDate) {
    out.push({
      key: 'step-day',
      label: '最多步数日',
      value: `${formatCompactCn(o.bestStep)} 步`,
      sub: slashDate(o.bestDate),
      icon: ICON_DAY,
      at: dayStartOf(o.bestDate),
    });
  }
  const bm = report.bestMonth;
  if (bm && bm.step > 0) {
    out.push({
      key: 'step-month',
      label: '步数最多月份',
      value: `${formatCompactCn(bm.step)} 步`,
      sub: monthCn(bm.month),
      icon: ICON_MONTH,
      at: dayStartOf(`${bm.month}-01`),
    });
  }
  return out;
}

module.exports = { buildStepSummary, buildStepMonths, buildStepRecords, slashDate, mmdd, monthCn };
