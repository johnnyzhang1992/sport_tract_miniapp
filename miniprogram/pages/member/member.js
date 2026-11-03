const api = require('../../services/api');
const storage = require('../../services/storage');
const { setAdFreeUntil } = require('../../utils/ad-free');
const { payForMember } = require('../../utils/member-pay');
const { buildPlanCards, payVisible } = require('../../utils/member-view');
const { ensureLogin } = require('../../utils/login-gate');

/**
 * 会员中心（spec §6.1 / §8）。
 * 文案与数据全部来自 /member/products：价格、日均、权益四行、状态行、关闭态说明都不在端上拼。
 */
Page({
  data: {
    loading: true,
    failed: false,
    loggedIn: false,
    enabled: false,
    notice: '',
    statusText: '',
    cards: [],
    entitlements: null,
    showPay: false,
    paying: false,
  },

  onShow() {
    const token = storage.getToken();
    const loggedIn = !!(token && token.accessToken);
    this.setData({ loggedIn });
    if (!loggedIn) {
      this.setData({ loading: false, failed: false });
      return;
    }
    this.syncData();
  },

  async syncData() {
    this.setData({ loading: true, failed: false });
    try {
      const d = await api.get('/member/products');
      let sys = {};
      try {
        sys = wx.getSystemInfoSync();
      } catch (e) {
        sys = {};
      }
      this.setData({
        loading: false,
        enabled: !!(d && d.enabled),
        notice: (d && d.notice) || '',
        statusText: (d && d.statusText) || '',
        cards: buildPlanCards(d && d.items),
        entitlements: (d && d.entitlements) || null,
        // iOS 未开 IAP 时整块隐藏；本期 iOS 一律 false（spec §8）
        showPay: payVisible({
          enabled: !!(d && d.enabled),
          platform: sys.platform,
          sdkVersion: sys.SDKVersion,
          iosPayReady: false,
        }),
      });
      if (d && d.entitlements && d.entitlements.adFreeUntil) setAdFreeUntil(d.entitlements.adFreeUntil);
    } catch (e) {
      this.setData({ loading: false, failed: true });
    }
  },

  async onBuy(e) {
    if (this.data.paying) return; // 同一次点击不放两个单
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    let sys = {};
    try {
      sys = wx.getSystemInfoSync();
    } catch (err) {
      sys = {};
    }
    this.setData({ paying: true });
    const r = await payForMember(key, { platform: sys.platform, sdkVersion: sys.SDKVersion, version: sys.version });
    this.setData({ paying: false });

    if (r.status === 'cancelled') return;
    if (r.status === 'delivered') {
      if (r.entitlements) setAdFreeUntil(r.entitlements.adFreeUntil);
      wx.showToast({ title: '已开通', icon: 'success' });
      await this.syncData();
      return;
    }
    if (r.status === 'pending') {
      wx.showToast({ title: '支付结果确认中，稍后回来看', icon: 'none', duration: 2500 });
      return;
    }
    wx.showToast({ title: r.message, icon: 'none', duration: 2500 });
  },

  /** 游客态：触点级登录闸门（与积分页同一套） */
  async onTapGate() {
    const ok = await ensureLogin();
    if (ok) this.syncData();
  },

  onRetry() {
    this.syncData();
  },
});
