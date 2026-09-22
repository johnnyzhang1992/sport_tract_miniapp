// 足迹月历卡片（列表页日历态用）：月份标题 + 今天/‹ › 导航 + 周表头 + 日期网格 + 图例。
// 只做展示与交互转发，月份平移/矩阵生成都在 utils/footprint-calendar.js 里，便于单测。
// 事件：monthchange（{ month }，换月/回今天）、daytap（{ date }，点某天，是否选中由父级决定）。
const {
  WEEK_LABELS, currentMonth, shiftMonth, monthLabel, toCountMap, buildMonthGrid, todayStr,
} = require('../../utils/footprint-calendar.js');

Component({
  properties: {
    month: { type: String, value: '' }, // YYYY-MM
    days: { type: Array, value: [] }, // 接口 /footprint-records/calendar 的 days（全量，不在本月内的自然落不到格子上）
    selected: { type: String, value: '' }, // 已选日期 YYYY-MM-DD，'' = 未选
  },
  data: {
    weekLabels: WEEK_LABELS,
    cells: [],
    label: '',
    canGoNext: false,
  },
  observers: {
    'month, days, selected': function (month) {
      if (!month) return;
      const cur = currentMonth();
      this.setData({
        label: monthLabel(month),
        cells: buildMonthGrid(month, toCountMap(this.data.days), { today: todayStr(), selected: this.data.selected }),
        canGoNext: month < cur, // 未来月份没有数据，不给往前翻
      });
    },
  },
  methods: {
    onPrev() {
      this.triggerEvent('monthchange', { month: shiftMonth(this.data.month, -1) });
    },
    onNext() {
      if (this.data.canGoNext) this.triggerEvent('monthchange', { month: shiftMonth(this.data.month, 1) });
    },
    onToday() {
      this.triggerEvent('monthchange', { month: currentMonth(), today: true });
    },
    onDayTap(e) {
      const date = e.currentTarget.dataset.date;
      if (!date) return; // 补白格不带 date，点空白无反应
      this.triggerEvent('daytap', { date });
    },
  },
});
