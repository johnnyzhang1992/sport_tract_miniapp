// 签到月历半屏：概览（连签/百分位）+ 翻月 + 整月网格 + 点格补签。
// 数据全部由页面传进来（days 来自 /points/signin/calendar），本组件不查库；
// 翻月/重试/补签/签到都只发事件，请求与落库都在页面，避免组件里再养一份状态。
const { WEEK_LABELS, shiftMonth, monthLabel, canGoNext, buildSigninMonth } = require('../../utils/signin-calendar.js');
const { currentMonth, todayStr } = require('../../utils/footprint-calendar.js');

/** 最多往前看 12 个月（含当月）：再早的月份全是空档，翻过去没有信息量 */
const LOOK_BACK_MONTHS = 12;

Component({
  properties: {
    // 属性名一律小写单词：自定义组件属性名不做 kebab→camel 转换，驼峰名在 WXML 里收不到值
    visible: { type: Boolean, value: false },
    month: { type: String, value: '' }, // YYYY-MM，由页面持有（翻月要重新取数）
    days: { type: Array, value: [] },
    streak: { type: Number, value: 0 },
    percent: { type: Number, value: 0 },
    cards: { type: Number, value: 0 },
    loading: { type: Boolean, value: false },
    failed: { type: Boolean, value: false },
    bottom: { type: Boolean, value: true }, // tab 页弹层压在 tabBar 上方时传 false
  },
  data: {
    weekLabels: WEEK_LABELS,
    cells: [],
    label: '',
    canNext: false,
    canPrev: false,
  },
  observers: {
    'visible, month, days, loading, failed': function (visible, month) {
      if (!visible || !month) return;
      const latest = currentMonth();
      this.setData({
        label: monthLabel(month),
        cells: buildSigninMonth(month, this.data.days, { today: todayStr() }),
        canNext: canGoNext(month, latest),
        canPrev: month > shiftMonth(latest, -(LOOK_BACK_MONTHS - 1)),
      });
    },
  },
  methods: {
    _shift(delta) {
      const next = shiftMonth(this.data.month, delta);
      if (next > currentMonth()) return;
      this.triggerEvent('monthchange', { month: next });
    },
    onPrev() { this._shift(-1); },
    onNext() { this._shift(1); },
    onClose() { this.triggerEvent('close'); },
    /** 兑换补签卡：落哪个商品由页面决定（组件不认识 itemKey） */
    onExchange() { this.triggerEvent('exchange'); },
    onRetry() { this.triggerEvent('retry', { month: this.data.month }); },
    onDayTap(e) {
      const { date, state } = e.currentTarget.dataset;
      if (!date) return;
      // 今天没签的格子等价于页内那颗签到按钮——弹窗打开时按钮被遮住，这里不能是死区
      if (state === 'today') {
        this.triggerEvent('signin');
        return;
      }
      // 已签与未来日没有可做的动作；漏签日（含历史月）一律交给补签接口判，端上不再自己拦
      if (state === 'signed' || state === 'future') return;
      this.triggerEvent('makeup', { dateKey: date });
    },
    noop() {},
  },
});
