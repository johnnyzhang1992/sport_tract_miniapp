const api = require('../../services/api');
const { ensureLogin, waitSession } = require('../../utils/login-gate');
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
    typeFilter: '', // 明细类型筛选（空 = 全部）；入口可带 type 进入
  },

  onLoad(options) {
    // 支持带 type 进入（如「兑换记录」入口带 type=exchange）：只看该类型明细
    const type = options && options.type ? String(options.type) : '';
    this.setData({ typeFilter: type });
    this.fetch(1);
  },

  onShow() {
    // onLoad 后紧跟的首次 onShow 不重复请求；之后回到本页重拉第一页
    if (!this.entered) {
      this.entered = true;
      return;
    }
    this.fetch(1);
  },

  async fetch(page) {
    // 加载态先落（翻页只亮底栏，不把整页打回「加载中」），再过登录闸门
    if (page === 1) this.setData({ loading: true, failed: false, loadMoreFailed: false });
    else this.setData({ loadingMore: true, loadMoreFailed: false });
    // 登录闸门走触点级：游客不发请求；冷启动直达时先等 onLaunch 那次静默登录
    if (!(await waitSession())) {
      this.setData({
        loggedIn: false,
        loading: false,
        loadingMore: false,
        failed: false,
        loadMoreFailed: false,
      });
      return;
    }
    try {
      const typeFilter = this.data.typeFilter;
      const data = await api.get(
        '/points/records',
        typeFilter ? { page, pageSize: PAGE_SIZE, type: typeFilter } : { page, pageSize: PAGE_SIZE },
      );
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
