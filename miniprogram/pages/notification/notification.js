/** 系统通知详情：纯文本正文，保留换行；登录用户打开即记已读 */
const api = require('../../services/api');
const loading = require('../../utils/loading');
const { bjDateTime } = require('../../utils/bj-date');

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

  async fetch() {
    loading.show('加载中…');
    try {
      const data = await api.get(`/notifications/${this._id}`);
      this.setData({
        notice: {
          id: data.id,
          title: data.title,
          content: data.content,
          dateText: this.fmtDate(data.publishedAt),
        },
        loading: false,
        failed: false,
        notFound: false,
      });
      this.markRead();
    } catch (e) {
      this.setData({ loading: false, failed: true, notFound: e && e.statusCode === 404 });
    } finally {
      loading.hide();
    }
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
