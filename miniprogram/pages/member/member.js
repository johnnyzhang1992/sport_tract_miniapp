const api = require('../../services/api');
const storage = require('../../services/storage');
const { setAdFreeUntil } = require('../../utils/ad-free');
const { payForMember } = require('../../utils/member-pay');
const { buildPlanCards, payVisible } = require('../../utils/member-view');
const { compareVersion, MIN_IOS_CLIENT } = require('../../utils/compare-version');
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
    selectedKey: '', // 当前选中的套餐（底部开通按它下单）
    heroPerks: [], // 页头卡面上的权益行：跟随选中套餐的服务端 perkLines
    heroTitle: '', // 页头标题：有状态行用状态行，否则用选中套餐名（都来自服务端）
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

  /** 下拉刷新：静默重拉，保留屏上内容不闪加载态；游客直接收 spinner */
  onPullDownRefresh() {
    if (!this.data.loggedIn || this.data.loading || this._refreshing) {
      wx.stopPullDownRefresh();
      return;
    }
    this._refreshing = true;
    return this.syncData({ silent: true }).finally(() => {
      this._refreshing = false;
      wx.stopPullDownRefresh();
    });
  },

  async syncData(opts) {
    const silent = !!(opts && opts.silent);
    if (!silent) this.setData({ loading: true, failed: false });
    try {
      const d = await api.get('/member/products');
      let sys = {};
      try {
        sys = wx.getSystemInfoSync();
      } catch (e) {
        sys = {};
      }
      const cards = buildPlanCards(d && d.items);
      // 刷新时保留原选择（档位还在就继续选它），首次进页默认选第一档
      const selected = cards.find((c) => c.key === this.data.selectedKey) || cards[0] || null;
      const statusText = (d && d.statusText) || '';
      this.setData({
        loading: false,
        failed: false,
        enabled: !!(d && d.enabled),
        notice: (d && d.notice) || '',
        statusText,
        cards,
        selectedKey: selected ? selected.key : '',
        heroPerks: selected ? selected.perkLines : [],
        heroTitle: statusText || (selected ? selected.name : ''),
        entitlements: (d && d.entitlements) || null,
        // iOS IAP 已在 MP 后台开通（2026-11-03）：客户端 ≥ 8.0.68（MIN_IOS_CLIENT，spec §2.1）
        // 才显示付费入口；不达标的老微信仍整块隐藏（问询/退款链路服务端已就绪）
        showPay: payVisible({
          enabled: !!(d && d.enabled),
          platform: sys.platform,
          sdkVersion: sys.SDKVersion,
          iosPayReady: sys.platform === 'ios'
            ? compareVersion(sys.version, MIN_IOS_CLIENT) >= 0
            : false,
        }),
      });
      if (d && d.entitlements && d.entitlements.adFreeUntil) setAdFreeUntil(d.entitlements.adFreeUntil);
    } catch (e) {
      if (silent) {
        // 下拉刷新失败：屏上内容仍然可用，别整页转错误态
        this.setData({ loading: false });
        wx.showToast({ title: (e && e.message) || '刷新失败', icon: 'none' });
      } else {
        this.setData({ loading: false, failed: true });
      }
    }
  },

  /** 套餐行点击：切换选中档位，页头权益行跟着换（无付费入口时只作展示） */
  onSelectPlan(e) {
    if (!this.data.showPay) return;
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.selectedKey) return;
    const plan = (this.data.cards || []).find((c) => c.key === key);
    if (!plan) return;
    this.setData({
      selectedKey: key,
      heroPerks: plan.perkLines,
      heroTitle: this.data.statusText || plan.name,
    });
  },

  async onBuy(e) {
    if (this.data.paying) return; // 同一次点击不放两个单
    const key = e.currentTarget.dataset.key || this.data.selectedKey;
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

  goOrders() {
    wx.navigateTo({ url: '/pages/member-orders/member-orders' });
  },
});
