const api = require('../../services/api');

/** 头像签名 URL 缓存（OSS 签名 URL 每次生成都不同，导致 image 无法缓存、每次进入重复下载）
 * 基础 URL（去签名参数）没变 → 复用缓存签名 URL（微信 image 缓存命中，不重复请求 CDN） */
const AVATAR_CACHE_KEY = 'my_avatar_cache';
const AVATAR_CACHE_TTL = 6 * 3600 * 1000; // 签名有效期 24h，缓存 6h 保险
const baseUrl = (u) => (u ? u.split('?')[0] : '');

Page({
  data: {
    user: null,
    loggedIn: false,
    loading: false,
    overview: null, // { totalCount, totalKm }
    footprint: null, // { provinceCount, cityCount }
  },

  onShow() {
    // 年度报告入口仅年末（12 月）展示，平时从运动报告页进入
    this.setData({ showYearReport: new Date().getMonth() === 11 });
    this.refreshUser();
  },

  onPullDownRefresh() {
    this.refreshUser().finally(() => wx.stopPullDownRefresh());
  },

  async refreshUser() {
    const app = getApp();
    // 已注册用户（本地有 token）静默恢复登录；游客不自动登录
    if (app.hasSession() && !app.globalData.loggedIn) {
      try {
        await app.login();
      } catch (e) {
        console.warn('静默登录失败', e);
      }
    }
    // 游客态：展示登录引导（登录由用户点击触发）
    if (!app.globalData.loggedIn) {
      this.setData({ loggedIn: false, user: null, loading: false });
      return;
    }
    try {
      this.setData({ loading: true });
      // 刷新资料 + 概况（轨迹合集总数/点亮省市数）
      const [user, overview, footprint] = await Promise.all([
        api.get('/users/me'),
        api.get('/stats/overview').catch(() => null),
        api.get('/stats/footprint').catch(() => null),
      ]);
      const total = overview && overview.total ? overview.total : { count: 0, distance: 0 };

      // 头像缓存判断：基础 URL 没变且缓存未过期 → 复用缓存签名 URL（image src 不变 → 微信缓存命中，不重复下载）
      let avatarUrl = user.avatarUrl || '';
      const cache = wx.getStorageSync(AVATAR_CACHE_KEY) || {};
      if (cache.url && cache.base === baseUrl(avatarUrl) && Date.now() - (cache.ts || 0) < AVATAR_CACHE_TTL) {
        avatarUrl = cache.url;
      } else if (avatarUrl) {
        wx.setStorageSync(AVATAR_CACHE_KEY, { base: baseUrl(avatarUrl), url: avatarUrl, ts: Date.now() });
      }

      // WXML 不支持字符串下标，预处理好头像首字
      const showBodyData = (user.weightKg || user.heightCm) && (!user.settings || user.settings.showBodyData !== false);
      // 加入天数（ createdAt → 今天，至少 1 天）
      const joinDays = user.createdAt
        ? Math.max(1, Math.ceil((Date.now() - new Date(user.createdAt).getTime()) / 86400000))
        : null;
      this.setData({
        user: { ...user, avatarUrl, avatarText: user.nickname ? user.nickname[0] : '', joinDays },
        showBodyData,
        loggedIn: true,
        overview: {
          totalCount: total.count || 0,
          totalKm: ((total.distance || 0) / 1000).toFixed(1),
        },
        // 轨迹合集卡片：累计 次数/公里/总时长（3 格网格）
        overviewStats: [
          { value: String(total.count || 0), label: '次数' },
          { value: ((total.distance || 0) / 1000).toFixed(1), label: '公里' },
          { value: this.fmtDuration(total.duration || 0), label: '总时长' },
        ],
        // 数据统计卡片：今日/本周/本月运动距离（km）
        statsCards: ['today', 'week', 'month'].map((k) => {
          const s = overview && overview[k] ? overview[k] : { distance: 0 };
          return { key: k, distance: ((s.distance || 0) / 1000).toFixed(1) };
        }),
        footprint: {
          provinceCount: footprint ? footprint.provinceCount : 0,
          cityCount: footprint ? footprint.cityCount : 0,
        },
        // 点亮地图卡片：省份/城市（通用网格）
        footprintStats: [
          { value: String(footprint ? footprint.provinceCount : 0), label: '省份' },
          { value: String(footprint ? footprint.cityCount : 0), label: '城市' },
        ],
      });
    } catch (e) {
      console.error('加载用户信息失败', e);
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 总时长格式化（秒 → 分钟/小时/天） */
  fmtDuration(sec) {
    const min = (sec || 0) / 60;
    if (min < 60) return `${Math.round(min)}分钟`;
    const h = min / 60;
    if (h < 24) return `${Math.round(h * 10) / 10}小时`;
    return `${Math.round((h / 24) * 10) / 10}天`;
  },

  /** 轨迹合集（M6：一周/一月/一年一图总览） */
  goOverview() {
    wx.navigateTo({ url: '/pages/overview/overview' });
  },

  /** 数据导入（M7：两步路/Strava 等 GPX/KML/TCX） */
  goImport() {
    wx.navigateTo({ url: '/pages/import/import' });
  },

  /** 点亮地图（足迹省份/城市统计） */
  goFootprint() {
    wx.navigateTo({ url: '/packageFootprint/pages/footprint/footprint' });
  },

  goStats() {
    wx.navigateTo({ url: '/pages/stats/stats' });
  },

  /** 运动报告（周/月/年汇总 + 个人最佳 + 轨迹记录） */
  goReport() {
    wx.navigateTo({ url: '/pages/report/report' });
  },

  /** 年度运动报告（年度总评 + 月度分解 + 高光时刻 + 海报） */
  goYearReport() {
    wx.navigateTo({ url: '/pages/year-report/year-report' });
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },

  /** 用户卡点击：已登录 → 编辑资料；未登录 → 弹窗登录 */
  onUserCardTap() {
    if (getApp().globalData.loggedIn) {
      this.goProfile();
    } else {
      this.handleLogin();
    }
  },

  /** 未登录点击登录 → 弹窗确认 → 静默登录 → 刷新 */
  handleLogin() {
    const app = getApp();
    if (app.globalData.loggedIn) return;
    wx.showModal({
      title: '登录',
      content: '登录后将同步你的运动数据（轨迹、点亮地图、统计等），一键微信登录，无需注册。',
      confirmText: '登录',
      cancelText: '暂不',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '登录中…', mask: true });
        try {
          await app.login();
          await this.refreshUser();
          wx.showToast({ title: '登录成功', icon: 'success' });
        } catch (e) {
          console.error('登录失败', e);
          wx.showToast({ title: '登录失败，请重试', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      },
    });
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },
});
