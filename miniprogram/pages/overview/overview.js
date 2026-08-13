const api = require('../../services/api');
const config = require('../../config/index');
const { formatDuration, compact, formatDurationStat } = require('../../utils/format');

const RANGES = [
  { value: 'week', label: '一周' },
  { value: 'month', label: '一月' },
  { value: 'year', label: '一年' },
  { value: 'all', label: '全部' },
];

Page({
  data: {
    ranges: RANGES,
    activeRange: 'week',
    data: { count: 0, totalDistanceKm: 0, durationNum: '—', durationUnit: '分钟' },
    tracks: [],
    heat: [],
    recentTracks: [],
    mapType: 'standard',
    loading: false,
    fullscreen: false,
  },

  onLoad() {
    this.fetch();
  },

  async fetch() {
    const app = getApp();
    if (!app.globalData.loggedIn) {
      try {
        await app.login();
      } catch (e) {
        wx.showToast({ title: '登录失败', icon: 'none' });
        return;
      }
    }
    this.setData({ loading: true });
    try {
      const res = await api.get(`/overview?range=${this.data.activeRange}`);
      console.log('[overview] res tracks=', (res.tracks || []).length, 'heat=', (res.heat || []).length);
      const dur = formatDurationStat(res.totalDurationSec);
      this.setData({
        data: {
          count: res.count,
          totalDistanceKm: compact(res.totalDistanceKm),
          durationNum: dur.num,
          durationUnit: dur.unit,
        },
        tracks: this.decorateTracks(res.tracks),
        heat: res.heat || [],
        recentTracks: this.decorateRecent(res.tracks),
      });
    } catch (e) {
      console.error('加载轨迹合集失败', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
      // 只兜底视野定位（不重复 buildOverview，避免覆盖竞态）
      setTimeout(() => {
        const map = this.selectComponent('#overviewMap');
        if (map && typeof map.fitOverviewView === 'function') {
          map.fitOverviewView();
        }
      }, 300);
    }
  },

  onRangeChange(e) {
    const value = e.currentTarget.dataset.value;
    if (value === this.data.activeRange) return;
    this.setData({ activeRange: value, tracks: [], heat: [], recentTracks: [] });
    this.fetch();
  },

  /** 轨迹 → 地图 polyline 数据（类型配色） */
  decorateTracks(tracks) {
    return (tracks || []).map((t) => {
      const meta = config.ACTIVITY_TYPES.find((x) => x.type === t.type) || {};
      return {
        id: t.id,
        type: t.type,
        color: '#1f2329', // 轨迹颜色统一黑色
        points: t.points || [],
      };
    });
  },

  /** 最近轨迹列表（取前 20 条） */
  decorateRecent(tracks) {
    return (tracks || []).slice(0, 20).map((t) => {
      const meta = config.ACTIVITY_TYPES.find((x) => x.type === t.type) || {};
      const start = new Date(t.startTime);
      const timeText =
        Math.floor((Date.now() - start.getTime()) / 86400000) < 7
          ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][start.getDay()]
          : `${start.getFullYear()}/${start.getMonth() + 1}/${start.getDate()}`;
      return {
        id: t.id,
        icon: meta.icon || '🏃',
        iconImg: meta.iconImg || '',
        label: meta.label || t.type,
        timeText,
        distanceKm: (t.distance / 1000).toFixed(2),
        durationText: formatDuration(t.duration),
      };
    });
  },

  switchLayer() {
    this.setData({
      mapType: this.data.mapType === 'standard' ? 'satellite' : 'standard',
    });
  },

  /** 全屏展示合集地图 */
  openFullscreen() {
    this.setData({ fullscreen: true });
    // 全屏组件刚创建（wx:if），ready 已画线；这里只兜底视野
    setTimeout(() => {
      const map = this.selectComponent('#fsOverviewMap');
      if (map && typeof map.fitOverviewView === 'function') {
        map.fitOverviewView();
      }
    }, 300);
  },

  closeFullscreen() {
    this.setData({ fullscreen: false });
  },

  /** 全屏内图层切换 */
  fsSwitchLayer() {
    this.switchLayer();
  },

  onTapTrack(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/track-detail/track-detail?id=${id}` });
  },
});
