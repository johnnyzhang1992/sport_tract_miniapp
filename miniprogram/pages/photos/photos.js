const api = require('../../services/api');
const storage = require('../../services/storage');
const { ensureLogin } = require('../../utils/login-gate');

/**
 * 照片管理：额度总览 + 按「轨迹 / 足迹」分组的照片列表 + 多选删除。
 *
 * 为什么需要这个页：额度告满（尤其会员到期 300→100 超额）时，服务端只会说「删除部分照片」，
 * 而照片散落在轨迹打点与足迹两处——用户没有一处能总览并删除。这里的删除会同步回补额度。
 * 文案与额度读数全部来自 /photos（服务端单一出口），端上只做展示与勾选。
 */
Page({
  data: {
    loading: true,
    failed: false,
    loggedIn: false,
    quota: null, // { used, limit, remaining, over, isMember }
    groups: [],
    selected: {}, // `${kind}:${id}|${url}` → true
    selectedCount: 0,
    deleting: false,
  },

  onShow() {
    const token = storage.getToken();
    const loggedIn = !!(token && token.accessToken);
    this.setData({ loggedIn });
    if (!loggedIn) {
      this.setData({ loading: false, failed: false });
      return;
    }
    this.load();
  },

  async load() {
    this.setData({ loading: this.data.groups.length === 0, failed: false });
    try {
      const d = await api.get('/photos');
      this.setData({
        loading: false,
        quota: d
          ? {
            used: d.used, limit: d.limit, remaining: d.remaining,
            over: d.over, isMember: d.isMember,
            percent: d.limit > 0 ? Math.min(100, Math.round((d.used / d.limit) * 100)) : 0,
          }
          : null,
        groups: (d && d.groups) || [],
        selected: {},
        selectedCount: 0,
      });
    } catch (e) {
      this.setData({ loading: false, failed: true });
    }
  },

  onRetry() {
    if (this.data.loggedIn) this.load();
  },

  onTapGate() {
    ensureLogin().then((ok) => {
      if (ok) this.load();
    });
  },

  /** 选中键：来源 + 分组 id + 照片 URL（同一张图挂两处也能分别删） */
  keyOf(kind, id, url) {
    return `${kind}:${id}|${url}`;
  },

  onTogglePhoto(e) {
    const { kind, id, url } = e.currentTarget.dataset;
    const key = this.keyOf(kind, id, url);
    const selected = { ...this.data.selected };
    if (selected[key]) delete selected[key];
    else selected[key] = true;
    this.setData({ selected, selectedCount: Object.keys(selected).length });
  },

  onSelectAll() {
    const all = {};
    for (const g of this.data.groups) {
      for (const p of g.photos) all[this.keyOf(g.kind, g.id, p.url)] = true;
    }
    const everySelected = Object.keys(all).length === this.data.selectedCount;
    this.setData({ selected: everySelected ? {} : all, selectedCount: everySelected ? 0 : Object.keys(all).length });
  },

  onPreview(e) {
    const { url } = e.currentTarget.dataset;
    const all = this.data.groups.flatMap((g) => g.photos.map((p) => p.url));
    wx.previewImage({ current: url, urls: all });
  },

  async onDelete() {
    if (this.data.deleting || this.data.selectedCount === 0) return;
    const keys = Object.keys(this.data.selected);
    // 按「来源 + 分组 id」聚合成 refs（服务端也是按文档聚合，一次事务一组）
    const byOwner = new Map();
    for (const key of keys) {
      const [owner, url] = key.split('|');
      const [kind, id] = owner.split(':');
      const entry = byOwner.get(owner) || { kind, id, urls: [] };
      entry.urls.push(url);
      byOwner.set(owner, entry);
    }
    const refs = [...byOwner.values()];
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '删除照片',
        content: `确定删除选中的 ${this.data.selectedCount} 张照片？删除后额度会同步回补，且不可恢复。`,
        confirmText: '删除',
        confirmColor: '#e34d59',
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      });
    });
    if (!ok) return;

    this.setData({ deleting: true });
    try {
      const r = await api.post('/photos/delete', { refs });
      wx.showToast({ title: r.deleted > 0 ? `已删除 ${r.deleted} 张` : '没有可删除的照片', icon: 'none' });
      await this.load();
    } catch (err) {
      // 服务端整句（越权/参数）原样透出，端上不自造文案
      wx.showModal({ title: '删除失败', content: (err && err.message) || '请稍后重试', showCancel: false });
    } finally {
      this.setData({ deleting: false });
    }
  },

  onPullDownRefresh() {
    if (!this.data.loggedIn) {
      wx.stopPullDownRefresh();
      return;
    }
    this.load().catch(() => {}).then(() => wx.stopPullDownRefresh());
  },
});
