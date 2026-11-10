/**
 * 单日计划详情（参照 Apple 健身单日页，去掉分时图表）：
 * 顶部本周七天迷你环（可点切换）+ 中央大环 + 三项「当前/目标」大数字 + 当天轨迹摘要。
 * 数据：GET /plan/day?date=YYYY-MM-DD
 */
const api = require('../../services/api');
const { bjParts } = require('../../utils/bj-date');
const config = require('../../config/index');

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
const COLORS = {
  red: '#FA114F', redDim: '#FBD9E4',
  green: '#92E82A', greenDim: '#E6F7D4',
  cyan: '#1AD4E0', cyanDim: '#D5F6F9',
};

const km = (m) => (Math.round((Number(m) || 0) / 100) / 10).toFixed(1);
const minutes = (sec) => String(Math.round((Number(sec) || 0) / 60));

/** YYYY-MM-DD ± n 天（纯字符串口径，走 UTC 避免设备时区） */
function shiftDate(date, n) {
  const t = Date.parse(`${date}T00:00:00Z`);
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}

Page({
  data: {
    date: '',
    dateText: '',
    weekStrip: [], // 本周七天：{ date, wd, pct, sel }
    rings: [],
    allAchieved: false,
    metrics: [],
    tracks: [],
    loading: true,
    failed: false,
  },

  onLoad(options) {
    const date = (options && options.date) || '';
    this.setData({ date });
    this.load(date);
  },

  /** 加载某天详情；顺便把「本周七天」的环也拉齐（同一月历接口按天取会太多请求，这里只画当前天，其余留白点） */
  async load(date) {
    this.setData({ loading: true, failed: false, date });
    try {
      const d = await api.get(`/plan/day?date=${date}`);
      const p = bjParts(Date.parse(`${date}T00:00:00+08:00`));
      const weekIndex = (p.dow + 6) % 7; // 周一起始
      const monday = shiftDate(date, -weekIndex);
      const weekStrip = [];
      for (let i = 0; i < 7; i += 1) {
        const dd = shiftDate(monday, i);
        weekStrip.push({
          date: dd,
          wd: WEEK_CN[bjParts(Date.parse(`${dd}T00:00:00+08:00`)).dow],
          day: Number(dd.slice(8, 10)),
          label: `${Number(dd.slice(5, 7))}/${Number(dd.slice(8, 10))}`,
          sel: dd === date,
          pct: dd === date ? (d.rings || []).map((r) => r.pct) : null,
        });
      }
      const byKey = {};
      for (const r of d.rings || []) byKey[r.key] = r;
      const dist = byKey.distance || { value: 0, target: 0, pct: 0 };
      const dur = byKey.duration || { value: 0, target: 0, pct: 0 };
      const cnt = byKey.count || { value: 0, target: 0, pct: 0 };
      this.setData({
        dateText: `${p.y}年${p.m}月${p.d}日`,
        weekStrip,
        rings: d.rings || [],
        allAchieved: !!d.allAchieved,
        metrics: [
          {
            key: 'distance', name: '运动距离', cls: 'red',
            value: km(dist.value), target: km(dist.target), unit: 'km',
            pct: Math.round((dist.pct || 0) * 100),
          },
          {
            key: 'duration', name: '运动时间', cls: 'green',
            value: minutes(dur.value), target: minutes(dur.target), unit: '分钟',
            pct: Math.round((dur.pct || 0) * 100),
          },
          {
            key: 'count', name: '运动次数', cls: 'cyan',
            value: String(cnt.value), target: String(cnt.target), unit: '次',
            pct: Math.round((cnt.pct || 0) * 100),
          },
        ],
        tracks: (d.tracks || []).map((t) => {
          const meta = (config.ACTIVITY_TYPES || []).find((x) => x.type === t.type) || {};
          const tp = bjParts(t.startTime);
          return {
            id: t.id,
            label: meta.label || '运动',
            icon: meta.icon || '🏃',
            distText: `${km(t.distanceM)} km`,
            durText: `${minutes(t.durationSec)} 分钟`,
            timeText: `${String(tp.y).slice(2)}/${tp.m}/${tp.d} ${String(new Date(t.startTime + 8 * 3600_000).getUTCHours()).padStart(2, '0')}:${String(new Date(t.startTime + 8 * 3600_000).getUTCMinutes()).padStart(2, '0')}`,
          };
        }),
        loading: false,
      }, () => this.drawBigRing());
    } catch (e) {
      this.setData({ loading: false, failed: true });
    }
  },

  /** 中央大环：三环按完成度扇形 */
  drawBigRing(retry = 1) {
    this.createSelectorQuery().select('#big-ring').boundingClientRect().exec((res) => {
      const rect = res && res[0];
      if (!rect || !rect.width) {
        if (retry > 0) setTimeout(() => this.drawBigRing(retry - 1), 120);
        return;
      }
      this.createSelectorQuery().select('#big-ring').node((n) => {
        const canvas = n && n.node;
        if (!canvas) return;
        const dpr = (wx.getSystemInfoSync().pixelRatio) || 2;
        const W = rect.width;
        canvas.width = W * dpr;
        canvas.height = W * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, W, W);
        const cx = W / 2;
        const cy = W / 2;
        const LW = Math.max(10, W * 0.075);
        const pcts = (this.data.rings || []).map((r) => r.pct);
        const rings = [
          { r: W / 2 - LW * 0.6, color: COLORS.red, dim: COLORS.redDim, pct: pcts[0] || 0 },
          { r: W / 2 - LW * 2, color: COLORS.green, dim: COLORS.greenDim, pct: pcts[1] || 0 },
          { r: W / 2 - LW * 3.4, color: COLORS.cyan, dim: COLORS.cyanDim, pct: pcts[2] || 0 },
        ];
        ctx.lineWidth = LW;
        ctx.lineCap = 'round';
        for (const ring of rings) {
          ctx.beginPath();
          ctx.strokeStyle = ring.dim;
          ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
          ctx.stroke();
          if (ring.pct > 0) {
            ctx.beginPath();
            ctx.strokeStyle = ring.color;
            ctx.arc(cx, cy, ring.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, ring.pct));
            ctx.stroke();
          }
        }
      }).exec();
    });
  },

  /** 顶部本周条点某天 → 切到那天 */
  onPickDay(e) {
    const date = e.currentTarget.dataset.date;
    if (!date || date === this.data.date) return;
    this.load(date);
  },

  goPlan() {
    wx.navigateTo({ url: '/pages/plan/plan' });
  },

  onRetry() {
    this.load(this.data.date);
  },
});
