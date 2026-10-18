/** 历史消息：已发布通知倒序；登录用户显示未读点，游客不显示 */
const api = require('../../services/api');
const { bjDate } = require('../../utils/bj-date');

Page({
  data: {
    items: [],
    loading: true,
    failed: false,
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
      this.setData({ items, loading: false });
    } catch (e) {
      this.setData({ loading: false, failed: true });
    }
  },

  fmtDate(ts) {
    return bjDate(ts);
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/notification/notification?id=${id}` });
  },

  onRetry() {
    this.fetch();
  },
});
