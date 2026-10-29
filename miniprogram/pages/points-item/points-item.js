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
const { pickItem, isMakeup, isPhysical, addressError, cleanAddress } = require('../../utils/points-item-view');
const { formatThousands } = require('../../utils/format');
const { stockTextOf, todayLeftTextOf } = require('../../utils/points-view');

/** 上次填过的收货地址存在本地，下次买实物不用重打一遍（服务端订单里也有快照，但那是别人的单读不到） */
const ADDR_KEY = 'points_addr_last';

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
    // 实物商品：多出「商品详情图」与「收货地址」两块，兑换按钮改成下单语义
    isPhysical: false,
    detailImages: [],
    heroImage: '',
    heroChar: '签',
    addr: { receiver: '', phone: '', detail: '' },
    /** 地址校验错误（点兑换时才校验，边输边报会很吵） */
    addrErr: '',
    balance: 0,
    cards: 0,
    canMakeup: false,
    busy: false,
    priceText: '',
    // 价格行（2026-10-28 hero 改版）：大字价格与库存胶囊分开给，胶囊文案与积分页共用 stockTextOf
    priceNumberText: '',
    stockText: '',
    /** 今日剩余整句：null（不限投放）/老接口缺字段 ⇒ 空串，meta 行整行不渲染（数字由服务端算） */
    todayText: '',
  },

  onLoad(query) {
    this.data.key = (query && query.key) || '';
    const saved = wx.getStorageSync(ADDR_KEY);
    if (saved && typeof saved === 'object') {
      this.data.addr = { receiver: '', phone: '', detail: '', ...saved };
    }
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

  async fetch(silent = false) {
    // 下拉刷新走静默：已有内容不闪骨架；进页/重进才给 loading
    if (!silent) this.setData({ loading: true, failed: false });
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
      this.applyTitle(item);
      this.setData({
        loggedIn: true,
        loading: false,
        item,
        isMakeup: isMakeup(item),
        isPhysical: isPhysical(item),
        // 服务端已逐张签好缩略档地址；空串是脏数据，过滤掉免得端上渲染出破图
        detailImages: (item && item.detailImages ? item.detailImages : []).filter(Boolean),
        // 头图：有商品图用图，没图用名称首字（原来写死「签」，免广告卡和实物都顶着错字）
        heroImage: item && item.imageUrl ? item.imageUrl : '',
        heroChar: item && item.name ? String(item.name).slice(0, 1) : '签',
        // 按钮文案由接口价格拼出（当前为「200 积分兑换」），避免前后端各写一份价格；
        // 千分位是精确值（价格不是统计量，实物 28900 分要说清 28,900，不能缩成 2.9万）
        priceText: item ? `${formatThousands(item.price)} 积分兑换` : '',
        // 价格行的数字与底部按钮同源同口径（千分位精确值，不缩成 2.9万）
        priceNumberText: item ? formatThousands(item.price) : '',
        // 库存胶囊复用积分页那一份口径：null=不限量、限量给剩余数、老接口缺字段则整颗胶囊不出现
        stockText: item ? stockTextOf(item.stockLeft) : '',
        // 今日剩余与积分页道具卡同一份口径（今日剩余 N 张）；null＝不限 ⇒ 空串 ⇒ 整行不出
        todayText: item ? todayLeftTextOf(item.todayLeft) : '',
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

  /** 标题跟着商品走：这一页早已不只展示补签卡，写死「补签卡」会让免广告卡/实物顶着错标题 */
  applyTitle(item) {
    wx.setNavigationBarTitle({ title: (item && item.name) || '兑换商品' });
  },
  /** 游客点「登录后兑换…」：登录成功才请求（不在进页时弹登录） */
  async onLoginTap() {
    if (await ensureLogin(this.data.isMakeup ? '登录后兑换补签卡。' : '登录后兑换。')) this.fetch();
  },

  /** 地址输入：只更新对应字段并清掉上一次的报错（边输边报很吵，点兑换时才校验） */
  onAddrInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field || !(field in this.data.addr)) return;
    this.setData({ addr: Object.assign({}, this.data.addr, { [field]: e.detail.value }), addrErr: '' });
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
    const physical = this.data.isPhysical;
    let address = null;
    if (physical) {
      // 实物必填地址（服务端也会校验，这里先拦一层，免得点下去才知道哪个格子没填）
      const err = addressError(this.data.addr);
      if (err) {
        this.setData({ addrErr: err });
        return;
      }
      address = cleanAddress(this.data.addr);
    }
    this.setData({ busy: true });
    // 每次点击都换新 requestId：同一 requestId 在服务端只会扣一次分、发一次道具
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      // 按这件商品自己的 key 兑换：补签卡是 /items/makeup_card/exchange，免广告卡是 /items/ad_free_7d/exchange
      await api.post(`/points/items/${this.data.item.key}/exchange`, { requestId, ...(address ? { address } : {}) });
      if (physical) wx.setStorageSync(ADDR_KEY, address);
      wx.showToast({ title: physical ? '已下单，等待发货' : '兑换成功', icon: 'success' });
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

  /** 下拉刷新：静默重拉商品与汇总（价格/余额/库存会变），失败也收起动画 */
  async onPullDownRefresh() {
    try {
      await this.fetch(true);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  goMakeup() {
    wx.navigateTo({ url: '/pages/points/points' });
  },

  goExchanges() {
    wx.navigateTo({ url: '/pages/points-exchanges/points-exchanges' });
  },
});
