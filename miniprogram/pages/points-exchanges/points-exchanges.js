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
 * - 登录闸门走触点级：进页不弹登录、游客不发请求，点引导才 ensureLogin。
 */
const api = require('../../services/api');
const { ensureLogin, waitSession } = require('../../utils/login-gate');
const { bjDate, bjDateTime } = require('../../utils/bj-date');
const { formatThousands } = require('../../utils/format');
const { md } = require('../../utils/points-view');

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

Page({
  data: {
    loggedIn: false,
    loading: true,
    failed: false,
    /** 我的卡（三来源全量，未使用的排最前）——本页的主列表 */
    cards: [],
    /** 正在激活的卡 id：只禁用那一行的按钮 */
    activating: '',
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
      const cardRows = await api.get('/points/cards');
      this.setData({
        loggedIn: true,
        loading: false,
        cards: (cardRows || []).map(toCardRow),
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

  async onLoginTap() {
    if (await ensureLogin('登录后查看兑换记录。')) this.fetch();
  },

  onRetry() {
    return this.fetch();
  },

  /** 下拉刷新：静默重拉卡列表，失败也收起动画 */
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
