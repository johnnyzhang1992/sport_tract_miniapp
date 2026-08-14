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
    this.refreshUser();
  },

  onPullDownRefresh() {
    this.refreshUser().finally(() => wx.stopPullDownRefresh());
  },

  async refreshUser() {
    const app = getApp();
    try {
      if (!app.globalData.loggedIn) {
        await app.login();
      }
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
      this.setData({
        user: { ...user, avatarUrl, avatarText: user.nickname ? user.nickname[0] : '' },
        showBodyData,
        loggedIn: true,
        overview: {
          totalCount: total.count || 0,
          totalKm: ((total.distance || 0) / 1000).toFixed(1),
        },
        footprint: {
          provinceCount: footprint ? footprint.provinceCount : 0,
          cityCount: footprint ? footprint.cityCount : 0,
        },
      });
    } catch (e) {
      console.error('加载用户信息失败', e);
    } finally {
      this.setData({ loading: false });
    }
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

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },
});
