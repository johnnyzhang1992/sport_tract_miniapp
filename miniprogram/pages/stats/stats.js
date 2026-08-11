/**
 * 数据统计页（决策 F18/F19）
 * 概览（今日/本周/本月/累计）+ 近 7/30 天距离/时长趋势柱状图
 */
const api = require('../../services/api');
const { formatDuration } = require('../../utils/format');

Page({
  data: {
    overview: null,
    days: 7,
    chartData: [], // 柱状图数据 [{label, value}]
    chartUnit: 'km',
    loading: true,
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
      const [overview, trend] = await Promise.all([
        api.get('/stats/overview'),
        api.get(`/stats/trend?days=${this.data.days}`),
      ]);
      this.setData({
        overview: this.decorateOverview(overview),
        chartData: trend.data.map((d) => ({
          label: d.date.slice(5), // MM-DD
          value: Math.round((d.distance / 1000) * 100) / 100, // 公里
        })),
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
      total: sec(o.total),
    };
  },

  onDaysChange(e) {
    const days = Number(e.currentTarget.dataset.days);
    if (days === this.data.days) return;
    this.setData({ days });
    this.loadAll();
  },
});
