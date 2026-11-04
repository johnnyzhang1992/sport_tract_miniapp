const api = require('../../services/api');
const storage = require('../../services/storage');
const { ensureLogin } = require('../../utils/login-gate');

/**
 * 数据概览（role=admin 微信用户＝站内运营者的只读页）：
 * 今日（实时）/ 昨日（完整自然日）六项指标，聚合数字、无任何用户级明细。
 * 退款不在小程序端：Android 用户自助退 / 管理端 webAdmin 操作，iOS 用户走 App Store。
 */
Page({
  data: {
    loading: true,
    failed: false,
    loggedIn: false,
    authorized: false,
    summary: null,
  },

  onShow() {
    const token = storage.getToken();
    const loggedIn = !!(token && token.accessToken);
    this.setData({ loggedIn });
    if (!loggedIn) {
      this.setData({ loading: false, failed: false, authorized: false });
      return;
    }
    this.load();
  },

  async load() {
    this.setData({ loading: true, failed: false });
    try {
      const [me, summary] = await Promise.all([
        api.get('/operator/me'),
        api.get('/operator/stats/summary'),
      ]);
      this.setData({ loading: false, authorized: true, summary: summary || null });
    } catch (e) {
      const msg = (e && e.message) || '';
      this.setData({ loading: false, failed: true, authorized: !/仅运营者/.test(msg) });
      if (/仅运营者/.test(msg)) this.setData({ failed: false });
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

  onPullDownRefresh() {
    if (!this.data.loggedIn) {
      wx.stopPullDownRefresh();
      return;
    }
    this.load().catch(() => {}).then(() => wx.stopPullDownRefresh());
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.navigateTo({ url: '/pages/my/my' }) });
  },
});
