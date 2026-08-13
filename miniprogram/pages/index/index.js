/** 数字缩写：≥10000 → 1.22W，≥1000 → 1.22K，否则去尾零保留2位 */
function compact(v) {
  if (v >= 10000) return (v / 10000).toFixed(2).replace(/\.?0+$/, '') + 'W';
  if (v >= 1000) return (v / 1000).toFixed(2).replace(/\.?0+$/, '') + 'K';
  return String(Math.round(v * 100) / 100);
}

/** 时长格式化：≤999分钟→分钟；≤999小时→小时；否则→天 */
function formatDuration(seconds) {
  const min = seconds / 60;
  if (min <= 999) return { num: String(Math.round(min)), unit: '分钟' };
  const h = min / 60;
  if (h <= 999) return { num: String(Math.round(h * 10) / 10), unit: '小时' };
  return { num: String(Math.round((h / 24) * 10) / 10), unit: '天' };
}

const config = require('../../config/index');
const api = require('../../services/api');

Page({
  data: {
    activityTypes: config.ACTIVITY_TYPES,
    selectedType: 'running',
    overview: null,
    overviewLabel: '今日概览',
    loading: false,
  },

  onShow() {
    this.applyDefaultType();
    this.loadOverview();
  },

  /** 应用设置的默认运动类型（设置页保存到后端用户 settings） */
  async applyDefaultType() {
    try {
      const app = getApp();
      // 确保已登录（onShow 时可能登录尚未完成，导致读取不到 settings）
      if (!app.globalData.loggedIn) {
        await app.login();
      }
      const user = await api.get('/users/me');
      const dt = user && user.settings && user.settings.defaultType;
      if (dt && config.ACTIVITY_TYPES.some((t) => t.type === dt)) {
        this.setData({ selectedType: dt });
      }
    } catch (e) {
      console.error('读取默认运动类型失败', e);
    }
  },

  onPullDownRefresh() {
    this.loadOverview().finally(() => wx.stopPullDownRefresh());
  },

  selectType(e) {
    this.setData({ selectedType: e.currentTarget.dataset.type });
  },

  /** 今日/本周/当月/今年概览（决策 F18）——请求去重 + 失败保留旧数据（切换 tab 不丢） */
  async loadOverview() {
    if (this._loadingOverview) return; // 进行中不重复请求（tab 快速切换竞态）
    this._loadingOverview = true;
    try {
      const app = getApp();
      if (!app.globalData.loggedIn) {
        await app.login();
      }
      const overview = await api.get('/stats/overview');
      // 兜底优先级：今日 → 本周 → 当月 → 今年 → 今日（都无数据）
      const order = [
        { key: 'today', label: '今日' },
        { key: 'week', label: '本周' },
        { key: 'month', label: '当月' },
        { key: 'year', label: '今年' },
      ];
      const sec =
        order.find((o) => (overview[o.key] || {}).count > 0) ||
        { key: 'today', label: '今日' };
      const s = overview[sec.key] || { count: 0, distance: 0, duration: 0, calories: 0 };
      // 预处理：WXML 不支持 toFixed 等方法调用；公里/千卡 K·W 缩写、时长分钟→小时→天
      const dur = formatDuration(s.duration || 0);
      this.setData({
        overviewLabel: sec.label + '概览',
        overview: {
          today: {
            count: s.count,
            distanceNum: compact((s.distance || 0) / 1000),
            distanceUnit: '公里',
            durationNum: dur.num,
            durationUnit: dur.unit,
            calorieNum: compact(s.calories || 0),
            calorieUnit: '千卡',
          },
        },
      });
    } catch (e) {
      console.error('加载概览失败', e); // 保留旧数据（不置空，避免切换 tab 后空白）
    } finally {
      this._loadingOverview = false;
      this.setData({ loading: false });
    }
  },

  /** 开始运动 → 记录页（M2 里程碑：实时地图+数据面板） */
  startRecord() {
    wx.navigateTo({
      url: `/pages/record/record?type=${this.data.selectedType}`,
    });
  },
});
