const api = require('../../services/api');
const storage = require('../../services/storage');
const { ensureLogin } = require('../../utils/login-gate');
const {
  RANGES,
  granularityOptions,
  normalizeGranularity,
  buildUserSeries,
  buildTrackSeries,
} = require('../../utils/operator-trend');

/**
 * 数据概览（role=admin 微信用户＝站内运营者的只读页）：
 * 今日（实时）/ 昨日（完整自然日）六项指标，聚合数字、无任何用户级明细。
 * 退款不在小程序端：Android 用户自助退 / 管理端 webAdmin 操作，iOS 用户走 App Store。
 */
Page({
  data: {
    loading: true,
    failed: false,
    loggedIn: false,
    authorized: false,
    summary: null,
    range: 'week',
    granularity: 'day',
    ranges: RANGES,
    granOptions: granularityOptions('week'),
    userChart: null,
    trackChart: null,
    trendLoading: false,
    trendFailed: false,
  },

  onShow() {
    const token = storage.getToken();
    const loggedIn = !!(token && token.accessToken);
    this.setData({ loggedIn });
    if (!loggedIn) {
      this.setData({ loading: false, failed: false, authorized: false });
      return;
    }
    this.load();
  },

  async load() {
    this.setData({ loading: true, failed: false });
    try {
      const [me, summary] = await Promise.all([
        api.get('/operator/me'),
        api.get('/operator/stats/summary'),
      ]);
      this.setData({ loading: false, authorized: true, summary: summary || null });
      this.loadTrend();
    } catch (e) {
      const msg = (e && e.message) || '';
      this.setData({ loading: false, failed: true, authorized: !/仅运营者/.test(msg) });
      if (/仅运营者/.test(msg)) this.setData({ failed: false });
    }
  },

  /** 趋势：范围×粒度共享；快切序号守卫；已有图时静默更新不闪空态 */
  async loadTrend() {
    const seq = (this._trendSeq = (this._trendSeq || 0) + 1);
    const { range, granularity } = this.data;
    if (!this.data.userChart) this.setData({ trendLoading: true, trendFailed: false });
    try {
      const d = await api.get(`/operator/stats/trend?range=${range}&granularity=${granularity}`);
      if (seq !== this._trendSeq) return;
      const buckets = (d && d.buckets) || [];
      this.setData({
        trendLoading: false,
        trendFailed: false,
        userChart: buildUserSeries(buckets),
        trackChart: buildTrackSeries(buckets),
      });
    } catch (e) {
      if (seq !== this._trendSeq) return;
      if (this.data.userChart) this.setData({ trendLoading: false });
      else this.setData({ trendLoading: false, trendFailed: true });
    }
  },

  onRange(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.range) return;
    this.setData({
      range: key,
      granularity: normalizeGranularity(key, this.data.granularity),
      granOptions: granularityOptions(key),
    });
    this.loadTrend();
  },

  onGran(e) {
    const { key, disabled } = e.currentTarget.dataset;
    if (!key || disabled || key === this.data.granularity) return;
    this.setData({ granularity: key });
    this.loadTrend();
  },

  onRetryTrend() {
    this.loadTrend();
  },

  onRetry() {
    if (this.data.loggedIn) this.load();
  },

  onTapGate() {
    ensureLogin().then((ok) => {
      if (ok) this.load();
    });
  },

  onPullDownRefresh() {
    if (!this.data.loggedIn) {
      wx.stopPullDownRefresh();
      return;
    }
    this.load().catch(() => {}).then(() => wx.stopPullDownRefresh());
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.navigateTo({ url: '/pages/my/my' }) });
  },
});
