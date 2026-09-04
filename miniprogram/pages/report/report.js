/**
 * 运动报告页：周/月/年/全部维度
 * 汇总 → 个人最佳 → 轨迹列表
 */
const api = require('../../services/api');
const config = require('../../config/index');
const { formatDuration, formatPace, formatDurationStat } = require('../../utils/format');
const { calcDiff } = require('../../utils/diff');

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

/** 周期选择弹窗：每个粒度展示最近 N 个周期 */
const PICKER_COUNT = { week: 24, month: 12, year: 5 };

/** 周/月/年周期区间 [from, to)（自然周周一起算/自然月/自然年），offset 为往前的周期数（0=当前周期） */
function periodRange(range, offset) {
  const now = new Date();
  if (range === 'week') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    start.setDate(start.getDate() - offset * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { from: start.getTime(), to: end.getTime() };
  }
  if (range === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - offset + 1, 1);
    return { from: start.getTime(), to: end.getTime() };
  }
  const start = new Date(now.getFullYear() - offset, 0, 1);
  const end = new Date(now.getFullYear() - offset + 1, 0, 1);
  return { from: start.getTime(), to: end.getTime() };
}

/** 周期文案：周 → "8-31 - 9-6"（跨年带年份），月 → "2026年8月"，年 → "2025年" */
function periodLabel(range, p) {
  const md = (d) => `${d.getMonth() + 1}-${d.getDate()}`;
  if (range === 'week') {
    const start = new Date(p.from);
    const last = new Date(p.to - 1);
    const yd = (d) => `${d.getFullYear()}-${md(d)}`;
    return start.getFullYear() === last.getFullYear() ? `${md(start)} 至 ${md(last)}` : `${yd(start)} 至 ${yd(last)}`;
  }
  const start = new Date(p.from);
  return range === 'month' ? `${start.getFullYear()}年${start.getMonth() + 1}月` : `${start.getFullYear()}年`;
}

