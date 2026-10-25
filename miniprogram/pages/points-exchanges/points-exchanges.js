/**
 * 兑换记录页（pages/points-exchanges/points-exchanges）
 *
 * - 只读 GET /points/exchanges（按兑换时间倒序），状态取服务端推导值；
 *   服务端已把「卡仍 unused 但过了有效期」推导成 expired，页面再兜一层；
 * - 状态映射 unused → 未使用 / used → 已使用 / 其余（含 expired 与未知值）→ 已过期；
 * - 本页不再提供补签入口（Task 8 收口，spec §7）：逐日补签的唯一入口是积分页的补签胶囊，
 *   此前行内「去补签」只看持卡状态、不看 cells，会邀请用户进补不成的流程；已用的卡仍显示补了哪天（MM.DD）；
 * - 登录闸门走触点级：进页不弹登录、游客不发请求，点引导才 ensureLogin。
 */
const api = require('../../services/api');
const { ensureLogin, waitSession } = require('../../utils/login-gate');
const { bjDate, bjDateTime } = require('../../utils/bj-date');
const { md } = require('../../utils/points-view');

const STATUS_TEXT = { unused: '未使用', used: '已使用', expired: '已过期' };

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
    costText: `-${r.cost} 积分`,
    status,
    statusText: STATUS_TEXT[status],
    timeText: bjDateTime(toMs(r.createdAt)),
    expiresText: bjDate(expiresAt),
    // 服务端下发 YYYY-MM-DD，展示走 points-view 的 md()：与积分页七格/胶囊一律 MM.DD
    usedForDateText: r.usedForDate ? md(r.usedForDate) : '',
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
    // onLoad 后紧跟的首次 onShow 不重复请求；之后每次回到本页都重拉（含在积分页补签后回来）
    if (!this.entered) {
      this.entered = true;
      return;
    }
    this.fetch();
  },

  async fetch() {
    this.setData({ loading: true, failed: false });
    // 冷启动直达本页时，onLaunch 的静默登录可能还没回来，先等它，别把已登录用户当游客
    if (!(await waitSession())) {
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

  goItem() {
    wx.navigateTo({ url: '/pages/points-item/points-item' });
  },
});
