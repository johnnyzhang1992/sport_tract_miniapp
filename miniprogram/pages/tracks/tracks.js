const api = require('../../services/api');
const { formatDuration, formatPace } = require('../../utils/format');
const config = require('../../config/index');

const PAGE_SIZE = 20;

Page({
  data: {
    filters: [{ type: '', label: '全部' }].concat(
      config.ACTIVITY_TYPES.map((t) => ({ type: t.type, label: t.label })),
    ),
    activeFilter: '',
    items: [],
    page: 1,
    hasMore: true,
    loading: false,
    initialized: false,
  },

  onShow() {
    if (!this.data.initialized) {
      this.refresh();
    }
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadMore();
    }
  },

  /** 切换类型筛选（t-tabs） */
  onTabChange(e) {
    const type = e.detail.value;
    if (type === this.data.activeFilter) return;
    this.setData({ activeFilter: type, page: 1, items: [], hasMore: true });
    this.refresh();
  },

  async refresh() {
    const app = getApp();
    if (!app.globalData.loggedIn) {
      try {
        await app.login();
      } catch (e) {
        wx.showToast({ title: '登录失败，请检查后端服务', icon: 'none' });
        return;
      }
    }
    try {
      this.setData({ loading: true, page: 1 });
      const data = await api.get('/activities', {
        page: 1,
        pageSize: PAGE_SIZE,
        type: this.data.activeFilter,
      });
      this.setData({
        items: data.items.map(this.decorate),
        hasMore: data.items.length >= PAGE_SIZE,
        initialized: true,
      });
    } catch (e) {
      console.error('加载轨迹列表失败', e);
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadMore() {
    const next = this.data.page + 1;
    try {
      this.setData({ loading: true });
      const data = await api.get('/activities', {
        page: next,
        pageSize: PAGE_SIZE,
        type: this.data.activeFilter,
      });
      this.setData({
        items: this.data.items.concat(data.items.map(this.decorate)),
        page: next,
        hasMore: data.items.length >= PAGE_SIZE,
      });
    } catch (e) {
      console.error('加载更多失败', e);
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 列表项装饰：原始聚合数据 → 展示字段 */
  decorate(item) {
    const meta = config.ACTIVITY_TYPES.find((t) => t.type === item.type) || {};
    return {
      ...item,
      icon: meta.icon || '🏃',
      label: meta.label || item.type,
      distanceKm: (item.distance / 1000).toFixed(2),
      durationText: formatDuration(item.duration),
      startTimeText: new Date(item.startTime).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      paceText: item.avgPace ? formatPace(item.avgPace) : '—',
    };
  },

  /** 进入轨迹详情 */
  onTapItem(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/track-detail/track-detail?id=${id}`,
    });
  },
});
