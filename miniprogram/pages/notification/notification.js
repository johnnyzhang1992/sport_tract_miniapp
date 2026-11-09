/** 系统通知详情：纯文本正文，保留换行；登录用户打开即记已读 */
const api = require('../../services/api');
const loading = require('../../utils/loading');
const { bjDateTime } = require('../../utils/bj-date');
const { setPageTitle } = require('../../utils/nav-title');

Page({
  data: {
    notice: null,
    loading: true,
    failed: false,
    notFound: false, // 404：文案「通知不存在」+ 返回（其余失败可重试）
  },

  onLoad(options) {
    this._id = options.id || '';
    if (!this._id) {
      this.setData({ loading: false, failed: true, notFound: true });
      return;
    }
    this.fetch();
  },

  async fetch(opts = {}) {
    const silent = opts.silent === true; // 下拉刷新不弹遮罩，保持页面内容
    if (!silent) loading.show('加载中…');
    try {
      const data = await api.get(`/notifications/${this._id}`);
      const categoryText = data.categoryText || '系统通知';
      this.setData({
        notice: {
          id: data.id,
          title: data.title,
          content: data.content,
          categoryText,
          dateText: this.fmtDate(data.publishedAt),
        },
        loading: false,
        failed: false,
        notFound: false,
      });
      setPageTitle(this, categoryText);
      this.markRead();
    } catch (e) {
      this.setData({ loading: false, failed: true, notFound: e && e.statusCode === 404 });
    } finally {
      if (!silent) loading.hide();
    }
  },

  /** 下拉刷新：静默重拉；失败不打断当前内容 */
  onPullDownRefresh() {
    this.fetch({ silent: true })
      .catch(() => wx.showToast({ title: '刷新失败', icon: 'none' }))
      .finally(() => wx.stopPullDownRefresh());
  },

  /** 打开即已读：失败静默（下次进来仍是未读，不打扰阅读） */
  async markRead() {
    if (!getApp().hasSession()) return;
    try {
      await api.post(`/notifications/${this._id}/read`, {});
      getApp().globalData.notificationDirty = true;
    } catch (e) {
      // 静默
    }
  },

  fmtDate(ts) {
    return bjDateTime(ts);
  },

  onRetry() {
    this.setData({ loading: true, failed: false, notFound: false });
    this.fetch();
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },
});
