/**
 * 兑换记录页（pages/points-exchanges/points-exchanges）
 *
 * - 「我的卡」统一卡结构（2026-10-29 改版）：兑换 / 后台发放 / 系统赠送三来源的卡全部走
 *   GET /points/cards 一张列表——发放不落 exchange，cards 是它们唯一的用户侧出口；
 *   旧的「道具兑换记录」区（/points/exchanges）被它取代：每张兑换卡本来就有卡行，cost 也由
 *   cards 接口带出，没有理由维护两份结构。
 * - 每张卡：名称 + 右上角状态徽章 / 获得方式 / 兑换时间·发放时间 / 有效期 / 积分；
 *   状态与免广告顺延窗口全部采信服务端推导，端上不复制第二份算术；
 * - 未激活的免广告卡行内「立即激活」（POST /points/cards/:id/activate，服务端 CAS 兜连点）；
 * - 「我的订单」区（GET /points/orders）保持独立：接口挂了只降级自己的栏，不牵连卡列表；
 * - 登录闸门走触点级：进页不弹登录、游客不发请求，点引导才 ensureLogin。
 */
const api = require('../../services/api');
const { ensureLogin, waitSession } = require('../../utils/login-gate');
const { bjDate, bjDateTime } = require('../../utils/bj-date');
const { formatThousands } = require('../../utils/format');
const { md } = require('../../utils/points-view');

/** 订单状态兜底文案（正常由服务端 statusText 下发，这里只兜未知值） */
const ORDER_STATUS_TEXT = { pending_ship: '待发货', shipped: '已发货', completed: '已完成' };

/** 接口时间既可能是毫秒数，也可能是 ISO 串（Fastify 会 Date → ISO） */
function toMs(v) {
  if (typeof v === 'number') return v;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * 统一卡行：一行说清一张卡——名称、右上角徽章、获得方式、时间、有效期、积分。
 * 有效期一行按 kind × 状态给一句真话：激活类卡说清「前激活有效」，生效中直接给到期时刻。
 */
function toCardRow(r) {
  const expiresAt = toMs(r.expiresAt);
  const startAt = r.startAt ? toMs(r.startAt) : 0;
  const endAt = r.endAt ? toMs(r.endAt) : 0;
  let validText = '';
  if (r.kind === 'ad_free') {
    if (r.status === 'unused') validText = `${bjDate(expiresAt)} 前激活有效`;
    else if (r.status === 'active') validText = `生效至 ${bjDateTime(endAt)}`;
    else if (r.status === 'queued') validText = `预计 ${bjDateTime(startAt)} 生效`;
    else if (r.status === 'done') validText = '权益已用完';
    else validText = `${bjDate(expiresAt)} 已过期`;
  } else if (r.status === 'used') {
    validText = bjDate(expiresAt);
  } else if (r.status === 'expired') {
    validText = `${bjDate(expiresAt)} 已过期`;
  } else {
    validText = `${bjDate(expiresAt)} 前有效`;
  }
  // 徽标类名映射进配色体系：生效中绿 / 待生效橙单独设色，已结束与过期同灰
  const statusClass = r.status === 'active' ? 'card-status-active'
    : r.status === 'queued' ? 'card-status-queued'
    : r.status === 'done' ? 'card-status-done'
    : `status-${r.status}`;
  return {
    id: r.id,
    name: r.name || '道具卡',
    status: r.status,
    statusText: r.statusText,
    statusClass,
    // 获得方式（后台发放/系统赠送不再隐形）与随之变化的时间标签
    sourceText: r.sourceText || '兑换获得',
    timeLabel: (r.source || 'exchange') === 'exchange' ? '兑换时间' : '发放时间',
    timeText: bjDateTime(toMs(r.createdAt)),
    validText,
    usedForDateText: r.usedForDate ? md(r.usedForDate) : '',
    // 积分不显负数：兑换显示「200积分」，发放/赠送显示「0积分」（2026-10-29 用户定稿）
    costText: `${formatThousands(r.cost || 0)}积分`,
    // 只有未激活的免广告卡可激活；补签卡走积分页「补」字，过期卡激活接口也会 400
    canActivate: r.kind === 'ad_free' && r.status === 'unused',
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
    /** 我的卡（三来源全量，未使用的排最前）——本页的主列表 */
    cards: [],
    /** 实物订单（倒序）；ordersFailed = 只这一栏拉挂了，卡列表照常显示 */
    orders: [],
    ordersFailed: false,
    /** 正在激活的卡 id / 正在确认收货的订单 id：只禁用那一行的按钮 */
    activating: '',
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
      // 两段各自 catch：订单接口挂了只影响订单栏（卡列表是主内容，不能被连带白屏）
      const [cardRows, orderRows] = await Promise.all([
        api.get('/points/cards'),
        api.get('/points/orders').catch(() => null),
      ]);
      this.setData({
        loggedIn: true,
        loading: false,
        cards: (cardRows || []).map(toCardRow),
        ordersFailed: orderRows === null,
        orders: (orderRows || []).map(toOrderRow),
      });
    } catch (e) {
      this.setData({ loading: false, failed: true });
    }
  },

  /** 立即激活免广告卡：服务端 CAS 兜连点；成功回执带 adFreeUntil，直接念到期日（完整年月日） */
  async onActivateCard(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.activating) return;
    this.setData({ activating: id });
    try {
      const r = await api.post(`/points/cards/${id}/activate`, {});
      const until = r && r.adFreeUntil ? bjDate(toMs(r.adFreeUntil)) : '';
      wx.showToast({ title: until ? `已激活 · ${until} 到期` : '已激活', icon: 'none' });
      await this.fetch(true);
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '激活失败', icon: 'none' });
      await this.fetch(true); // 失败（如已被他端激活）也重拉，让行回到真实状态
    } finally {
      this.setData({ activating: '' });
    }
  },

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

  /** 确认收货：状态机只有 已发货 → 已完成，连点由服务端的原子更新兜住 */
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
