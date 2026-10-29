/** 历史消息：已发布通知倒序；登录用户显示未读点，游客不显示 */
const api = require('../../services/api');
const { bjDate } = require('../../utils/bj-date');

Page({
  data: {
    items: [],
    loading: true,
    failed: false,
    hasUnread: false,
    unreadCount: 0,
    unreadText: '',
    readingAll: false,
  },

  onShow() {
    this.fetch();
  },

  onPullDownRefresh() {
    this.fetch().finally(() => wx.stopPullDownRefresh());
  },

  async fetch() {
    this.setData({ loading: true, failed: false });
    try {
      const res = await api.get('/notifications');
      const loggedIn = getApp().hasSession();
      const items = ((res && res.items) || []).map((it) => ({
        id: it.id,
        title: it.title,
        dateText: this.fmtDate(it.publishedAt),
        unread: loggedIn && !it.read,
      }));
      const unreadCount = res && res.unreadCount ? Number(res.unreadCount) || 0 : 0;
      this.setData({
        items,
        loading: false,
        unreadCount,
        unreadText: unreadCount > 0 ? `${unreadCount} 条未读` : '',
        hasUnread: items.some((it) => it.unread) || unreadCount > 0,
      });
    } catch (e) {
      this.setData({ loading: false, failed: true });
    }
  },

  fmtDate(ts) {
    return bjDate(ts);
  },

  // 一键全读：服务端幂等（并发撞唯一键只跳过），成功即重拉（未读点全灭）并回执
  async onReadAll() {
    if (this.data.readingAll || !this.data.hasUnread) return;
    this.setData({ readingAll: true });
    try {
      await api.post('/notifications/read-all', {});
      wx.showToast({ title: '已全部读', icon: 'success' });
      await this.fetch();
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '操作失败', icon: 'none' });
    } finally {
      this.setData({ readingAll: false });
    }
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/notification/notification?id=${id}` });
  },

  onRetry() {
    this.fetch();
  },
});
