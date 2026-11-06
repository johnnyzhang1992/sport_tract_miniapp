/**
 * 报告页步数展示值（运动报告 / 年度报告 / 统计页最佳记录共用）。
 * 只做展示格式化，数据口径全部由 /werun/report 下发。
 * 运行：node --test test/step-report-view.test.js。
 */
const { formatCompactCn } = require('./format.js');

const ICON_DAY = '/assets/icons/lucide-footprints.png';
const ICON_MONTH = '/assets/icons/lucide-calendar-blue.png';

/** 'YYYY-MM-DD' → 'YYYY/MM/DD'（全站日期分隔符） */
function slashDate(date) {
  return String(date || '').replace(/-/g, '/');
}

/** 'YYYY-MM' → '2026年2月' */
function monthCn(month) {
  const [y, m] = String(month || '').split('-');
  return y && m ? `${y}年${Number(m)}月` : '';
}

/** 概况：总/日均/最多步数日/同步天数；无同步记录时各值保持可渲染的占位 */
function buildStepSummary(o) {
  const hasData = !!(o && o.syncedDays > 0);
  return {
    hasData,
    totalText: formatCompactCn((o && o.totalStep) || 0),
    avgText: formatCompactCn((o && o.avgStep) || 0),
    bestText: hasData ? formatCompactCn(o.bestStep) : '—',
    bestDateText: hasData && o.bestDate ? slashDate(o.bestDate) : '',
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
  if (o.bestStep > 0 && o.bestDate) {
    out.push({
      key: 'step-day',
      label: '最多步数日',
      value: `${formatCompactCn(o.bestStep)} 步`,
      sub: slashDate(o.bestDate),
      icon: ICON_DAY,
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
    });
  }
  return out;
}

module.exports = { buildStepSummary, buildStepMonths, buildStepRecords, slashDate, monthCn };
