const api = require('../../services/api');
const storage = require('../../services/storage');
const { repayForMember } = require('../../utils/member-pay');
const { ensureLogin } = require('../../utils/login-gate');

// 退款原因（微信枚举 1-5；code 发服务端，服务端再校验；文案端上展示用）
const REASONS = [
  { code: '1', label: '产品问题，影响使用或效果不佳' },
  { code: '2', label: '售后问题，无法满足需求' },
  { code: '3', label: '不想要了（用户主动退款）' },
  { code: '4', label: '价格问题' },
  { code: '5', label: '其他原因' },
];
const fenToYuanText = (fen) => {
  const n = Number(fen);
  if (!Number.isFinite(n) || n <= 0) return '0';
  const y = n / 100;
  return Number.isInteger(y) ? String(y) : String(Number(y.toFixed(2)));
};

/**
 * 订单与退款（我的订单）：全状态列表 + 待支付继续支付/取消 + 已生效自助退款。
 * 动作旗标（canPay/canCancel/canRefund）由服务端裁定，端上只按旗标渲染按钮；
 * 退款金额由服务端按剩余天数折算，端上不出现金额计算。
 */
Page({
  data: {
    loading: true,
    failed: false,
    loggedIn: false,
    items: [],
    notice: '',
    reasonLabels: REASONS.map((r) => r.label),
    expanded: '', // 当前展开退款面板的 outTradeNo
    reasonIndex: -1,
    note: '',
    busy: '',
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

  /** 下拉刷新：静默重拉，保留列表与展开面板；游客直接收 spinner */
  onPullDownRefresh() {
    if (!this.data.loggedIn || this.data.loading || this._refreshing) {
      wx.stopPullDownRefresh();
      return;
    }
    this._refreshing = true;
    return this.load({ silent: true }).finally(() => {
      this._refreshing = false;
      wx.stopPullDownRefresh();
    });
  },

  async load(opts) {
    const silent = !!(opts && opts.silent);
    if (!silent) this.setData({ loading: true, failed: false });
    try {
      const d = await api.get('/member/orders');
      const items = ((d && d.items) || []).map((i) => ({
        ...i,
        priceText: fenToYuanText(i.priceFen),
        refundedText: i.refundedFen > 0 ? fenToYuanText(i.refundedFen) : '',
      }));
      this.setData({ loading: false, failed: false, items, notice: (d && d.notice) || '' });
    } catch (e) {
      if (silent) {
        // 下拉刷新失败：列表仍可用，别整页转错误态
        this.setData({ loading: false });
        wx.showToast({ title: (e && e.message) || '刷新失败', icon: 'none' });
      } else {
        this.setData({ loading: false, failed: true });
      }
    }
  },

  onRetry() {
    if (this.data.loggedIn) this.load();
  },

  /** 游客态：触点级登录闸门（与会员页同一套） */
  onTapGate() {
    ensureLogin().then((ok) => {
      if (ok) this.load();
    });
  },

  async onPay(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.busy) return;
    let sys = {};
    try { sys = wx.getSystemInfoSync(); } catch (err) { sys = {}; }
    this.setData({ busy: `pay:${id}` });
    try {
      const r = await repayForMember(id, { platform: sys.platform, sdkVersion: sys.SDKVersion, version: sys.version });
      if (r.status === 'delivered') {
        wx.showToast({ title: '已开通', icon: 'success' });
        await this.load();
      } else if (r.status === 'pending') {
        wx.showToast({ title: '支付结果确认中，稍后回来刷新', icon: 'none', duration: 2500 });
      }
      // cancelled：用户主动取消，不提示
    } finally {
      this.setData({ busy: '' });
    }
  },

  onCancel(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.busy) return;
    wx.showModal({
      title: '取消订单',
      content: '待支付订单取消后不可恢复，确定取消？',
      success: async (m) => {
        if (!m.confirm) return;
        this.setData({ busy: `cancel:${id}` });
        try {
          await api.post(`/member/order/${id}/cancel`, {});
          wx.showToast({ title: '已取消', icon: 'success' });
          await this.load();
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '取消失败', icon: 'none' });
        } finally {
          this.setData({ busy: '' });
        }
      },
    });
  },

  toggleRefund(e) {
    const id = e.currentTarget.dataset.id;
    const next = this.data.expanded === id ? '' : id;
    this.setData({ expanded: next, reasonIndex: -1, note: '' });
  },

  onReason(e) {
    this.setData({ reasonIndex: Number(e.detail.value) });
  },

  onNote(e) {
    this.setData({ note: e.detail.value });
  },

  onSubmitRefund(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.busy) return;
    if (this.data.reasonIndex < 0) {
      wx.showToast({ title: '请选择退款原因', icon: 'none' });
      return;
    }
    const reason = REASONS[this.data.reasonIndex];
    wx.showModal({
      title: '申请退款',
      content: '退款金额按剩余天数折算，权益将立即截断至退款时刻。确定申请？',
      success: async (m) => {
        if (!m.confirm) return;
        this.setData({ busy: `refund:${id}` });
        try {
          const r = await api.post(`/member/order/${id}/refund`, { reasonCode: reason.code, note: this.data.note });
          wx.showToast({
            title: r.status === 'refunded' ? '退款完成' : '退款已发起，到账以微信通知为准',
            icon: r.status === 'refunded' ? 'success' : 'none',
            duration: 2500,
          });
          this.setData({ expanded: '' });
          await this.load();
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '退款失败', icon: 'none', duration: 2500 });
        } finally {
          this.setData({ busy: '' });
        }
      },
    });
  },

  goMember() {
    wx.navigateBack({
      fail: () => wx.navigateTo({ url: '/pages/member/member' }),
    });
  },
});
