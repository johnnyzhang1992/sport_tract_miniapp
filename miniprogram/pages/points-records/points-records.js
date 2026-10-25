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
    loading: true, // 仅首屏/重试第一页：整页加载态
    loadingMore: false, // 仅触底翻页：底栏内联提示，不清列表
    failed: false, // 首屏失败：整页错误态
    loadMoreFailed: false, // 翻页失败：保留已有行，底栏给重试
  },

  onLoad() {
    this.fetch(1);
  },

  async fetch(page) {
    // 登录闸门走触点级：进页不自动弹登录，游客先看引导，也不发请求
    if (!getApp().globalData.loggedIn) {
      this.setData({
        loggedIn: false,
        loading: false,
        loadingMore: false,
        failed: false,
        loadMoreFailed: false,
      });
      return;
    }
    if (page === 1) this.setData({ loading: true, failed: false, loadMoreFailed: false });
    else this.setData({ loadingMore: true, loadMoreFailed: false });
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
        loadingMore: false,
      });
    } catch (e) {
      // 第一页失败没有可展示内容，整页错误态；翻页失败保留已渲染行（page 不变，重试仍翻同一页）
      if (page === 1) this.setData({ loading: false, failed: true });
      else this.setData({ loadingMore: false, loadMoreFailed: true });
    }
  },

  async onLoginTap() {
    if (await ensureLogin('登录后查看积分记录。')) this.fetch(1);
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading && !this.data.loadingMore) {
      return this.fetch(this.data.page + 1);
    }
    return undefined;
  },

  /** 底栏「加载失败，点击重试」：仍翻当前 page 的下一页，不回第一页 */
  onMoreRetry() {
    return this.fetch(this.data.page + 1);
  },

  onRetry() {
    return this.fetch(1);
  },
});
