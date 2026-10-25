const api = require('../../services/api');
const { ensureLogin } = require('../../utils/login-gate');
const { bjDate } = require('../../utils/bj-date');

const PAGE_SIZE = 20;

/** 接口时间既可能是毫秒数，也可能是 ISO 串（Fastify 会 Date → ISO） */
function toMs(v) {
  if (typeof v === 'number') return v;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? 0 : ms;
}

Page({
  data: {
    loggedIn: false,
    balance: 0,
    items: [],
    page: 1,
    hasMore: true,
    loading: true,
    failed: false,
  },

  onLoad() {
    this.fetch(1);
  },

  async fetch(page) {
    // 登录闸门走触点级：进页不自动弹登录，游客先看引导，也不发请求
    if (!getApp().globalData.loggedIn) {
      this.setData({ loggedIn: false, loading: false, failed: false });
      return;
    }
    this.setData({ loading: true, failed: false });
    try {
      const data = await api.get('/points/records', { page, pageSize: PAGE_SIZE });
      const items = (data.items || []).map((it) => ({
        id: it.id,
        title: it.title,
        dateText: bjDate(toMs(it.createdAt)),
        deltaText: it.delta > 0 ? `+${it.delta}` : String(it.delta),
        positive: it.delta > 0,
        balanceAfter: it.balanceAfter,
      }));
      this.setData({
        loggedIn: true,
        balance: data.balance || 0,
        items: page === 1 ? items : this.data.items.concat(items),
        page,
        hasMore: items.length === PAGE_SIZE,
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false, failed: true });
    }
  },

  async onLoginTap() {
    if (await ensureLogin()) this.fetch(1);
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) return this.fetch(this.data.page + 1);
    return undefined;
  },

  onRetry() {
    return this.fetch(1);
  },
});
