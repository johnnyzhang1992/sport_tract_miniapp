/**
 * 商品详情页（pages/points-item/points-item），入参 ?key= 指定展示哪件商品
 *
 * - 商品与余额分别读 GET /points/items、GET /points/summary（与首页/积分页同一口径）；
 *   按 key 从整张在架商品表里挑一件（utils/points-item-view.js#pickItem），
 *   不带 key / key 查不到都回落第一项——服务端把 makeup_card 排最前，老链接仍是补签卡；
 * - 兑换走 POST /points/items/{key}/exchange（补签卡只是其中一个实例），body 带每次点击新生成的 requestId，
 *   服务端按 (userId, requestId) 幂等：连点只扣一次分、只发一次道具；
 * - 登录闸门走触点级：进页不弹登录、游客不发请求，点引导才 ensureLogin；
 * - 兑换成功后刷新余额/卡数；补签专属块（我的补签卡、去补签、补签文案）由 isMakeup 收口，
 *   「去补签」入口还以 summary 的 cells 为准（有 state==='makeup' 的格才给），
 *   手里有卡但当下没有可补的日子不再把用户引进补不成的流程（spec §7 入口收口）。
 */
const api = require('../../services/api');
const { ensureLogin, waitSession } = require('../../utils/login-gate');
const { pickItem, isMakeup } = require('../../utils/points-item-view');

Page({
  data: {
    // onLoad 从 query.key 写入（不需要重渲染，不走 setData）
    key: '',
    loggedIn: false,
    loading: true,
    failed: false,
    item: null,
    // 游客态不发请求、拿不到商品，按老口径默认补签卡；拉到商品后由 effect 覆盖
    isMakeup: true,
    balance: 0,
    cards: 0,
    canMakeup: false,
    busy: false,
    priceText: '',
  },

  onLoad(query) {
    this.data.key = (query && query.key) || '';
    this.fetch();
  },

  onShow() {
    // onLoad 后紧跟的首次 onShow 不重复请求；之后每次回到本页都重拉（含在别处登录后回到本页）
    if (!this.entered) {
      this.entered = true;
      return;
    }
    this.fetch();
  },

  async fetch() {
    this.setData({ loading: true, failed: false });
    // 登录闸门走触点级：进页不自动弹登录，游客不发请求；冷启动直达时先等 onLaunch 那次静默登录
    if (!(await waitSession())) {
      this.setData({ loading: false, loggedIn: false });
      return;
    }
    try {
      const [items, summary] = await Promise.all([
        api.get('/points/items'),
        api.get('/points/summary'),
      ]);
      const item = pickItem(items, this.data.key);
      this.setData({
        loggedIn: true,
        loading: false,
        item,
        isMakeup: isMakeup(item),
        // 按钮文案由接口价格拼出（当前为「200 积分兑换」），避免前后端各写一份价格
        priceText: item ? `${item.price} 积分兑换` : '',
        balance: (summary && summary.balance) || 0,
        cards: (summary && summary.signin && summary.signin.cards) || 0,
        // 补签入口以服务端 cells 为准：手里有卡但当前没有可补日时，不该再给入口（判据只有 state === 'makeup'）
        canMakeup: ((summary && summary.signin && summary.signin.cells) || [])
          .some((c) => c.state === 'makeup'),
      });
    } catch (e) {
      this.setData({ loading: false, failed: true });
    }
  },

  /** 游客点「登录后兑换…」：登录成功才请求（不在进页时弹登录） */
  async onLoginTap() {
    if (await ensureLogin(this.data.isMakeup ? '登录后兑换补签卡。' : '登录后兑换。')) this.fetch();
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
    // 每次点击都换新 requestId：同一 requestId 在服务端只会扣一次分、发一次道具
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      // 按这件商品自己的 key 兑换：补签卡是 /items/makeup_card/exchange，免广告卡是 /items/ad_free_7d/exchange
      await api.post(`/points/items/${this.data.item.key}/exchange`, { requestId });
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
