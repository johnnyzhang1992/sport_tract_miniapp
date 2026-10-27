/**
 * 兑换记录页（pages/points-exchanges/points-exchanges）
 *
 * - 只读 GET /points/exchanges（按兑换时间倒序），状态取服务端推导值；
 *   服务端已把「卡仍 unused 但过了有效期」推导成 expired，页面再兜一层；
 * - 状态映射 unused → 未使用 / used → 已使用 / 其余（含 expired 与未知值）→ 已过期；
 * - 本页不再提供补签入口（Task 8 收口，spec §7）：逐日补签的唯一入口是积分页的补签胶囊，
 *   此前行内「去补签」只看持卡状态、不看 cells，会邀请用户进补不成的流程；已用的卡仍显示补了哪天（MM.DD）；
 * - 实物批次加了「我的订单」区（GET /points/orders）：两个接口各自降级 ——
 *   订单拉不到只把订单区置空并提示，不能连兑换记录一起白屏（首页日历就是这么消失过的）；
 * - 登录闸门走触点级：进页不弹登录、游客不发请求，点引导才 ensureLogin。
 */
const api = require('../../services/api');
const { ensureLogin, waitSession } = require('../../utils/login-gate');
const { bjDate, bjDateTime } = require('../../utils/bj-date');
const { formatThousands } = require('../../utils/format');
const { md } = require('../../utils/points-view');

const STATUS_TEXT = { unused: '未使用', used: '已使用', expired: '已过期' };
/** 订单状态兜底文案（正常由服务端 statusText 下发，这里只兜未知值） */
const ORDER_STATUS_TEXT = { pending_ship: '待发货', shipped: '已发货', completed: '已完成' };

/** 接口时间既可能是毫秒数，也可能是 ISO 串（Fastify 会 Date → ISO） */
function toMs(v) {
  if (typeof v === 'number') return v;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? 0 : ms;
}

/** 兑现行：只做状态归一与显示格式化，不推导可补性——补签入口判据收口到积分页 cells */
function toRow(r, now) {
  const expiresAt = toMs(r.expiresAt);
  // 只有明确 unused/used 才采信；未知状态按已过期兜底，列表不能把脏数据当「未使用」渲染
  let status = r.status === 'unused' || r.status === 'used' ? r.status : 'expired';
  if (status === 'unused' && expiresAt <= now) status = 'expired';
  return {
    id: r.id,
    title: '补签卡',
    costText: `-${formatThousands(r.cost)} 积分`,
    status,
    statusText: STATUS_TEXT[status],
    timeText: bjDateTime(toMs(r.createdAt)),
    expiresText: bjDate(expiresAt),
    // 服务端下发 YYYY-MM-DD，展示走 points-view 的 md()：与积分页七格/胶囊一律 MM.DD
    usedForDateText: r.usedForDate ? md(r.usedForDate) : '',
  };
}

/** 订单行：状态文案以服务端下发为准（那是唯一口径），未知状态原样显示，不硬套三档文案 */
function toOrderRow(r) {
  const createdAt = toMs(r.createdAt);
  const shippedAt = toMs(r.shippedAt);
  const a = r.address || {};
  // 卡片一行只说一件事：时间压成 MM-DD HH:mm；同一天下单+发货时只写一次日期
  const created = bjDateTime(createdAt);
  const shortCreated = created.slice(5);
  let timeLine = `${shortCreated} 下单`;
  if (shippedAt) {
    const shipped = bjDateTime(shippedAt);
    const sameDay = shipped.slice(5, 10) === created.slice(5, 10);
    timeLine += ` · ${sameDay ? shipped.slice(11) : shipped.slice(5)} 发货`;
  }
  return {
    id: r.id,
    title: r.itemName || r.itemKey || '实物商品',
    // 金额与商品页同口径走千分位（28,900 而不是 28900）
    costText: `-${formatThousands(r.cost)} 积分`,
    status: String(r.status || ''),
    statusText: r.statusText || ORDER_STATUS_TEXT[r.status] || r.status || '未知状态',
    // 收货人只给姓名+手机，长地址会把一行撑成两行
    addrPerson: a.receiver ? `${a.receiver} ${a.phone || ''}`.trim() : '',
    trackingNo: r.trackingNo || '',
    trackingText: r.trackingNo ? `${r.trackingCompany || '物流'} ${r.trackingNo}` : '',
    timeLine,
    // 只有已发货能确认收货；待发货没有单号可确认，已完成不再给按钮
    canConfirm: r.status === 'shipped',
  };
}

Page({
  data: {
    loggedIn: false,
    loading: true,
    failed: false,
    items: [],
    /** 实物订单（倒序）；ordersFailed = 只这一栏拉挂了，兑换记录照常显示 */
    orders: [],
    ordersFailed: false,
    /** 正在提交「确认收货」的订单 id：只禁用那一行的按钮，别把整页按钮按下去 */
    confirming: '',
  },

  onLoad() {
    this.fetch();
  },

  onShow() {
    // onLoad 后紧跟的首次 onShow 不重复请求；之后每次回到本页都重拉（含在积分页补签后回来）
    if (!this.entered) {
      this.entered = true;
      return;
    }
    this.fetch();
  },

  async fetch(silent = false) {
    // 下拉刷新走静默：已有内容不闪骨架；进页/重进才给 loading
    if (!silent) this.setData({ loading: true, failed: false });
    // 冷启动直达本页时，onLaunch 的静默登录可能还没回来，先等它，别把已登录用户当游客
    if (!(await waitSession())) {
      this.setData({ loading: false, loggedIn: false });
      return;
    }
    try {
      // 两段各自 catch：订单接口挂了只影响订单栏（兑换记录是主内容，不能被连带白屏）
      const [rows, orderRows] = await Promise.all([
        api.get('/points/exchanges'),
        api.get('/points/orders').catch(() => null),
      ]);
      const now = Date.now();
      this.setData({
        loggedIn: true,
        loading: false,
        items: (rows || []).map((r) => toRow(r, now)),
        ordersFailed: orderRows === null,
        orders: (orderRows || []).map(toOrderRow),
      });
    } catch (e) {
      this.setData({ loading: false, failed: true });
    }
  },

  /** 确认收货：状态机只有 已发货 → 已完成，连点由服务端的原子更新兜住 */
  // 物流轨迹查询对个人主体小程序不开放（微信物流助手/查询组件均 48001），复制单号去快递 App 查是唯一闭环
  onCopyTracking(e) {
    const no = e.currentTarget.dataset.no;
    if (!no) return;
    wx.setClipboardData({
      data: String(no),
      success: () => {
        wx.hideToast(); // 压掉系统自带的「内容已复制」，换成点名单号的回执
        wx.showToast({ title: '单号已复制', icon: 'none' });
      },
    });
  },

  async onConfirmReceipt(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.confirming) return;
    this.setData({ confirming: id });
    try {
      await api.post(`/points/orders/${id}/confirm`, {});
      wx.showToast({ title: '已确认收货', icon: 'success' });
      await this.fetch();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '确认失败', icon: 'none' });
    } finally {
      this.setData({ confirming: '' });
    }
  },

  async onLoginTap() {
    if (await ensureLogin('登录后查看兑换记录。')) this.fetch();
  },

  onRetry() {
    return this.fetch();
  },

  /** 下拉刷新：静默重拉两个接口（订单发货状态常变，值得随手刷），失败也收起动画 */
  async onPullDownRefresh() {
    try {
      await this.fetch(true);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  goItem() {
    wx.navigateTo({ url: '/pages/points-item/points-item' });
  },
});
