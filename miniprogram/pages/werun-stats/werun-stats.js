/**
 * 微信步数统计页：数据概况 + 每日趋势（7/30 按日、180 按周、365 按月）+ 每日明细分页。
 * 数据来自 /werun/stats 与 /werun/days；个人数据，需登录。
 */
const api = require('../../services/api');
const { waitSession, ensureLogin } = require('../../utils/login-gate');
const { syncDailySteps } = require('../../utils/werun');
const { buildOverview, buildTrend, buildDayItems, buildStepMetricCards } = require('../../utils/werun-stats-view');

const RANGES = [
  { key: 7, label: '7日' },
  { key: 30, label: '30日' },
  { key: 180, label: '半年' },
  { key: 365, label: '一年' },
];

const PAGE_SIZE = 20;

Page({
  data: {
    loggedIn: false,
    loading: true,
    error: '',
    ranges: RANGES,
    range: 7,
    overview: null,
    trend: null,
    stepMetricCards: [], // 近 30 天 vs 前 30 天：总步数/日均/最高单日/同步天数
    days: [],
    dayTotal: 0,
    dayPage: 1,
    dayHasMore: false,
    dayLoadingMore: false,
    dayLoadError: false, // 「加载更多」失败：底部给重试入口，不只是一闪而过的 toast
  },

  onLoad() {
    this.load();
  },

  onShow() {
    if (this._loaded) this.load(true);
  },

  /** 登录对齐 → 按设置补一趟步数 → 拉概况/趋势/明细第 1 页 */
  async load(silent = false) {
    const seq = (this._seq = (this._seq || 0) + 1);
    this.setData({ loading: !silent && !this.data.overview, error: '' });
    if (!(await waitSession())) {
      if (seq !== this._seq) return;
      this.setData({ loggedIn: false, loading: false });
      return;
    }
    if (seq !== this._seq) return;
    this.setData({ loggedIn: true });
    // 设置页开关开启时：进页补一次最新步数（5 分钟节流；关闭/未授权时自己短路）
    await syncDailySteps().catch(() => {});
    if (seq !== this._seq) return;
    // 变化卡固定近 30 天 vs 前 30 天，与当前时间档无关；跟着整页刷新一起重拉
    return Promise.all([
      this.fetchRange(this.data.range, seq, silent),
      this.fetchCompare(seq),
    ]);
  },

  /** 趋势变化卡：固定 30 天窗口，额外拿前一个 30 天做对比 */
  async fetchCompare(seq) {
    try {
      const s = await api.get('/werun/stats?range=30&compare=1');
      if (seq !== this._seq) return;
      this.setData({ stepMetricCards: buildStepMetricCards(s.overview, s.prevOverview) });
    } catch (e) {
      if (seq !== this._seq) return;
      console.warn('[werun-stats] 趋势对比加载失败', e);
      this.setData({ stepMetricCards: [] });
    }
  },

  async fetchRange(range, seq, silent = false) {
    try {
      const [stats, days] = await Promise.all([
        api.get(`/werun/stats?range=${range}`),
        api.get(`/werun/days?range=${range}&page=1&pageSize=${PAGE_SIZE}`),
      ]);
      if (seq !== this._seq) return;
      this.setData({
        loading: false,
        error: '',
        overview: buildOverview(stats.overview, stats.startDate, stats.endDate),
        trend: buildTrend(stats.trend, stats.bucket),
        days: buildDayItems(days.items),
        dayTotal: days.total || 0,
        dayPage: days.page || 1,
        dayHasMore: !!days.hasMore,
        dayLoadingMore: false,
        dayLoadError: false,
      });
      this._loaded = true;
    } catch (e) {
      if (seq !== this._seq) return;
      console.error('[werun-stats] 加载失败', e);
      const hasContent = !!this.data.overview;
      this.setData({ loading: false, error: hasContent ? '' : (e && e.message) || '加载失败' });
      if (hasContent && !silent) wx.showToast({ title: (e && e.message) || '刷新失败', icon: 'none' });
    }
  },

  /** 切换时间档：先清掉旧档内容，避免旧数据挂在新档位下 */
  onRangeTap(e) {
    const range = Number(e.currentTarget.dataset.range);
    if (!range || range === this.data.range) return;
    const seq = (this._seq = (this._seq || 0) + 1);
    this.setData({
      range,
      loading: true,
      error: '',
      overview: null,
      trend: null,
      days: [],
      dayTotal: 0,
      dayPage: 1,
      dayHasMore: false,
      dayLoadingMore: false,
      dayLoadError: false,
    });
    return this.fetchRange(range, seq);
  },

  /** 每日明细「加载更多」 */
  async loadMoreDays() {
    const { dayLoadingMore, dayHasMore, dayPage, range } = this.data;
    if (dayLoadingMore || !dayHasMore) return;
    const seq = this._seq;
    this.setData({ dayLoadingMore: true });
    try {
      const d = await api.get(`/werun/days?range=${range}&page=${dayPage + 1}&pageSize=${PAGE_SIZE}`);
      if (seq !== this._seq) return;
      this.setData({
        days: this.data.days.concat(buildDayItems(d.items)),
        dayPage: d.page || dayPage + 1,
        dayHasMore: !!d.hasMore,
        dayLoadingMore: false,
        dayLoadError: false,
      });
    } catch (e) {
      if (seq !== this._seq) return;
      // 分页失败保留已加载内容，底部给可点的重试入口（toast 一瞬就没了，用户没有第二次机会）
      this.setData({ dayLoadingMore: false, dayLoadError: true });
      console.warn('[werun-stats] 加载更多失败', e);
    }
  },

  guestLogin() {
    return ensureLogin('登录后查看你的微信步数统计。').then((ok) => {
      if (ok) this.load();
    });
  },

  retry() {
    return this.load();
  },

  onPullDownRefresh() {
    this.load(true).finally(() => wx.stopPullDownRefresh());
  },
});
