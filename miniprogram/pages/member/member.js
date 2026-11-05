const api = require('../../services/api');
const storage = require('../../services/storage');
const { setAdFreeUntil } = require('../../utils/ad-free');
const { payForMember } = require('../../utils/member-pay');
const { buildPlanCards, bestValueKey, splitStatusText, buildPerkItems, payVisible } = require('../../utils/member-view');
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
    operator: false, // 站内运营者（role=admin）：显示运营中心入口
    photoQuota: null, // 照片额度用量（used/limit/remaining），来自 /member/products 的权益读数
    selectedPriceText: '', // 底部按钮上的实付价：跟随选中套餐的服务端 priceText
    heroPerks: [], // 页头权益文案：跟随选中套餐的服务端 perkLines
    heroPerksView: [], // 权益 + 图标（图标由本地按关键词映射）
    heroTitle: '', // 页头大标题：状态句前半段，否则用选中套餐名（都来自服务端）
    heroSub: '', // 页头副标题：状态句后半段（有效期）
    bestValueKey: '', // 「日均最低」角标落在哪一档（本地比 priceFen/durationDays，不产出金额）
    entitlements: null,
    showPay: false,
    paying: false,
    reminder: { enabled: false, templateId: '', daysBefore: 3, subscribed: false },
    reminderBusy: false,
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
      const status = splitStatusText(statusText);
      this.setData({
        loading: false,
        failed: false,
        enabled: !!(d && d.enabled),
        operator: !!(d && d.operator), // 站内运营者（role=admin）：显示运营中心入口
        notice: (d && d.notice) || '',
        statusText,
        cards,
        selectedKey: selected ? selected.key : '',
        selectedPriceText: selected ? selected.priceText : '',
        heroPerks: selected ? selected.perkLines : [],
        heroPerksView: buildPerkItems(selected ? selected.perkLines : []),
        heroTitle: status.title || (selected ? selected.name : ''),
        heroSub: status.sub,
        bestValueKey: bestValueKey(cards),
        entitlements: (d && d.entitlements) || null,
        photoQuota: (d && d.photoQuota) || null, // 与会员权益同一个请求下发（服务端单一读数）
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
      try {
        const rem = await api.get('/member/reminder');
        if (rem) this.setData({ reminder: rem });
      } catch (err) {
        // 提醒是附加能力：拉不到就不展示入口，不影响会员主流程
      }
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
    const status = splitStatusText(this.data.statusText);
    this.setData({
      selectedKey: key,
      selectedPriceText: plan.priceText,
      heroPerks: plan.perkLines,
      heroPerksView: buildPerkItems(plan.perkLines),
      heroTitle: status.title || plan.name,
      heroSub: status.sub,
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
      this.maybeOfferReminder();
      return;
    }
    if (r.status === 'pending') {
      wx.showToast({ title: '支付结果确认中，稍后回来看', icon: 'none', duration: 2500 });
      return;
    }
    wx.showToast({ title: r.message, icon: 'none', duration: 2500 });
  },

  /** 支付成功后顺手问一次到期提醒（订阅必须由用户点允许；拒绝不反复打扰） */
  maybeOfferReminder() {
    const r = this.data.reminder || {};
    if (!r.enabled || !r.templateId || r.subscribed) return;
    wx.showModal({
      title: '开启到期提醒',
      content: `到期前 ${r.daysBefore} 天通过服务通知提醒你续费，是否开启？`,
      confirmText: '开启',
      cancelText: '暂不',
      success: (res) => {
        if (res.confirm) this.onEnableReminder();
      },
    });
  },

  /** 点「开启」：微信弹订阅授权；accept 才上报额度，拒绝/失败不动数据 */
  onEnableReminder() {
    const r = this.data.reminder || {};
    if (this.data.reminderBusy) return;
    if (!r.enabled || !r.templateId) {
      wx.showToast({ title: '到期提醒暂未开放', icon: 'none' });
      return;
    }
    if (typeof wx.requestSubscribeMessage !== 'function') {
      wx.showToast({ title: '当前微信版本不支持订阅消息', icon: 'none' });
      return;
    }
    this.setData({ reminderBusy: true });
    wx.requestSubscribeMessage({
      tmplIds: [r.templateId],
      success: async (res) => {
        const status = res && res[r.templateId];
        if (status !== 'accept') {
          this.setData({ reminderBusy: false });
          wx.showToast({ title: '未开启，可稍后再试', icon: 'none' });
          return;
        }
        try {
          await api.post('/member/reminder/grant', { scene: 'member_center' });
          this.setData({ 'reminder.subscribed': true });
          wx.showToast({ title: '已开启到期提醒', icon: 'success' });
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '开启失败，请重试', icon: 'none' });
        } finally {
          this.setData({ reminderBusy: false });
        }
      },
      fail: () => {
        this.setData({ reminderBusy: false });
        wx.showToast({ title: '微信订阅未完成', icon: 'none' });
      },
    });
  },

  /** 游客态：触点级登录闸门（与积分页同一套） */
  async onTapGate() {
    const ok = await ensureLogin();
    if (ok) this.syncData();
  },

  onRetry() {
    this.syncData();
  },

  goPhotos() {
    wx.navigateTo({ url: '/pages/photos/photos' });
  },

  goOperator() {
    wx.navigateTo({ url: '/pages/operator/operator' });
  },

  goOrders() {
    wx.navigateTo({ url: '/pages/member-orders/member-orders' });
  },
});
