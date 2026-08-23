/**
 * 运动报告页：周/月/年/全部维度
 * 汇总 → 个人最佳 → 轨迹列表
 */
const api = require('../../services/api');
const config = require('../../config/index');
const { formatDuration, formatPace, formatDurationStat } = require('../../utils/format');

/** 时长带单位（分钟/小时/天） */
const durText = (sec) => {
  const d = formatDurationStat(sec || 0);
  return `${d.num}${d.unit}`;
};

const RANGES = [
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
  { value: 'year', label: '年' },
  { value: 'all', label: '全部' },
];

Page({
  data: {
    ranges: RANGES,
    activeRange: 'week',
    summary: null, // 汇总
    best: null, // 个人最佳
    tracks: [], // 轨迹列表（卡片）
    loading: true,
  },

  onLoad(options) {
    if (options.range) this.setData({ activeRange: options.range });
    this.fetch();
  },

  onRangeChange(e) {
    const value = e.currentTarget.dataset.value;
    if (value === this.data.activeRange) return;
    this.setData({ activeRange: value, summary: null, tracks: [], loading: true });
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
    try {
      const [overview, best] = await Promise.all([
        api.get(`/overview?range=${this.data.activeRange}`),
        api.get('/stats/best').catch(() => null),
      ]);
      this.setData({
        summary: this.buildSummary(overview),
        best: this.decorateBest(best),
        tracks: this.decorateTracks(overview.tracks || []),
      });
    } catch (e) {
      console.error('加载报告失败', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 汇总：次数/距离/时长/卡路里/爬升 + 平均每次 + 日均距离 + 活跃天数 */
  buildSummary(o) {
    const count = o.count || 0;
    const distanceKm = o.totalDistanceKm || 0;
    const durationSec = o.totalDurationSec || 0;
    const avgPer = count > 0 ? distanceKm / count : 0;
    // 活跃天数（不同日期的轨迹数）
    const days = new Set((o.tracks || []).map((t) => String(t.startTime).slice(0, 10))).size;
    const dayCount = this.data.activeRange === 'all' ? 365 : this.data.activeRange === 'year' ? 365 : this.data.activeRange === 'month' ? 30 : 7;
    return {
      count,
      distanceKm: distanceKm.toFixed(1),
      durationText: durText(durationSec), // 带单位（分钟/小时/天）
      calories: o.totalCalories || 0,
      elevationGain: o.totalElevationGain || 0,
      avgDistanceKm: avgPer.toFixed(1),
      avgDurationText: count > 0 ? durText(Math.round(durationSec / count)) : '—',
      activeDays: days,
      dailyKm: (distanceKm / dayCount).toFixed(2),
      hasData: count > 0,
    };
  },

  /** 个人最佳：4 项 + 日期 */
  decorateBest(b) {
    if (!b) return null;
    const dayText = (t) => {
      const d = new Date(t);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    };
    const rowsMap = {};
    const put = (rows, key, valFn) => {
      (rows || []).forEach((r) => {
        if (!rowsMap[r.type]) {
          const meta = config.ACTIVITY_TYPES.find((x) => x.type === r.type) || {};
          rowsMap[r.type] = { type: r.type, typeLabel: meta.label || r.type, typeIcon: meta.iconImg || '', maxDistance: '—', minPace: '—', maxDuration: '—', maxElevation: '—' };
        }
        rowsMap[r.type][key] = valFn(r);
      });
    };
    put(b.maxDistanceByType, 'maxDistance', (r) => `${(r.distance / 1000).toFixed(1)}km`);
    put(b.minPaceByType, 'minPace', (r) => formatPace(r.fastestKm ?? r.avgPace));
    put(b.maxDurationByType, 'maxDuration', (r) => formatDuration(r.duration));
    put(b.maxElevationByType, 'maxElevation', (r) => `${r.elevationGain}m`);
    return { bestTable: Object.keys(rowsMap).sort().map((t) => rowsMap[t]) };
  },

  /** 轨迹列表卡片（缩略图 + 类型/距离/时长/配速/时间） */
  decorateTracks(tracks) {
    return tracks.map((t) => {
      const meta = config.ACTIVITY_TYPES.find((x) => x.type === t.type) || {};
      const d = new Date(t.startTime);
      const paceText =
        t.avgPace && !['swimming', 'cycling'].includes(t.type) ? formatPace(t.avgPace) : '';
      return {
        id: t.id,
        iconImg: meta.iconImg || '',
        label: meta.label || t.type,
        color: '#808080',
        previewPoints: t.points || [],
        distanceKm: (t.distance / 1000).toFixed(1),
        durationText: formatDuration(t.duration),
        paceText,
        timeText: `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      };
    });
  },

  /** 进入轨迹详情 */
  onTapTrack(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/track-detail/track-detail?id=${id}` });
  },
});
