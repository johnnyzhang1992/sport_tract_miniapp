/**
 * 数据统计页（决策 F18/F19）
 * 概览（今日/本周/本月/累计）+ 近 7/30 天距离/时长趋势柱状图
 */
const api = require('../../services/api');
const { formatDuration } = require('../../utils/format');
const { calcDiff } = require('../../utils/diff');

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
    loading: true,
    best: null, // 个人最佳纪录
    compare: [], // 周期对比 [{label, items: [{key, val, diff}]}]
  },

  onShow() {
    this.loadAll();
  },

  onPullDownRefresh() {
    this.loadAll().finally(() => wx.stopPullDownRefresh());
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
      const [overview, trend, best] = await Promise.all([
        api.get('/stats/overview'),
        api.get(`/stats/trend?type=${this.data.trendType}`),
        api.get('/stats/best').catch(() => null),
      ]);
      const decorated = this.decorateOverview(overview);
      this.setData({
        overview: decorated,
        chartData: trend.data.map((d) => ({
          label: this.trendLabel(d.date),
          value: Math.round((d.distance / 1000) * 100) / 100, // 公里
        })),
        best: this.decorateBest(best),
        compare: this.buildCompare(decorated),
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

  /** 概览数据装饰：距离转公里、时长转文本 */
  decorateOverview(o) {
    const sec = (s) => ({
      ...s,
      distanceKm: (s.distance / 1000).toFixed(2),
      durationText: formatDuration(s.duration),
    });
    return {
      today: sec(o.today),
      week: sec(o.week),
      month: sec(o.month),
      year: sec(o.year),
      total: sec(o.total),
      prevWeek: sec(o.prevWeek),
      prevMonth: sec(o.prevMonth),
    };
  },

  /** 周期对比行：本周vs上周 / 本月vs上月（次数/距离/时长） */
  buildCompare(o) {
    const rows = (cur, prev, label) => ({
      label,
      items: [
        { key: 'count', val: String(cur.count), diff: calcDiff(cur.count, prev.count) },
        { key: 'distance', val: `${(cur.distance / 1000).toFixed(1)}km`, diff: calcDiff(cur.distance, prev.distance) },
        { key: 'duration', val: formatDuration(cur.duration), diff: calcDiff(cur.duration, prev.duration) },
      ],
    });
    return [rows(o.week, o.prevWeek, '本周 vs 上周'), rows(o.month, o.prevMonth, '本月 vs 上月')];
  },

  /** 个人最佳装饰：距离/配速/时长格式化 + 日期 */
  decorateBest(b) {
    if (!b) return null;
    const { formatDuration, formatPace } = require('../../utils/format');
    const TYPE_META = require('../../config/index').ACTIVITY_TYPES || [];
    const typeMeta = (t) => TYPE_META.find((x) => x.type === t) || {};
    const dayText = (t) => {
      const d = new Date(t);
      return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    };
    // 合并为一张表格：行=运动类型，列=最远距离/最快配速/最长时长/最大爬升
    const rowsMap = {};
    const put = (rows, key, valFn) => {
      (rows || []).forEach((r) => {
        if (!rowsMap[r.type]) {
          const meta = typeMeta(r.type);
          rowsMap[r.type] = { type: r.type, typeLabel: meta.label || r.type, typeIcon: meta.iconImg || '', maxDistance: '—', minPace: '—', maxDuration: '—', maxElevation: '—' };
        }
        rowsMap[r.type][key] = valFn(r);
      });
    };
    put(b.maxDistanceByType, 'maxDistance', (r) => `${(r.distance / 1000).toFixed(1)}km`);
    put(b.minPaceByType, 'minPace', (r) => formatPace(r.fastestKm ?? r.avgPace));
    put(b.maxDurationByType, 'maxDuration', (r) => formatDuration(r.duration));
    put(b.maxElevationByType, 'maxElevation', (r) => `${r.elevationGain}m`);
    const bestTable = Object.keys(rowsMap).sort().map((t) => rowsMap[t]);
    return { bestTable };
  },

  /** 趋势维度切换 */
  onTrendTypeChange(e) {
    const value = e.currentTarget.dataset.value;
    if (value === this.data.trendType) return;
    this.setData({ trendType: value });
    this.loadAll();
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

  /** 分享给朋友 */
  onShareAppMessage() {
    return { title: '我的运动数据 · 个人最佳', path: '/pages/stats/stats' };
  },

  /** 分享到朋友圈 */
  onShareTimeline() {
    return { title: '我的运动数据 · 个人最佳' };
  },
});
