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
      const data = await api.get('/activities', this.buildParams(1));
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
      const data = await api.get('/activities', this.buildParams(next));
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

  /** 构造查询参数：空筛选不传 type（后端 enum 校验不接受空串） */
  buildParams(page) {
    const params = { page, pageSize: PAGE_SIZE };
    if (this.data.activeFilter) {
      params.type = this.data.activeFilter;
    }
    return params;
  },

  /** 列表项装饰：原始聚合数据 → 展示字段（后端返回 _id，补 id 映射） */
  decorate(item) {
    const meta = config.ACTIVITY_TYPES.find((t) => t.type === item.type) || {};
    const start = new Date(item.startTime);
    // 时间展示：一周内显示星期几，超过一周显示年月日
    const diffDays = Math.floor((Date.now() - start.getTime()) / 86400000);
    const timeText =
      diffDays < 7
        ? ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][start.getDay()]
        : `${start.getFullYear()}/${start.getMonth() + 1}/${start.getDate()}`;
    return {
      ...item,
      id: String(item._id || item.id || ''),
      icon: meta.icon || '🏃',
      iconImg: meta.iconImg || '',
      label: meta.label || item.type,
      color: meta.color || '#2B6CF6',
      previewPoints: item.previewPoints || [],
      distanceKm: (item.distance / 1000).toFixed(2),
      durationText: formatDuration(item.duration),
      startTimeText: new Date(item.startTime).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      paceText: item.avgPace ? formatPace(item.avgPace) : '—',
      timeText,
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

  /** 左滑删除：二次确认后删除（后端会同步清理关联 OSS 照片） */
  async onDeleteTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const item = this.data.items.find((i) => i.id === id);
    const label = item ? `${item.label} · ${item.startTimeText}` : '该轨迹';
    const res = await new Promise((resolve) => {
      wx.showModal({
        title: '删除轨迹',
        content: `确定删除「${label}」吗？关联照片会同步删除，且不可恢复`,
        confirmText: '删除',
        confirmColor: '#e34d59',
        success: resolve,
        fail: () => resolve({ confirm: false }),
      });
    });
    if (!res.confirm) return;
    try {
      await api.del(`/activities/${id}`);
      this.setData({ items: this.data.items.filter((i) => i.id !== id) });
      wx.showToast({ title: '已删除', icon: 'success' });
    } catch (err) {
      console.error('删除轨迹失败', err);
      wx.showToast({ title: '删除失败，请重试', icon: 'none' });
    }
  },
});
