/**
 * 年度运动报告页
 * 数据源：/overview?from=&to=（年初→年末精确区间，后端零改动）
 * 页面聚合出：年度总评 / 月度距离分解 / 高光时刻（单次最长·最佳配速·最长时长·最大爬升）/ 连续运动天数
 * 支持保存 canvas 海报到相册
 */
const api = require('../../services/api');
const config = require('../../config/index');
const loading = require('../../utils/loading');
const { formatDuration } = require('../../utils/format');

/** 圆角矩形路径 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 逐级缩小字号直到文本宽度 ≤ maxW */
function fitFont(ctx, text, maxW, base, weight) {
  let size = base;
  ctx.font = `${weight} ${size}px sans-serif`;
  while (size > 9 && ctx.measureText(text).width > maxW) {
    size -= 1;
    ctx.font = `${weight} ${size}px sans-serif`;
  }
}

Page({
  data: {
    year: new Date().getFullYear(), // 展示年份
    canGoNext: false, // 未来年份不可翻
    loading: true,
    hasData: false,
    summary: null, // { count, distanceKm, durationText, activeDays, elevationGain, calories }
    chartData: [], // 月度距离 [{label:'1月', value:km}]
    highlights: [], // [{ key, label, value, sub, id }]
    milestones: [], // 今年新解锁 [{icon, text, date}]
    streakDays: 0, // 最长连续运动天数
    posterVisible: false,
    posterPath: '',
    saving: false,
  },

  onLoad() {
    this.fetch();
  },

  onPrevYear() {
    this.setData({ year: this.data.year - 1, canGoNext: true });
    this.fetch();
  },

  onNextYear() {
    if (this.data.year >= new Date().getFullYear()) return;
    const year = this.data.year + 1;
    this.setData({ year, canGoNext: year >= new Date().getFullYear() });
    this.fetch();
  },

  /** 年份区间 [from, to)（本地时区自然年） */
  yearRange(year) {
    return {
      from: new Date(year, 0, 1).getTime(),
      to: new Date(year + 1, 0, 1).getTime(),
    };
  },

  async fetch() {
    const app = getApp();
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
      const r = this.yearRange(this.data.year);
      const [o, milestones] = await Promise.all([
        api.get(`/overview?from=${r.from}&to=${r.to}`),
        api.get(`/stats/year-milestones?year=${this.data.year}`).catch(() => null),
      ]);
      const tracks = o.tracks || [];
      this.setData(this.buildReport(tracks, o));
      this.setData({ milestones: this.buildMilestones(milestones) });
    } catch (e) {
      console.error('加载年度报告失败', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 年度数据聚合：总评 / 月度柱状 / 高光时刻 / 连续天数 */
  buildReport(tracks, o) {
    const hasData = (o.count || 0) > 0;
    if (!hasData) return { hasData, summary: null, chartData: [], highlights: [], streakDays: 0 };

    // 活跃天数（不同日期）
    const daySet = new Set(tracks.map((t) => this.dayKey(t.startTime)));
    const activeDays = daySet.size;

    // 月度距离分解（km）
    const monthKm = new Array(12).fill(0);
    tracks.forEach((t) => {
      const d = new Date(t.startTime);
      if (!isNaN(d.getTime())) monthKm[d.getMonth()] += (t.distance || 0) / 1000;
    });
    const chartData = monthKm.map((km, i) => ({
      label: `${i + 1}月`,
      value: Math.round(km * 10) / 10,
    }));

    // 高光时刻（按年度数据计算，avgPace 配速类排除游泳/骑行）
    const withDate = (t) => {
      const d = new Date(t.startTime);
      return `${d.getMonth() + 1}-${d.getDate()}`;
    };
    const best = (arr, fn) => arr.reduce((a, b) => (fn(b) > fn(a) ? b : a), arr[0]);
    const bestPacePool = tracks.filter(
      (t) => t.avgPace > 0 && !['swimming', 'cycling'].includes(t.type),
    );
    const highlights = [];
    if (tracks.length) {
      const bd = best(tracks, (t) => t.distance || 0);
      highlights.push({
        key: 'distance',
        label: '单次最长距离',
        value: `${((bd.distance || 0) / 1000).toFixed(1)} 公里`,
        sub: withDate(bd),
        id: bd.id,
      });
      if (bestPacePool.length) {
        const bp = best(bestPacePool, (t) => -t.avgPace);
        highlights.push({
          key: 'pace',
          label: '最佳配速',
          value: formatPaceShort(bp.avgPace),
          sub: withDate(bp),
          id: bp.id,
        });
      }
      const bdu = best(tracks, (t) => t.duration || 0);
      highlights.push({
        key: 'duration',
        label: '单次最长时长',
        value: formatDuration(bdu.duration || 0),
        sub: withDate(bdu),
        id: bdu.id,
      });
      const be = best(tracks, (t) => t.elevationGain || 0);
      if ((be.elevationGain || 0) > 0) {
        highlights.push({
          key: 'elevation',
          label: '单次最大爬升',
          value: `${Math.round(be.elevationGain)} 米`,
          sub: withDate(be),
          id: be.id,
        });
      }
    }

    // 最长连续运动天数
    const days = Array.from(daySet)
      .map((k) => Math.floor(new Date(k).getTime() / 86400000))
      .sort((a, b) => a - b);
    let streak = 0;
    let run = 0;
    for (let i = 0; i < days.length; i++) {
      run = i > 0 && days[i] === days[i - 1] + 1 ? run + 1 : 1;
      streak = Math.max(streak, run);
    }

    return {
      hasData,
      summary: {
        count: o.count || 0,
        distanceKm: (o.totalDistanceKm || 0).toFixed(1),
        durationText: durText(o.totalDurationSec || 0),
        activeDays,
        elevationGain: Math.round(o.totalElevationGain || 0),
        calories: Math.round(o.totalCalories || 0),
      },
      chartData,
      highlights,
      streakDays: streak,
    };
  },

  /** 里程碑合并渲染：省/市/类型按首次时间排序 */
  buildMilestones(m) {
    if (!m) return [];
    const items = [];
    (m.newProvinces || []).forEach((p) =>
      items.push({ icon: '🗺️', text: `首次点亮 ${p.name}`, firstAt: p.firstAt }),
    );
    (m.newCities || []).forEach((c) =>
      items.push({ icon: '🏙️', text: `首次打卡 ${c.name}（${c.province}）`, firstAt: c.firstAt }),
    );
    (m.newTypes || []).forEach((t) => {
      const meta = config.ACTIVITY_TYPES.find((x) => x.type === t.name) || {};
      items.push({
        icon: meta.icon || '🏃',
        text: `首次尝试${meta.label || t.name}${t.countInYear ? ` · ${t.countInYear} 次` : ''}`,
        firstAt: t.firstAt,
      });
    });
    items.sort((a, b) => a.firstAt - b.firstAt);
    return items.map((it) => ({ icon: it.icon, text: it.text, date: this.md(it.firstAt) }));
  },

  md(ts) {
    const d = new Date(ts);
    return `${d.getMonth() + 1}-${d.getDate()}`;
  },

  dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  },

  /** 高光 → 轨迹详情 */
  onTapHighlight(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/track-detail/track-detail?id=${id}` });
  },

  // ==================== 海报（canvas 2d 自绘） ====================

  async openPoster() {
    if (!this.data.hasData) return;
    this.setData({ posterVisible: true, posterPath: '' });
    loading.show('生成海报…');
    try {
      await new Promise((r) => setTimeout(r, 150)); // 等弹窗渲染出 canvas
      const res = await new Promise((resolve, reject) => {
        wx.createSelectorQuery()
          .in(this)
          .select('#yearPoster')
          .fields({ node: true, size: true })
          .exec((q) => (q && q[0] && q[0].node ? resolve(q[0]) : reject(new Error('canvas 不存在'))));
      });
      this._canvasNode = res.node;
      const { width, height } = res;
      const ctx = res.node.getContext('2d');
      const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2) || 2;
      res.node.width = width * dpr;
      res.node.height = height * dpr;
      ctx.scale(dpr, dpr);
      this.drawPoster(ctx, width, height);
      const path = await new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({ canvas: this._canvasNode, success: (r2) => resolve(r2.tempFilePath), fail: reject });
      });
      this.setData({ posterPath: path });
      loading.hide();
    } catch (e) {
      loading.hide();
      console.error('[year-report] 海报生成失败', e);
      wx.showToast({ title: '海报生成失败', icon: 'none' });
    }
  },

  drawPoster(ctx, W, H) {
    const s = this.data.summary;
    const ink = '#1f2329';
    const muted = 'rgba(31,35,41,0.62)';
    const accent = '#2b6cf6';
    const cardBg = '#f5f7fb';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // 顶部品牌色带（渐变、圆角内缩）
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#2b6cf6');
    grad.addColorStop(1, '#6a9bff');
    ctx.fillStyle = grad;
    roundRect(ctx, 12, 12, W - 24, 80, 14);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = '11px sans-serif';
    ctx.fillText('小迹一下 · 年度运动报告', W / 2, 40);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(`${this.data.year} 年`, W / 2, 70);

    // 主指标：总距离（数字 + 单位整体居中）
    ctx.fillStyle = accent;
    ctx.font = 'bold 42px sans-serif';
    const numW = ctx.measureText(`${s.distanceKm}`).width;
    ctx.font = '13px sans-serif';
    const unitW = ctx.measureText('公里').width;
    const startX = W / 2 - (numW + 4 + unitW) / 2;
    ctx.fillStyle = accent;
    ctx.font = 'bold 42px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${s.distanceKm}`, startX, 144);
    ctx.fillStyle = muted;
    ctx.font = '13px sans-serif';
    ctx.fillText('公里', startX + numW + 4, 144);
    ctx.textAlign = 'center';
    ctx.fillStyle = muted;
    ctx.font = '11px sans-serif';
    ctx.fillText('累计里程', W / 2, 164);

    // 数据卡 × 4
    const cols = [
      { v: `${s.count}`, l: '运动次数' },
      { v: s.durationText, l: '总时长' },
      { v: `${s.activeDays}`, l: '活跃天数' },
      { v: `${this.data.streakDays}天`, l: '最长连续' },
    ];
    const cardW = (W - 24 * 2 - 10 * 3) / 4;
    const cardY = 188;
    cols.forEach((c, i) => {
      const x = 24 + i * (cardW + 10);
      ctx.fillStyle = cardBg;
      roundRect(ctx, x, cardY, cardW, 52, 10);
      ctx.fill();
      ctx.fillStyle = ink;
      fitFont(ctx, c.v, cardW - 8, 14, 'bold');
      ctx.fillText(c.v, x + cardW / 2, cardY + 22);
      ctx.fillStyle = muted;
      ctx.font = '9px sans-serif';
      ctx.fillText(c.l, x + cardW / 2, cardY + 40);
    });

    // 月度柱状（12 根，柱顶标数值）
    ctx.fillStyle = muted;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('月度运动距离（公里）', 24, 272);
    ctx.textAlign = 'center';
    const chartTop = 282;
    const chartH = 84;
    const barW = 12;
    const gap = (W - 24 * 2 - 12 * barW) / 11;
    const maxKm = Math.max(...this.data.chartData.map((c) => c.value), 1);
    this.data.chartData.forEach((c, i) => {
      const h = Math.max(c.value > 0 ? 4 : 2, (c.value / maxKm) * chartH);
      const x = 24 + i * (barW + gap);
      ctx.fillStyle = c.value > 0 ? accent : '#eef0f3';
      ctx.fillRect(x, chartTop + chartH - h, barW, h);
      if (c.value > 0) {
        ctx.fillStyle = accent;
        ctx.font = '7px sans-serif';
        ctx.fillText(c.value >= 10 ? String(Math.round(c.value)) : c.value.toFixed(1), x + barW / 2, chartTop + chartH - h - 3);
      }
      if (i === 0 || i === 5 || i === 11) {
        ctx.fillStyle = muted;
        ctx.font = '10px sans-serif';
        ctx.fillText(c.label, x + barW / 2, chartTop + chartH + 14);
      }
    });

    // 品牌行：左昵称 + 右 @小迹一下
    const u = getApp().globalData.userInfo;
    const nick = (u && u.nickname) || '';
    ctx.font = '10px sans-serif';
    ctx.fillStyle = muted;
    if (nick) {
      ctx.textAlign = 'left';
      ctx.fillText(nick, 24, H - 14);
    }
    ctx.textAlign = 'right';
    ctx.fillText('@小迹一下', W - 24, H - 14);
  },

  async savePoster() {
    if (this.data.saving || !this.data.posterPath) return;
    this.setData({ saving: true });
    wx.saveImageToPhotosAlbum({
      filePath: this.data.posterPath,
      success: () => {
        this.setData({ posterVisible: false, saving: false });
        wx.showToast({ title: '已保存到相册', icon: 'success' });
      },
      fail: (e) => {
        this.setData({ saving: false });
        if (String(e.errMsg || '').includes('auth deny') || String(e.errMsg || '').includes('authorize')) {
          wx.showModal({
            title: '需要相册权限',
            content: '请允许保存图片到相册',
            confirmText: '去设置',
            success: (r) => {
              if (r.confirm) wx.openSetting();
            },
          });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      },
    });
  },

  closePoster() {
    this.setData({ posterVisible: false });
  },

  noop() {},
});

/** 秒 → "h'mm"" 短配速（海报/高光用） */
function formatPaceShort(secPerKm) {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}'${String(s).padStart(2, '0')}"`;
}

/** 秒 → 45分钟 / 3.2小时（总时长） */
function durText(sec) {
  const min = sec / 60;
  if (min < 60) return `${Math.round(min)}分钟`;
  return `${(min / 60).toFixed(1)}小时`;
}
