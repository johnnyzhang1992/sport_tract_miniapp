/**
 * 数据统计页（决策 F18/F19）
 * 概览（今日/本周/本月/累计）+ 近 7/30 天距离/时长趋势柱状图
 */
const api = require('../../services/api');
const { formatDuration, formatPaceParts, formatDurationStat, formatThousands } = require('../../utils/format');
const { calcDiff } = require('../../utils/diff');
const { buildTrophies } = require('../../utils/trophy');
const { buildTrendCompare } = require('../../utils/trend-compare');
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
    chartData: [], // 柱状图数据 [{label, value}]
    chartUnit: 'km',
    chartTitle: '距离趋势',
    trendMetric: 'distance', // 趋势指标：distance 距离 / duration 时长 / count 次数
    trendMetrics: [
      { value: 'distance', label: '距离' },
      { value: 'duration', label: '时长' },
      { value: 'count', label: '次数' },
    ],
    trendActivityType: '', // 趋势按运动类型筛选（'' = 全部）
    trendActivityTypes: [{ value: '', label: '全部' }],
    trendCompare: null, // 近 90 天 vs 近 365 天日均（距离）
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
      const typeQuery = this.activityTypeQuery();
      const [overview, trend, best, percentile, daily] = await Promise.all([
        api.get('/stats/overview'),
        api.get(`/stats/trend${this.trendQuery()}`),
        api.get('/stats/best').catch(() => null),
        api.get('/stats/percentile').catch(() => null),
        api.get(`/stats/trend?days=365${typeQuery}`).catch(() => null),
      ]);
      const decorated = this.decorateOverview(overview);
      const typeSummary = this.decorateTypeSummary(overview.total && overview.total.byType);
      this._trendRows = trend.data;
      this.setData({
        overview: decorated,
        ...this.buildTrendView(this.data.trendMetric),
        trendCompare: this.decorateTrendCompare(daily ? buildTrendCompare(daily.data) : null),
        compare: {
          week: calcDiff(overview.week.distance || 0, overview.prevWeek ? overview.prevWeek.distance : 0),
          month: calcDiff(overview.month.distance || 0, overview.prevMonth ? overview.prevMonth.distance : 0),
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
        api.get(`/stats/trend?days=365${this.activityTypeQuery()}`),
      ]);
      if (seq !== this._trendSeq) return; // 快速切换时丢弃过期响应
      this._trendRows = trend.data;
      this.setData({
        ...this.buildTrendView(this.data.trendMetric),
        trendCompare: this.decorateTrendCompare(buildTrendCompare(daily.data)),
      });
    } catch (e) {
      console.error('加载趋势失败', e);
    }
  },

  decorateTrendCompare(c) {
    if (!c) return null;
    const arrow = c.dir === 'up' ? '↑' : c.dir === 'down' ? '↓' : '→';
    const sign = c.diffPct > 0 ? '+' : '';
    const tip = c.dir === 'up' ? '保持这个节奏' : c.dir === 'down' ? '慢慢找回状态' : '状态稳定';
    return { ...c, arrow, diffText: `${sign}${c.diffPct}%`, tip };
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

  /** 趋势指标切换：距离（km）/ 时长（分钟）/ 次数（次），标签随窗口粒度取名 */
  onTrendMetricChange(e) {
    const metric = e.currentTarget.dataset.value;
    if (!metric || metric === this.data.trendMetric) return;
    this.setData({ trendMetric: metric, ...this.buildTrendView(metric) });
  },

  buildTrendView(metric) {
    const rows = this._trendRows || [];
    const pick = {
      distance: { unit: 'km', title: '距离趋势', map: (d) => Math.round((d.distance / 1000) * 100) / 100 },
      duration: { unit: '分钟', title: '时长趋势', map: (d) => Math.round(d.duration / 60) },
      count: { unit: '次', title: '次数趋势', map: (d) => d.count },
    }[metric] || null;
    if (!pick) return {};
    return {
      chartTitle: pick.title,
      chartUnit: pick.unit,
      chartData: rows.map((d) => ({ label: this.trendLabel(d.date), value: pick.map(d) })),
    };
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
      today: sec(o.today),
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

  /** 趋势标签：周/月 → MM-DD；6个月 → 周号；年 → M月 */
  trendLabel(date) {
    if (this.data.trendType === 'year') {
      return `${Number(date.slice(5, 7))}月`;
    }
    if (this.data.trendType === 'week6') {
      const m = date.match(/-W(\d+)/);
      return m ? `W${m[1]}` : date.slice(5);
    }
    return date.slice(5); // MM-DD
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
