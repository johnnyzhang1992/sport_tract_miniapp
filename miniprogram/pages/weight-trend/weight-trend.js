/**
 * 体重趋势页：折线图展示体重变化，支持 天/周/月/年 维度
 */
const api = require('../../services/api');

const RANGES = [
  { value: 'today', label: '今天' },
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
  { value: 'year', label: '今年' },
];

Page({
  data: {
    ranges: RANGES,
    activeRange: 'month',
    chartData: [],
    loading: false,
    latestWeight: null, // 最新体重（统计卡）
    heightCm: null, // 身高（BMI 用）
    bmi: null, // BMI 值（按最新体重算）
    bmiLabel: '',
    inputWeight: '', // 快捷记录输入
    saving: false,
  },

  onLoad() {
    this.fetch();
  },

  onRangeChange(e) {
    const value = e.currentTarget.dataset.value;
    if (value === this.data.activeRange) return;
    this.setData({ activeRange: value });
    this.fetch();
  },

  async fetch() {
    const app = getApp();
    // 已注册用户（本地有 token）静默恢复登录；游客不自动登录
    if (app.hasSession() && !app.globalData.loggedIn) {
      try {
        await app.login();
      } catch (e) {
        console.warn('静默登录失败', e);
      }
    }
    if (!app.globalData.loggedIn) return;
    this.setData({ loading: true });
    try {
      const [res, me] = await Promise.all([
        api.get('/users/weight-logs', { range: this.data.activeRange }),
        api.get('/users/me').catch(() => null),
      ]);
      const items = res.items || [];
      // 时间倒序 → 正序（折线从左到右按时间）
      const asc = items.slice().reverse();
      const latestWeight = items.length ? items[0].weightKg : null;
      this.setData({
        chartData: asc.map((it) => ({
          label: this.formatDate(it.createdAt),
          value: it.weightKg,
        })),
        latestWeight,
        heightCm: me && me.heightCm ? me.heightCm : null,
        ...this.buildBmi(latestWeight, me && me.heightCm),
      });
    } catch (e) {
      console.error('加载体重趋势失败', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  /** BMI = 体重kg / 身高m²（缺身高不算）；分类按中国成人标准 */
  buildBmi(weightKg, heightCm) {
    if (!weightKg || !heightCm) return { bmi: null, bmiLabel: '' };
    const bmi = Math.round((weightKg / Math.pow(heightCm / 100, 2)) * 10) / 10;
    let bmiLabel = '偏瘦';
    if (bmi >= 28) bmiLabel = '肥胖';
    else if (bmi >= 24) bmiLabel = '偏胖';
    else if (bmi >= 18.5) bmiLabel = '正常';
    return { bmi, bmiLabel };
  },

  onWeightInput(e) {
    this.setData({ inputWeight: e.detail.value });
  },

  /** 快捷记录今日体重：PUT /users/me（后端与上次差 ≥0.1kg 自动写 WeightLog） */
  async saveWeight() {
    const v = Number(this.data.inputWeight);
    if (!v || v < 20 || v > 300) {
      wx.showToast({ title: '请输入 20~300 之间的体重', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      const weightKg = Math.round(v * 10) / 10;
      await api.put('/users/me', { weightKg });
      // 同步全局缓存（记录页卡路里计算等读 globalData）
      const app = getApp();
      if (app.globalData.userInfo) app.globalData.userInfo.weightKg = weightKg;
      wx.showToast({ title: '已记录', icon: 'success' });
      this.setData({ inputWeight: '' });
      this.fetch();
    } catch (e) {
      console.error('记录体重失败', e);
      wx.showToast({ title: e.message || '记录失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  formatDate(ts) {
    const d = new Date(ts);
    const r = this.data.activeRange;
    if (r === 'today') {
      return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    if (r === 'week' || r === 'month') {
      return `${d.getMonth() + 1}/${d.getDate()}`;
    }
    return `${d.getMonth() + 1}/${d.getDate()}`;
  },

  /** 回资料编辑 */
  backToProfile() {
    wx.navigateBack();
  },
});
