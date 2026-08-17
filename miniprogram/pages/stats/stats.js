/**
 * 数据统计页（决策 F18/F19）
 * 概览（今日/本周/本月/累计）+ 近 7/30 天距离/时长趋势柱状图
 */
const api = require('../../services/api');
const { formatDuration } = require('../../utils/format');

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
  },

  onShow() {
    this.loadAll();
  },

  onPullDownRefresh() {
    this.loadAll().finally(() => wx.stopPullDownRefresh());
  },

  async loadAll() {
    const app = getApp();
    if (!app.globalData.loggedIn) {
      try {
        await app.login();
      } catch {
        wx.showToast({ title: '登录失败', icon: 'none' });
        return;
      }
    }
    try {
      this.setData({ loading: true });
      const [overview, trend, best] = await Promise.all([
        api.get('/stats/overview'),
        api.get(`/stats/trend?type=${this.data.trendType}`),
        api.get('/stats/best').catch(() => null),
      ]);
      this.setData({
        overview: this.decorateOverview(overview),
        chartData: trend.data.map((d) => ({
          label: this.trendLabel(d.date),
          value: Math.round((d.distance / 1000) * 100) / 100, // 公里
        })),
        best: this.decorateBest(best),
      });
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
    };
  },

  /** 运动报告入口 */
  goReport() {
    wx.navigateTo({ url: '/pages/report/report' });
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
    const byType = (rows, valFn, unit = '') =>
      (rows || []).map((r) => ({
        type: r.type,
        typeLabel: typeMeta(r.type).label || r.type,
        typeIcon: typeMeta(r.type).iconImg || '', // 统一图片图标（非 emoji）
        value: valFn(r),
        unit,
        date: dayText(r.startTime),
      }));
    return {
      maxDistanceByType: byType(b.maxDistanceByType, (r) => (r.distance / 1000).toFixed(1), 'km'),
      // 最快配速按类型分组（不同类型不可比）：各类型最快 1km 分段
      minPaceByType: byType(b.minPaceByType, (r) => formatPace(r.fastestKm ?? r.avgPace)),
      maxDurationByType: byType(b.maxDurationByType, (r) => formatDuration(r.duration)),
      maxElevationByType: byType(b.maxElevationByType, (r) => String(r.elevationGain), 'm'),
    };
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
});
