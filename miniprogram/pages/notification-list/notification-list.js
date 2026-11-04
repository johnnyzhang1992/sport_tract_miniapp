/** 消息中心：分类 / 搜索 / 只看未读 / 全部已读 / 消息订阅 */
const api = require('../../services/api');
const { bjDate } = require('../../utils/bj-date');
const { ensureLogin } = require('../../utils/login-gate');

Page({
  data: {
    items: [],
    loading: true,
    failed: false,
    loggedIn: false,
    hasUnread: false,
    unreadCount: 0,
    unreadText: '',
    readingAll: false,
    // 筛选条件：q 是「已提交」的关键词，keyword 是输入框里的值
    keyword: '',
    q: '',
    category: '',
    unreadOnly: false,
    categories: [],
    emptyText: '暂无消息',
    subscribe: { visible: false, loading: false, failed: false, items: [], busy: '' },
  },

  onShow() {
    this.setData({ loggedIn: getApp().hasSession() });
    this.fetch();
  },

  onUnload() {
    this._seq = (this._seq || 0) + 1;
  },

  onPullDownRefresh() {
    this.fetch().finally(() => wx.stopPullDownRefresh());
  },

  buildUrl() {
    const parts = [];
    if (this.data.category) parts.push(`category=${encodeURIComponent(this.data.category)}`);
    if (this.data.q) parts.push(`q=${encodeURIComponent(this.data.q)}`);
    if (this.data.unreadOnly) parts.push('unread=1');
    return `/notifications${parts.length ? `?${parts.join('&')}` : ''}`;
  },

  emptyTextOf() {
    if (this.data.q) return '没有找到相关消息';
    if (this.data.unreadOnly) return '暂无未读消息';
    if (this.data.category) return '暂无该类消息';
    return '暂无消息';
  },

  async fetch() {
    // 搜索/切分类可能连续触发：只认最后一次请求，避免旧响应覆盖新结果
    const seq = (this._seq || 0) + 1;
    this._seq = seq;
    this.setData({ loading: true, failed: false });
    try {
      const res = await api.get(this.buildUrl());
      if (seq !== this._seq) return;
      const loggedIn = getApp().hasSession();
      const items = ((res && res.items) || []).map((it) => ({
        id: it.id,
        title: it.title,
        category: it.category || 'system',
        categoryText: it.categoryText || '系统通知',
        dateText: this.fmtDate(it.publishedAt),
        unread: loggedIn && !it.read,
      }));
      const unreadCount = res && res.unreadCount ? Number(res.unreadCount) || 0 : 0;
      this.setData({
        items,
        loading: false,
        loggedIn,
        categories: ((res && res.categories) || []).map((c) => ({
          key: c.key,
          label: c.label,
          unreadCount: Number(c.unreadCount) || 0,
        })),
        unreadCount,
        unreadText: unreadCount > 0 ? `${unreadCount} 条未读` : '',
        hasUnread: unreadCount > 0,
        emptyText: this.emptyTextOf(),
      });
    } catch (e) {
      if (seq !== this._seq) return;
      this.setData({ loading: false, failed: true, emptyText: this.emptyTextOf() });
    }
  },

  fmtDate(ts) {
    return bjDate(ts);
  },

  /* ---------------- 搜索 ---------------- */

  onKeywordInput(e) {
    this.setData({ keyword: (e && e.detail && e.detail.value) || '' });
  },

  onSearch() {
    const q = String(this.data.keyword || '').trim();
    this.setData({ q });
    this.fetch();
  },

  onClearKeyword() {
    this.setData({ keyword: '', q: '' });
    this.fetch();
  },

  /* ---------------- 分类 / 未读 ---------------- */

  onCategoryTap(e) {
    const key = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || '';
    if (key === this.data.category) return;
    this.setData({ category: key });
    this.fetch();
  },

  async onToggleUnread() {
    if (!getApp().hasSession()) {
      const ok = await ensureLogin('登录后查看未读消息。');
      if (!ok) return;
      this.setData({ loggedIn: true });
    }
    this.setData({ unreadOnly: !this.data.unreadOnly });
    this.fetch();
  },

  onClearFilters() {
    this.setData({ keyword: '', q: '', category: '', unreadOnly: false });
    this.fetch();
  },

  /* ---------------- 已读 ---------------- */

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

  /* ---------------- 消息订阅 ---------------- */

  async openSubscribe() {
    if (!(await ensureLogin('登录后才能订阅消息。'))) return;
    this.setData({
      loggedIn: true,
      subscribe: { ...this.data.subscribe, visible: true, loading: true, failed: false, items: [], busy: '' },
    });
    await this.loadSubscriptions();
  },

  async loadSubscriptions() {
    try {
      const res = await api.get('/notifications/subscriptions');
      this.setData({
        subscribe: {
          ...this.data.subscribe,
          items: ((res && res.items) || []),
          loading: false,
          failed: false,
        },
      });
    } catch (e) {
      this.setData({ subscribe: { ...this.data.subscribe, loading: false, failed: true } });
    }
  },

  closeSubscribe() {
    this.setData({ subscribe: { ...this.data.subscribe, visible: false } });
  },

  onSubscribeTap(e) {
    const detail = (e && e.detail) || {};
    const key = detail.key;
    const templateId = detail.templateId;
    if (!key || !templateId || this.data.subscribe.busy) return;
    if (typeof wx.requestSubscribeMessage !== 'function') {
      wx.showToast({ title: '当前微信版本不支持订阅消息', icon: 'none' });
      return;
    }
    this.setData({ subscribe: { ...this.data.subscribe, busy: key } });
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success: async (res) => {
        if (!res || res[templateId] !== 'accept') {
          this.setData({ subscribe: { ...this.data.subscribe, busy: '' } });
          wx.showToast({ title: '未订阅', icon: 'none' });
          return;
        }
        try {
          await api.post('/notifications/subscriptions/grant', { key, scene: 'message_center' });
          const items = this.data.subscribe.items.map((it) =>
            it.key === key ? { ...it, subscribed: true } : it);
          this.setData({ subscribe: { ...this.data.subscribe, items, busy: '' } });
          wx.showToast({ title: '已订阅', icon: 'success' });
        } catch (err) {
          this.setData({ subscribe: { ...this.data.subscribe, busy: '' } });
          wx.showToast({ title: (err && err.message) || '开启失败，请重试', icon: 'none' });
        }
      },
      fail: () => {
        this.setData({ subscribe: { ...this.data.subscribe, busy: '' } });
        wx.showToast({ title: '订阅未完成', icon: 'none' });
      },
    });
  },
});
