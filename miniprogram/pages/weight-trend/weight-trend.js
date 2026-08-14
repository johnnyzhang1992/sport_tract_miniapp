/**
 * 体重趋势页：折线图展示体重变化，支持 天/周/月/年 维度
 */
const api = require('../../services/api');

const RANGES = [
  { value: 'today', label: '今天' },
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
  { value: 'year', label: '今年' },
];

Page({
  data: {
    ranges: RANGES,
    activeRange: 'month',
    chartData: [],
    loading: false,
    latestWeight: null, // 最新体重（统计卡）
  },

  onLoad() {
    this.fetch();
  },

  onRangeChange(e) {
    const value = e.currentTarget.dataset.value;
    if (value === this.data.activeRange) return;
    this.setData({ activeRange: value });
    this.fetch();
  },

  async fetch() {
    const app = getApp();
    if (!app.globalData.loggedIn) {
      try {
        await app.login();
      } catch (e) {
        wx.showToast({ title: '登录失败', icon: 'none' });
        return;
      }
    }
    this.setData({ loading: true });
    try {
      const res = await api.get('/users/weight-logs', {
        range: this.data.activeRange,
      });
      const items = res.items || [];
      // 时间倒序 → 正序（折线从左到右按时间）
      const asc = items.slice().reverse();
      this.setData({
        chartData: asc.map((it) => ({
          label: this.formatDate(it.createdAt),
          value: it.weightKg,
        })),
        latestWeight: items.length ? items[0].weightKg : null,
      });
    } catch (e) {
      console.error('加载体重趋势失败', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  formatDate(ts) {
    const d = new Date(ts);
    const r = this.data.activeRange;
    if (r === 'today') {
      return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    if (r === 'week' || r === 'month') {
      return `${d.getMonth() + 1}/${d.getDate()}`;
    }
    return `${d.getMonth() + 1}/${d.getDate()}`;
  },

  /** 回资料编辑 */
  backToProfile() {
    wx.navigateBack();
  },
});
