/**
 * 数据统计页（决策 F18/F19）
 * 概览（今日/本周/本月/累计）+ 近 7/30 天距离/时长趋势柱状图
 */
const api = require('../../services/api');
const { formatDuration, formatPaceParts, formatDurationStat, formatThousands } = require('../../utils/format');
const { calcDiff } = require('../../utils/diff');
const { buildTrophies } = require('../../utils/trophy');
const { buildMetricCards, buildTrendChart, ARROW_ICON } = require('../../utils/stats-metrics');
const { buildMonthGrid, shiftMonth, compareMonth, WEEKDAYS } = require('../../utils/activity-calendar');
const { bjDate } = require('../../utils/bj-date');

const DAY_MS = 86400000;

/** 当前纪录保持天数：今天达成 / 已保持 N 天（缺时间返回空串） */
function heldTextOf(startTime) {
  const t = Number(startTime);
  if (!Number.isFinite(t) || t <= 0) return '';
  const days = Math.max(0, Math.floor((Date.now() - t) / DAY_MS));
  return days === 0 ? '今天达成' : `已保持 ${days} 天`;
}

Page({
  data: {
    overview: null,
    trendType: 'week', // 距离趋势维度 week/month/week6/year
    trendTypes: [
      { value: 'week', label: '周' },
      { value: 'month', label: '月' },
      { value: 'week6', label: '6个月' },
      { value: 'year', label: '年' },
    ],
    // 运动日历（近 365 天数据摊成月历，默认当月）
    calWeekdays: WEEKDAYS,
    calYear: 0,
    calMonth: 0,
    calTitle: '',
    calWeeks: [],
    calCaption: '',
    calPrevDisabled: true,
    calNextDisabled: true,
    // 运动趋势：五张变化卡（近 30 天 vs 前 30 天）+ 点卡开半屏看柱状图
    metricCards: [],
    sheetMetric: 'distance', // 半屏当前指标：distance/duration/count/pace/calories
    sheetTrend: null, // { title, unit, note, data }（柱状图所需全在这里）
    trendActivityType: '', // 趋势按运动类型筛选（'' = 全部）
    trendActivityTypes: [{ value: '', label: '全部' }],
    compare: { week: null, month: null }, // 本周 vs 上周、本月 vs 上月（距离 ±%）
    loading: true,
    best: null, // 个人最佳纪录
    trophies: [], // 里程碑奖杯墙（1K/5K/10K/半马/全马）
    percentile: null, // 累计距离全站分位（仅全站 ≥2 人时展示）
    typeCount: 0, // 有记录的运动类型数（累计卡）
    provinceCount: null, // 点亮省份数（由 lit-map 组件加载后回传，保持同一口径）
    typeSummary: [], // 分类型汇总（各类型总距离/总时长/次数）
    sheetVisible: false, // 半屏弹窗：全部纪录 / 奖杯详情
    sheetType: 'best', // best | trophy
  },

  onShow() {
    this.loadAll();
  },

  onPullDownRefresh() {
    // 点亮地图是分包异步组件：占位期 selectComponent 拿到 null，跳过即可（它 ready 时会自己拉）
    const lit = this.selectComponent('#litMap');
    const tasks = [this.loadAll()];
    if (lit) tasks.push(lit.load());
    Promise.all(tasks).finally(() => wx.stopPullDownRefresh());
  },

  async loadAll() {
    const app = getApp();
    // 已注册用户（本地有 token）静默恢复登录；游客不自动登录
    if (app.hasSession() && !app.globalData.loggedIn) {
      try {
        await app.login();
      } catch (e) {
        console.warn('静默登录失败', e);
      }
    }
    if (!app.globalData.loggedIn) return;
    try {
      this.setData({ loading: true });
      const [overview, trend, best, percentile, daily] = await Promise.all([
        api.get('/stats/overview'),
        api.get(`/stats/trend${this.trendQuery()}`),
        api.get('/stats/best').catch(() => null),
        api.get('/stats/percentile').catch(() => null),
        // 五张卡固定「全部类型」：这个 365 天序列不带 activityType，半屏里的类型筛选不影响卡片
        api.get('/stats/trend?days=365').catch(() => null),
      ]);
      this._dailyRows = daily && Array.isArray(daily.data) ? daily.data : [];
      const decorated = this.decorateOverview(overview);
      const typeSummary = this.decorateTypeSummary(overview.total && overview.total.byType);
      this._trendRows = trend.data;
      this.setData({
        overview: decorated,
        metricCards: daily ? buildMetricCards(daily.data) : [],
        ...this.applyCalendar(this.data.calYear || this.currentMonth().year, this.data.calMonth || this.currentMonth().month),
        compare: {
          week: this.decorateCompare(calcDiff(overview.week.distance || 0, overview.prevWeek ? overview.prevWeek.distance : 0), '上周'),
          month: this.decorateCompare(calcDiff(overview.month.distance || 0, overview.prevMonth ? overview.prevMonth.distance : 0), '上月'),
        },
        best: this.decorateBest(best),
        trophies: this.decorateTrophies(best),
        percentile: this.decoratePercentile(percentile),
        typeCount: typeSummary.length,
        typeSummary,
        trendActivityTypes: [
          { value: '', label: '全部' },
          ...typeSummary.map((r) => ({ value: r.type, label: r.typeLabel })),
        ],
      });
      // 缓存原始 best 数据（记录页打破纪录提示用）
      if (best) {
        const { setBestCache } = require('../../services/storage');
        const app = getApp();
        setBestCache(app.globalData.user ? app.globalData.user.id : '', best);
      }
    } catch (e) {
      console.error('加载统计失败', e);
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 点亮地图组件加载完成：把省份数回填到顶部累计卡（与地图同一口径） */
  onLitMapLoaded(e) {
    const n = Number(e && e.detail && e.detail.provinceCount);
    this.setData({ provinceCount: Number.isFinite(n) ? n : 0 });
  },

  /** 趋势请求 query：窗口 + 可选运动类型 */
  trendQuery() {
    return `?type=${this.data.trendType}${this.activityTypeQuery()}`;
  },

  activityTypeQuery() {
    const t = this.data.trendActivityType;
    return t ? `&activityType=${encodeURIComponent(t)}` : '';
  },

  /** 趋势窗口/类型切换：只重拉趋势与近一年日均，不整页重载 */
  async loadTrend() {
    const seq = (this._trendSeq = (this._trendSeq || 0) + 1);
    try {
      const [trend, daily] = await Promise.all([
        api.get(`/stats/trend${this.trendQuery()}`),
        api.get('/stats/trend?days=365'), // 同上：卡片口径不跟半屏的类型筛选走
      ]);
      if (seq !== this._trendSeq) return; // 快速切换时丢弃过期响应
      this._trendRows = trend.data;
      this._dailyRows = daily && Array.isArray(daily.data) ? daily.data : [];
      const patch = {
        metricCards: buildMetricCards(daily.data),
        ...this.applyCalendar(this.data.calYear, this.data.calMonth),
      };
      if (this.data.sheetVisible && this.data.sheetType === 'trend') {
        Object.assign(patch, this.buildSheetTrend(this.data.sheetMetric));
      }
      this.setData(patch);
    } catch (e) {
      console.error('加载趋势失败', e);
    }
  },

  /** 当前月（东八区）：日历默认停在这里，也是「下一月」箭头的上限 */
  currentMonth() {
    const d = bjDate(Date.now());
    return { year: Number(String(d).slice(0, 4)), month: Number(String(d).slice(5, 7)) };
  },

  /** 近 365 天里最早能翻到的月份（再往前没有数据） */
  oldestMonth() {
    const rows = this._dailyRows || [];
    if (!rows.length) return this.currentMonth();
    const d = String(rows[0].date || '');
    return { year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)) };
  },

  /** 摊当月格子：数据源是近 365 天的每日 count；翻月只是换 year/month，不再请求 */
  applyCalendar(year, month) {
    const rows = this._dailyRows || [];
    const grid = buildMonthGrid(rows, year, month, bjDate(Date.now()));
    // 最早那个月只有部分天数在 365 天窗口里，直接报「N 天」会像「只运动了 N 天」
    const firstDate = rows.length ? String(rows[0].date) : '';
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const partialFrom = firstDate && monthStart < firstDate ? `（${firstDate.slice(5).replace('-', '/')} 起）` : '';
    return {
      calYear: year,
      calMonth: month,
      calTitle: `${year} 年 ${month} 月`,
      calWeeks: grid.weeks,
      calCaption: `${month} 月累计运动 ${grid.activeDays} 天${partialFrom}`,
      calPrevDisabled: compareMonth({ year, month }, this.oldestMonth()) <= 0,
      calNextDisabled: compareMonth({ year, month }, this.currentMonth()) >= 0,
    };
  },

  onCalPrev() {
    if (this.data.calPrevDisabled) return;
    const { year, month } = shiftMonth(this.data.calYear, this.data.calMonth, -1);
    this.setData(this.applyCalendar(year, month));
  },

  onCalNext() {
    if (this.data.calNextDisabled) return;
    const { year, month } = shiftMonth(this.data.calYear, this.data.calMonth, 1);
    this.setData(this.applyCalendar(year, month));
  },

  /** 周/本月对比：与趋势卡同一套箭头图标与「涨跌 + 比谁」文案（新增/持平不接后缀） */
  decorateCompare(c, label) {
    if (!c) return null;
    const plain = c.text === '新增' || c.text === '—' || c.text === '持平';
    return { ...c, arrowIcon: ARROW_ICON[c.cls] || '', diffText: plain ? c.text : `${c.text} 较${label}` };
  },

  /** 半屏趋势图：数据/单位/标题都由纯函数给，页面只负责把结果塞进 data */
  buildSheetTrend(metric) {
    const chart = buildTrendChart(this._trendRows || [], metric, this.data.trendType);
    return chart ? { sheetTrend: chart } : {};
  },

  /** 奖杯墙：固定五项，未达成的置灰；图标取该项成绩对应的运动类型 */
  decorateTrophies(best) {
    const TYPE_META = require('../../config/index').ACTIVITY_TYPES || [];
    const iconOf = (t) => (TYPE_META.find((x) => x.type === t) || {}).iconImg || '';
    const labelOf = (t) => (TYPE_META.find((x) => x.type === t) || {}).label || t;
    return buildTrophies(best && best.milestones).map((t) => ({
      ...t,
      icon: t.type ? iconOf(t.type) : '',
      value: t.unlocked ? formatDuration(t.sec) : '未解锁',
      typeLabel: t.type ? labelOf(t.type) : '',
      dateText: t.unlocked ? (bjDate(t.startTime) || '').replace(/-/g, '/') : '',
      heldText: t.unlocked ? (t.heldDays === 0 ? '今天达成' : `已保持 ${t.heldDays} 天`) : '',
    }));
  },

  /** 全站分位：仅全站 ≥2 人时展示（独自一人时 0% 没有意义） */
  decoratePercentile(p) {
    if (!p || !(p.usersTotal > 1)) return null;
    return { percentile: p.percentile, usersTotal: p.usersTotal };
  },

  /** 概览数据装饰：距离转公里、时长按分钟/小时/天、大数字千分位 */
  decorateOverview(o) {
    const sec = (s) => {
      const d = formatDurationStat(s.duration);
      return {
        ...s,
        distanceKm: (s.distance / 1000).toFixed(2),
        durationText: `${d.num}${d.unit}`,
      };
    };
    return {
      week: sec(o.week),
      month: sec(o.month),
      year: sec(o.year),
      total: {
        ...sec(o.total),
        calories: Math.round(o.total.calories || 0),
        caloriesText: formatThousands(o.total.calories),
        elevationGainText: formatThousands(o.total.elevationGain),
        activeDays: o.total.activeDays || 0,
        streakCurrent: o.total.streakCurrent || 0,
        streakLongest: o.total.streakLongest || 0,
      },
    };
  },

  /** 分类型汇总：各类型总距离/总时长/次数（后端 byType 为次数降序，这里按总距离降序展示） */
  decorateTypeSummary(byType) {
    const TYPE_META = require('../../config/index').ACTIVITY_TYPES || [];
    return (byType || [])
      .slice()
      .sort((a, b) => (b.distance || 0) - (a.distance || 0))
      .map((r) => {
        const meta = TYPE_META.find((x) => x.type === r.type) || {};
        return {
          type: r.type,
          typeLabel: meta.label || r.type,
          typeIcon: meta.iconImg || '',
          count: r.count || 0,
          distanceKm: ((r.distance || 0) / 1000).toFixed(1),
          durationText: formatDuration(r.duration || 0),
        };
      });
  },

  /** 个人最佳：横滑卡片（表现分/距离PB在前、其后按类型列 4 项指标），每张卡 = 一条纪录 */
  decorateBest(b) {
    if (!b) return null;
    const { formatDuration, formatPaceParts } = require('../../utils/format');
    const { perfLevel } = require('../../utils/perf-score');
    const TYPE_META = require('../../config/index').ACTIVITY_TYPES || [];
    const iconOf = (t) => (TYPE_META.find((x) => x.type === t) || {}).iconImg || '';
    const typeLabelOf = (t) => (TYPE_META.find((x) => x.type === t) || {}).label || t;
    const cards = [];
    // 表现分（最高，按类型；社区逆向估算非官方 ITRA 分）
    (b.maxPerfScoreByType || []).forEach((r) => {
      if (!(r.perfScore > 0)) return;
      cards.push({ key: `pi${cards.length}`, id: r.id, label: '表现分', value: `${r.perfScore} ${perfLevel(r.perfScore)}`, icon: iconOf(r.type), typeLabel: typeLabelOf(r.type), heldText: heldTextOf(r.startTime) });
    });
    // 距离里程碑 PB（服务端只下发当前纪录）：5 公里 PB / 10 公里 PB …
    (b.fastestDistanceByKm || [])
      .slice()
      .sort((a, b2) => a.km - b2.km || a.type.localeCompare(b2.type))
      .forEach((r) => cards.push({ key: `pb${cards.length}`, id: r.id, label: `${r.km} 公里 PB`, value: formatDuration(r.sec), icon: iconOf(r.type), typeLabel: typeLabelOf(r.type), heldText: heldTextOf(r.startTime) }));
    // 各类型 4 项指标
    const byType = {};
    const put = (rows, label, valFn) => {
      (rows || []).forEach((r) => {
        if (!byType[r.type]) byType[r.type] = [];
        byType[r.type].push({ label, value: valFn(r), id: r.id, typeLabel: typeLabelOf(r.type), heldText: heldTextOf(r.startTime) });
      });
    };
    put(b.maxDistanceByType, '最远距离', (r) => `${(r.distance / 1000).toFixed(1)}km`);
    put(b.minPaceByType, '最快配速', (r) => (formatPaceParts(r.fastestKm) || {}).value || '—');
    put(b.maxDurationByType, '最长时长', (r) => formatDuration(r.duration));
    put(b.maxElevationByType, '最大爬升', (r) => `${r.elevationGain}m`);
    Object.keys(byType)
      .sort()
      .forEach((t) => byType[t].forEach((c) => cards.push({ key: `m${cards.length}`, ...c, icon: iconOf(t) })));
    return { bestCards: cards };
  },

  /** 趋势维度切换 */
  onTrendTypeChange(e) {
    const value = e.currentTarget.dataset.value;
    if (value === this.data.trendType) return;
    this.setData({ trendType: value });
    this.loadTrend();
  },

  /** 趋势运动类型筛选（'' = 全部） */
  onTrendActivityChange(e) {
    const value = e.currentTarget.dataset.value || '';
    if (value === this.data.trendActivityType) return;
    this.setData({ trendActivityType: value });
    this.loadTrend();
  },

  /** 最佳记录卡 → 对应轨迹详情（卡片若没有 id 则不跳） */
  goTrack(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/track-detail/track-detail?id=${id}` });
  },

  /** 互跳：运动报告（周期报告 + 海报） */
  goReport() {
    wx.navigateTo({ url: '/pages/report/report' });
  },

  /** 轨迹热图：全年运动分布（轨迹合集页的聚合视图） */
  goHeatmap() {
    wx.navigateTo({ url: '/pages/overview/overview' });
  },

  /** 半屏弹窗：全部纪录 / 奖杯详情（宫格） */
  openSheet(e) {
    const type = e.currentTarget.dataset.type === 'trophy' ? 'trophy' : 'best';
    this.setData({ sheetType: type, sheetVisible: true });
  },

  /** 运动趋势卡 → 半屏（复用页面里同一个 .sheet，sheetType 加一档 trend） */
  openTrendSheet(e) {
    const metric = e.currentTarget.dataset.key;
    const card = (this.data.metricCards || []).find((c) => c.key === metric);
    if (!card) return;
    this.setData({
      sheetMetric: metric,
      ...this.buildSheetTrend(metric),
      sheetType: 'trend',
      sheetVisible: true,
    });
  },

  closeSheet() {
    this.setData({ sheetVisible: false });
  },

  /** 弹窗内点卡片：未解锁（无 id）不跳；已解锁先关弹窗再进轨迹详情 */
  onSheetTrack(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.closeSheet();
    wx.navigateTo({ url: `/pages/track-detail/track-detail?id=${id}` });
  },

  noop() {},

  /** 分享给朋友 */
  onShareAppMessage() {
    return { title: '我的运动数据 · 个人最佳', path: '/pages/stats/stats' };
  },

  /** 分享到朋友圈 */
  onShareTimeline() {
    return { title: '我的运动数据 · 个人最佳' };
  },
});
