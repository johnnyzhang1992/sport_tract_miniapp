const api = require('../../services/api');
const loading = require('../../utils/loading');
const { initialOf } = require('../../utils/format.js');

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
    unreadCount: 0, // 未读通知数（0=不显示角标）
    // 签到条（登录后显示）：未签点击直接签到，已签点击进积分页
    signin: { loaded: false, signedToday: false, streakDay: 0, nextReward: 0, balance: null },
  },

  onShow() {
    // 年度报告入口仅年末（12 月）展示，平时从运动报告页进入
    this.setData({ showYearReport: new Date().getMonth() === 11 });
    this.refreshUser();
    this.loadUnread();
  },

  onPullDownRefresh() {
    this.refreshUser().finally(() => wx.stopPullDownRefresh());
  },

  /** 未读通知数：失败静默（无角标）；游客接口返回 0 */
  async loadUnread() {
    try {
      const res = await api.get('/notifications/summary');
      this.setData({ unreadCount: (res && res.unreadCount) || 0 });
    } catch (e) {
      // 静默
    }
  },

  /** 消息中心（历史通知） */
  goNotifications() {
    wx.navigateTo({ url: '/pages/notification-list/notification-list' });
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
      // 刷新资料 + 概况（今日/本周/本月的运动距离）+ 签到状态（快捷签到条用）
      const [user, overview, points] = await Promise.all([
        api.get('/users/me'),
        api.get('/stats/overview').catch(() => null),
        api.get('/points/summary').catch(() => null),
      ]);

      // 头像缓存判断：基础 URL 没变且缓存未过期 → 复用缓存签名 URL（image src 不变 → 微信缓存命中，不重复下载）
      let avatarUrl = user.avatarUrl || '';
      if (!avatarUrl && user.avatarPreset) {
        // 默认头像预设（本地包内资源，不走 OSS 签名缓存）
        avatarUrl = '/assets/avatars/' + user.avatarPreset + '.png';
      }
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
        user: { ...user, avatarUrl, avatarText: initialOf(user.nickname, ''), joinDays },
        showBodyData,
        loggedIn: true,
        // 数据统计卡（简洁三格）：本周距离 / 累计距离 / 运动天数——
        // 旧版「今日/本周/本月」在多数日子两格是 0.0；换成累计口径后格格有值
        stats: (() => {
          const w = (overview && overview.week) || {};
          const t = (overview && overview.total) || {};
          const fmtKm = (m) => ((m || 0) / 1000).toFixed(1).replace(/\.0$/, '');
          return {
            weekKm: fmtKm(w.distance),
            totalKm: fmtKm(t.distance),
            activeDays: t.activeDays || 0,
          };
        })(),
        signin: {
          loaded: !!points,
          signedToday: !!(points && points.signin && points.signin.todaySigned),
          streakDay: (points && points.signin && points.signin.streakDay) || 0,
          nextReward: (points && points.signin && points.signin.nextReward) || 0,
          cards: (points && points.signin && points.signin.cards) || 0,
          balance: points ? points.balance : null,
        },
      });
    } catch (e) {
      console.error('加载用户信息失败', e);
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 资产条左侧（我的积分）：进积分页看余额/明细/任务/补签 */
  onBadgeTap() {
    this.goPoints();
  },

  /** 签到条点击：未签直接签到（原地翻转状态），已签进积分页看任务/补签 */
  async onSigninStripTap() {
    if (this.data.signin.signedToday) {
      this.goPoints();
      return;
    }
    try {
      // POST /points/sign-in 的返回是顶层平铺的 SigninResult（todaySigned/streakDay/nextReward/
      // balance 直接在 data 上）——不是 summary 那种 { signin: {...} } 嵌套，别读错形状
      const data = await api.post('/points/sign-in');
      this.setData({
        signin: {
          loaded: true,
          signedToday: !!(data && data.todaySigned),
          streakDay: (data && data.streakDay) || 0,
          nextReward: (data && data.nextReward) || 0,
          balance: (data && data.balance) ?? null,
        },
      });
      const credited = (data && data.credited) || 0;
      wx.showToast({ title: credited > 0 ? `签到成功 +${credited}` : '今日已签到', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '签到失败', icon: 'none' });
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

  /** 每周运动榜 */
  goLeaderboard() {
    wx.navigateTo({ url: '/pages/leaderboard/leaderboard' });
  },

  /** 积分规则 */
  goRules() {
    wx.navigateTo({ url: '/pages/points-rules/points-rules' });
  },

  /** 数据导入（M7：两步路/Strava 等 GPX/KML/TCX） */
  goImport() {
    wx.navigateTo({ url: '/pages/import/import' });
  },

  goStats() {
    wx.navigateTo({ url: '/pages/stats/stats' });
  },

  /** 我的积分（签到 / 任务 / 补签卡） */
  goPoints() {
    wx.navigateTo({ url: '/pages/points/points' });
  },

  /** 运动报告（周/月/年汇总 + 本期亮点 + 周期对比 + 分类型/日期明细 + 海报） */
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
        loading.show('登录中…', { mask: true });
        try {
          await app.login();
          await this.refreshUser();
          app.maybeShowProfileGuide(); // 登录后引导完善资料（身高体重 → 卡路里更准）
          loading.hide();
          wx.showToast({ title: '登录成功', icon: 'success' });
        } catch (e) {
          console.error('登录失败', e);
          loading.hide();
          wx.showToast({ title: '登录失败，请重试', icon: 'none' });
        } finally {
          loading.hide();
        }
      },
    });
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },
});