Page({
  data: {
    ranges: RANGES,
    activeRange: 'week',
    year: new Date().getFullYear(), // 年度报告入口年份
    periodOffset: 0, // 往前的周期数（0=当前周/月/年）
    periodLabel: '',
    canGoNext: false,
    summary: null, // 汇总
    best: null, // 个人最佳
    tracks: [], // 轨迹列表（卡片）
    compare: [], // 周期对比（当前周期 vs 上一周期）
    loading: true,
    showPeriodPicker: false, // 周期选择弹窗
    periodOptions: [], // 弹窗选项 [{offset, label, selected}]
    pickerScrollInto: '', // 弹窗滚动定位到当前周期
    posterVisible: false, // 周期海报预览弹窗
    posterPath: '',
    saving: false,
  },

  onLoad(options) {
    if (options.range) this.setData({ activeRange: options.range });
    this.applyPeriod();
    this.fetch();
  },

  onRangeChange(e) {
    const value = e.currentTarget.dataset.value;
    if (value === this.data.activeRange) return;
    this.setData({ activeRange: value, periodOffset: 0 });
    this.applyPeriod();
    this.fetch();
  },

  /** 翻到上一周期（更早） */
  onPrevPeriod() {
    this.setData({ periodOffset: this.data.periodOffset + 1 });
    this.applyPeriod();
    this.fetch();
  },

  /** 翻回下一周期（到当前周期后不可再翻） */
  onNextPeriod() {
    if (this.data.periodOffset <= 0) return;
    this.setData({ periodOffset: this.data.periodOffset - 1 });
    this.applyPeriod();
    this.fetch();
  },

  /** 根据当前 tab + 偏移量计算周期区间与文案（"全部"无周期） */
  applyPeriod() {
    const { activeRange, periodOffset } = this.data;
    if (activeRange === 'all') {
      this._period = null;
      this.setData({ periodLabel: '', canGoNext: false });
      return;
    }
    const p = periodRange(activeRange, periodOffset);
    this._period = p;
    this.setData({ periodLabel: periodLabel(activeRange, p), canGoNext: periodOffset > 0 });
  },

  /** 打开周期选择弹窗：按当前粒度生成最近 N 个周期选项 */
  onTapPeriodLabel() {
    const { activeRange, periodOffset } = this.data;
    if (activeRange === 'all') return;
    const count = PICKER_COUNT[activeRange] || 12;
    const options = [];
    for (let offset = 0; offset < count; offset++) {
      const p = periodRange(activeRange, offset);
      const label = periodLabel(activeRange, p);
      options.push({ offset, label, compact: label.length > 12, selected: offset === periodOffset });
    }
    this.setData({ showPeriodPicker: true, periodOptions: options, pickerScrollInto: '' });
    wx.nextTick(() => {
      this.setData({ pickerScrollInto: `period-${this.data.periodOffset}` });
    });
  },

  onClosePeriodPicker() {
    this.setData({ showPeriodPicker: false });
  },

  /** 阻止弹窗内容点击冒泡到遮罩 */
  noop() {},

  /** 点击弹窗选项：直接切换周期 */
  onSelectPeriod(e) {
    const offset = Number(e.currentTarget.dataset.offset);
    this.setData({ showPeriodPicker: false });
    if (offset === this.data.periodOffset) return;
    this.setData({ periodOffset: offset });
    this.applyPeriod();
    this.fetch();
  },

  /** 打开年度运动报告（全年回顾 + 海报） */
  goYearReport() {
    wx.navigateTo({ url: '/pages/year-report/year-report' });
  },

  /** 查询参数：全部用 range，其余用精确 epoch ms 区间（后端按自然周期查） */
  buildOverviewQuery() {
    if (this.data.activeRange === 'all' || !this._period) return 'range=all';
    return `from=${this._period.from}&to=${this._period.to}`;
  },

  // ==================== 周期海报（周/月/年，canvas 自绘） ====================

  /** 打开海报预览弹窗并绘制 */
  async openPoster() {
    if (!this.data.summary || this.data.activeRange === 'all') return;
    this.setData({ posterVisible: true, posterPath: '' });
    wx.showLoading({ title: '生成海报…' });
    try {
      await new Promise((r) => setTimeout(r, 150)); // 等弹窗渲染出 canvas
      const res = await new Promise((resolve, reject) => {
        wx.createSelectorQuery()
          .in(this)
          .select('#periodPoster')
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
      this.drawPeriodPoster(ctx, width, height);
      const path = await new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({ canvas: this._canvasNode, success: (r) => resolve(r.tempFilePath), fail: reject });
      });
      this.setData({ posterPath: path });
      wx.hideLoading();
    } catch (e) {
      wx.hideLoading();
      console.error('[report] 海报生成失败', e);
      wx.showToast({ title: '海报生成失败', icon: 'none' });
    }
  },

  drawPeriodPoster(ctx, W, H) {
    const s = this.data.summary;
    const ink = '#1f2329';
    const muted = 'rgba(31,35,41,0.62)';
    const accent = '#2b6cf6';
    const cardBg = '#f5f7fb';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // 顶部品牌色带（渐变、圆角内缩）+ 周期标签
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#2b6cf6');
    grad.addColorStop(1, '#6a9bff');
    ctx.fillStyle = grad;
    roundRect(ctx, 12, 12, W - 24, 76, 14);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = '11px sans-serif';
    ctx.fillText('小迹一下 · 周期运动报告', W / 2, 40);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(this.data.periodLabel, W / 2, 68);

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
    ctx.fillText(`${s.distanceKm}`, startX, 142);
    ctx.fillStyle = muted;
    ctx.font = '13px sans-serif';
    ctx.fillText('公里', startX + numW + 4, 142);
    ctx.textAlign = 'center';
    ctx.fillStyle = muted;
    ctx.font = '11px sans-serif';
    ctx.fillText('总距离', W / 2, 162);

    // 数据卡 × 4
    const cols = [
      { v: `${s.count}`, l: '运动次数' },
      { v: s.durationText, l: '总时长' },
      { v: `${s.activeDays}`, l: '活跃天数' },
      { v: `${s.dailyKm}`, l: '日均公里' },
    ];
    const cardW = (W - 24 * 2 - 10 * 3) / 4;
    const cardY = 184;
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

    // 较上一周期：彩色胶囊
    const items = (this.data.compare[0] && this.data.compare[0].items) || [];
    const byKey = {};
    items.forEach((it) => (byKey[it.key] = it.diff || {}));
    ctx.fillStyle = muted;
    ctx.font = '10px sans-serif';
    ctx.fillText('较上一周期', W / 2, 260);
    const chipW = (W - 24 * 2 - 10 * 2) / 3;
    const chipY = 272;
    const diffCols = [
      { key: 'distance', l: '距离' },
      { key: 'count', l: '次数' },
      { key: 'duration', l: '时长' },
    ];
    diffCols.forEach((c, i) => {
      const d = byKey[c.key] || { text: '—', cls: 'flat' };
      const up = d.cls === 'up';
      const down = d.cls === 'down';
      const x = 24 + i * (chipW + 10);
      ctx.fillStyle = up ? '#e6f6ee' : down ? '#fdecea' : cardBg;
      roundRect(ctx, x, chipY, chipW, 36, 10);
      ctx.fill();
      ctx.fillStyle = up ? '#0f9d63' : down ? '#e34d59' : muted;
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(d.text || '—', x + chipW / 2, chipY + 15);
      ctx.fillStyle = muted;
      ctx.font = '9px sans-serif';
      ctx.fillText(c.l, x + chipW / 2, chipY + 29);
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

  /** 上一周期查询参数：当前周期往前翻一档；"全部"无对比 */
  buildPrevQuery() {
    if (this.data.activeRange === 'all' || !this._period) return null;
    const prev = periodRange(this.data.activeRange, this.data.periodOffset + 1);
    return `from=${prev.from}&to=${prev.to}`;
  },

  /** 周期对比：当前查看周期 vs 上一周期（次数/距离/时长 ±%） */
  buildCompare(cur, prev) {
    if (!prev) return [];
    return [
      {
        label: '较上一周期',
        items: [
          { key: 'count', val: String(cur.count || 0), diff: calcDiff(cur.count || 0, prev.count || 0) },
          { key: 'distance', val: `${(cur.totalDistanceKm || 0).toFixed(1)}km`, diff: calcDiff(cur.totalDistanceKm || 0, prev.totalDistanceKm || 0) },
          { key: 'duration', val: durText(cur.totalDurationSec), diff: calcDiff(cur.totalDurationSec || 0, prev.totalDurationSec || 0) },
        ],
      },
    ];
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
    // 请求序号守卫：快速连续翻页时丢弃过期响应，避免旧数据覆盖新数据
    const seq = (this._fetchSeq = (this._fetchSeq || 0) + 1);
    // 保留旧数据直到新数据到达（避免整页闪空），仅切换 loading 态
    this.setData({ loading: true });
    try {
      const prevQuery = this.buildPrevQuery();
      const reqs = [
        api.get(`/overview?${this.buildOverviewQuery()}`),
        api.get('/stats/best').catch(() => null),
      ];
      // 上一周期数据（"全部"无对比）
      if (prevQuery) reqs.push(api.get(`/overview?${prevQuery}`).catch(() => null));
      const [overview, best, prevOverview] = await Promise.all(reqs);
      if (seq !== this._fetchSeq) return;
      this.setData({
        summary: this.buildSummary(overview),
        best: this.decorateBest(best),
        tracks: this.decorateTracks(overview.tracks || []),
        compare: this.buildCompare(overview, prevOverview || null),
      });
    } catch (e) {
      console.error('加载报告失败', e);
      if (seq === this._fetchSeq) wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      if (seq === this._fetchSeq) this.setData({ loading: false });
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
    // 日均分母：周/月/年按所选周期实际天数；全部按最早轨迹至今
    let dayCount;
    if (this.data.activeRange === 'all') {
      const starts = (o.tracks || [])
        .map((t) => new Date(t.startTime).getTime())
        .filter((t) => t > 0);
      dayCount = starts.length ? Math.max(1, Math.ceil((Date.now() - Math.min(...starts)) / 86400000)) : 365;
    } else {
      dayCount = Math.max(1, Math.round((this._period.to - this._period.from) / 86400000));
    }
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
      return `${d.getMonth() + 1}-${d.getDate()}`;
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
        timeText: `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      };
    });
  },

  /** 进入轨迹详情 */
  onTapTrack(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/track-detail/track-detail?id=${id}` });
  },
});
