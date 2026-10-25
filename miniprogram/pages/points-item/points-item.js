/**
 * 补签卡详情页（pages/points-item/points-item）
 *
 * - 商品与余额分别读 GET /points/items、GET /points/summary（与首页/积分页同一口径）；
 * - 兑换走 POST /points/items/makeup_card/exchange，body 带每次点击新生成的 requestId，
 *   服务端按 (userId, requestId) 幂等：连点只扣一次分、只发一张卡；
 * - 登录闸门走触点级：进页不弹登录、游客不发请求，点引导才 ensureLogin；
 * - 兑换成功后刷新卡数与余额，可去「补签昨天」或「兑换记录」。
 */
const api = require('../../services/api');
const { ensureLogin } = require('../../utils/login-gate');

Page({
  data: {
    loggedIn: false,
    loading: true,
    failed: false,
    item: null,
    balance: 0,
    cards: 0,
    busy: false,
    priceText: '',
  },

  onLoad() {
    this.fetch();
  },

  onShow() {
    // 从兑换记录/积分页返回时刷新卡数与余额；首屏 onLoad 后紧跟的 onShow 不重复请求
    if (this.data.loggedIn) this.fetch();
  },

  async fetch() {
    this.setData({ loading: true, failed: false });
    // 登录闸门走触点级：进页不自动弹登录，游客先看引导，也不发请求
    if (!getApp().globalData.loggedIn) {
      this.setData({ loading: false, loggedIn: false });
      return;
    }
    try {
      const [items, summary] = await Promise.all([
        api.get('/points/items'),
        api.get('/points/summary'),
      ]);
      const item = (items && items[0]) || null;
      this.setData({
        loggedIn: true,
        loading: false,
        item,
        // 按钮文案由接口价格拼出（当前为「200 积分兑换」），避免前后端各写一份价格
        priceText: item ? `${item.price} 积分兑换` : '',
        balance: (summary && summary.balance) || 0,
        cards: (summary && summary.signin && summary.signin.cards) || 0,
      });
    } catch (e) {
      this.setData({ loading: false, failed: true });
    }
  },

  /** 游客点「登录后兑换补签卡」：登录成功才请求（不在进页时弹登录） */
  async onLoginTap() {
    if (await ensureLogin('登录后兑换补签卡。')) this.fetch();
  },

  async onExchange() {
    if (this.data.busy || !this.data.item) return;
    if (this.data.balance < this.data.item.price) {
      wx.showToast({
        title: `积分不足（当前 ${this.data.balance}，需要 ${this.data.item.price}）`,
        icon: 'none',
      });
      return;
    }
    this.setData({ busy: true });
    // 每次点击都换新 requestId：同一 requestId 在服务端只会扣一次分、发一张卡
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      await api.post('/points/items/makeup_card/exchange', { requestId });
      wx.showToast({ title: '兑换成功', icon: 'success' });
      // 等刷新落地再清 busy，避免卡数/余额还是旧值时按钮先恢复可点
      await this.fetch();
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '兑换失败', icon: 'none' });
    } finally {
      this.setData({ busy: false });
    }
  },

  onRetry() {
    return this.fetch();
  },

  goMakeup() {
    wx.navigateTo({ url: '/pages/points/points' });
  },

  goExchanges() {
    wx.navigateTo({ url: '/pages/points-exchanges/points-exchanges' });
  },
});
