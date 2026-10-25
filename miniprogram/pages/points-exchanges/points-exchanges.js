/**
 * 兑换记录页（pages/points-exchanges/points-exchanges）
 *
 * - 只读 GET /points/exchanges（按兑换时间倒序），状态取服务端推导值；
 *   服务端已把「卡仍 unused 但过了有效期」推导成 expired，页面再兜一层，避免过期的卡还能「去补签」；
 * - 状态映射 unused → 未使用 / used → 已使用 / 其余（含 expired 与未知值）→ 已过期；
 * - 未使用且未过期给「去补签」入口（回积分页补昨天），已使用/已过期只读；
 * - 登录闸门走触点级：进页不弹登录、游客不发请求，点引导才 ensureLogin。
 */
const api = require('../../services/api');
const { ensureLogin } = require('../../utils/login-gate');
const { bjDate, bjDateTime } = require('../../utils/bj-date');

const STATUS_TEXT = { unused: '未使用', used: '已使用', expired: '已过期' };

/** 接口时间既可能是毫秒数，也可能是 ISO 串（Fastify 会 Date → ISO） */
function toMs(v) {
  if (typeof v === 'number') return v;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? 0 : ms;
}

/** 兑现行：状态归一 + 可补签判定（未使用且未过期） */
function toRow(r, now) {
  const expiresAt = toMs(r.expiresAt);
  // 只有明确 unused/used 才采信；未知状态按已过期兜底，避免脏数据给出「去补签」
  let status = r.status === 'unused' || r.status === 'used' ? r.status : 'expired';
  if (status === 'unused' && expiresAt <= now) status = 'expired';
  return {
    id: r.id,
    title: '补签卡',
    costText: `-${r.cost} 积分`,
    status,
    statusText: STATUS_TEXT[status],
    canMakeup: status === 'unused' && expiresAt > now,
    timeText: bjDateTime(toMs(r.createdAt)),
    expiresText: bjDate(expiresAt),
    usedForDate: r.usedForDate || '',
  };
}

Page({
  data: {
    loggedIn: false,
    loading: true,
    failed: false,
    items: [],
  },

  onLoad() {
    this.fetch();
  },

  onShow() {
    // 从积分页补签回来时刷新状态；首屏 onLoad 后紧跟的 onShow 不重复请求
    if (this.data.loggedIn) this.fetch();
  },

  async fetch() {
    this.setData({ loading: true, failed: false });
    if (!getApp().globalData.loggedIn) {
      this.setData({ loading: false, loggedIn: false });
      return;
    }
    try {
      const rows = await api.get('/points/exchanges');
      const now = Date.now();
      this.setData({
        loggedIn: true,
        loading: false,
        items: (rows || []).map((r) => toRow(r, now)),
      });
    } catch (e) {
      this.setData({ loading: false, failed: true });
    }
  },

  async onLoginTap() {
    if (await ensureLogin('登录后查看兑换记录。')) this.fetch();
  },

  onRetry() {
    return this.fetch();
  },

  goMakeup() {
    wx.navigateTo({ url: '/pages/points/points' });
  },

  goItem() {
    wx.navigateTo({ url: '/pages/points-item/points-item' });
  },
});
