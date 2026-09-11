/**
 * 运动报告页：周/月/年/全部维度
 * 汇总 → 个人最佳 → 轨迹列表
 */
const api = require('../../services/api');
const loading = require('../../utils/loading');
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

/** 周期文案：周 → "0907至0913"（跨年 20251231至20260106），月 → "2026年8月"，年 → "2025年" */
function periodLabel(range, p) {
  const md = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  if (range === 'week') {
    const start = new Date(p.from);
    const last = new Date(p.to - 1);
    const yd = (d) => `${d.getFullYear()}${md(d)}`;
    return start.getFullYear() === last.getFullYear() ? `${md(start)}至${md(last)}` : `${yd(start)}至${yd(last)}`;
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
    typeSummary: [], // 分类型汇总（各类型总距离/总时长/次数）
    dateSummary: [], // 日期汇总（按当前维度日期桶聚合：次数/距离/时长/千卡）
    dateSummaryTitle: '', // 桶粒度文案：按天/按周/按月/按半年（后端下发）
    dateBucketLabel: '', // 桶列头：日期/星期/月份/半年
    compare: [], // 周期对比（当前周期 vs 上一周期）
    loading: true,
    showPeriodPicker: false, // 周期选择弹窗
    periodOptions: [], // 弹窗选项 [{offset, label, selected}]
    pickerScrollInto: '', // 弹窗滚动定位到当前周期
    posterVisible: false, // 周期海报预览弹窗
    posterCanvasH: 380, // 海报 canvas 高度（随分类汇总行数动态撑高）
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

  /** 查询参数：全部用 range，其余用精确 epoch ms 区间（后端按自然周期查）；报告页只需元数据，走 lean 模式
   *  dateSummary=1：由后端按 range 粒度分桶返回日期汇总（周→按天 / 月→按自然周 / 年→按月 / 全部→按半年）
   *  精确区间也必须带 range，后端据此决定分桶粒度 */
  buildOverviewQuery() {
    if (this.data.activeRange === 'all' || !this._period) return 'range=all&lean=1&dateSummary=1';
    return `range=${this.data.activeRange}&from=${this._period.from}&to=${this._period.to}&lean=1&dateSummary=1`;
  },

  // ==================== 周期海报（周/月/年，canvas 自绘） ====================

  /** 打开海报预览弹窗并绘制 */
  async openPoster() {
    if (!this.data.summary || this.data.activeRange === 'all') return;
    // 海报高度随分类汇总行数动态撑高（无分类数据则保持原尺寸）
    const rowsCount = (this.data.typeSummary || []).length;
    const posterH = rowsCount > 0 ? 372 + rowsCount * 26 + 38 : 380;
    this.setData({
      posterVisible: true,
      posterPath: '',
      posterCanvasH: posterH,
    });
    loading.show('生成海报…');
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
      const ctx = res.node.getContext('2d');
      const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2) || 2;
      // 用计算好的 posterH 设置像素尺寸（不用 res.size：setData 后查询可能拿到旧高度导致表格被裁）
      res.node.width = 300 * dpr;
      res.node.height = posterH * dpr;
      ctx.scale(dpr, dpr);
      this.drawPeriodPoster(ctx, 300, posterH);
      const path = await new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({ canvas: this._canvasNode, success: (r) => resolve(r.tempFilePath), fail: reject });
      });
      this.setData({ posterPath: path });
      loading.hide();
    } catch (e) {
      loading.hide();
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

    // 主指标：「总距离」标签 + 数字 + 单位同行，整体居中（标签在左侧）
    ctx.font = 'bold 42px sans-serif';
    const numW = ctx.measureText(`${s.distanceKm}`).width;
    ctx.font = '13px sans-serif';
    const labelW = ctx.measureText('总距离').width;
    const unitW = ctx.measureText('公里').width;
    const gap = 8;
    const startX = W / 2 - (labelW + gap + numW + 4 + unitW) / 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = muted;
    ctx.fillText('总距离', startX, 142);
    ctx.fillStyle = accent;
    ctx.font = 'bold 42px sans-serif';
    ctx.fillText(`${s.distanceKm}`, startX + labelW + gap, 142);
    ctx.fillStyle = muted;
    ctx.font = '13px sans-serif';
    ctx.fillText('公里', startX + labelW + gap + numW + 4, 142);
    ctx.textAlign = 'center';

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

    // 分类汇总表（按距离降序，全量行数，高度已在 openPoster 按行数撑高）
    const rows = this.data.typeSummary || [];
    if (rows.length > 0) {
      const dotColors = ['#2B6CF6', '#34A853', '#FF9800', '#9C27B0', '#00A6C0', '#E34D59', '#13C2C2', '#722ED1'];
      let y = 336;
      ctx.textAlign = 'left';
      ctx.fillStyle = ink;
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('分类汇总', 24, y);
      y += 14;
      // 表头
      ctx.fillStyle = cardBg;
      roundRect(ctx, 24, y, W - 48, 22, 8);
      ctx.fill();
      ctx.fillStyle = muted;
      ctx.font = '10px sans-serif';
      ctx.fillText('类型', 40, y + 15);
      ctx.textAlign = 'right';
      ctx.fillText('次数', 150, y + 15);
      ctx.fillText('距离(km)', 210, y + 15);
      ctx.fillText('时长', 276, y + 15);
      y += 22;
      rows.forEach((r, i) => {
        const rowH = 26;
        const cy = y + rowH / 2;
        ctx.textAlign = 'left';
        ctx.fillStyle = dotColors[i % dotColors.length];
        ctx.beginPath();
        ctx.arc(32, cy - 4, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = ink;
        ctx.font = '11px sans-serif';
        const label = r.typeLabel.length > 6 ? `${r.typeLabel.slice(0, 6)}…` : r.typeLabel;
        ctx.fillText(label, 40, cy);
        ctx.textAlign = 'right';
        ctx.fillText(String(r.count), 150, cy);
        ctx.fillText(r.distanceKm, 210, cy);
        ctx.fillText(r.durationText, 276, cy);
        if (i < rows.length - 1) {
          ctx.strokeStyle = 'rgba(31,35,41,0.08)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(28, y + rowH);
          ctx.lineTo(W - 28, y + rowH);
          ctx.stroke();
        }
        y += rowH;
      });
    }

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
    return `from=${prev.from}&to=${prev.to}&lean=1`;
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
      // 日期汇总改由后端按东八区分桶下发（避免前端日期运算出错）
      const ds = overview.dateSummary || { title: '', label: '', rows: [] };
      this.setData({
        summary: this.buildSummary(overview),
        best: this.decorateBest(best),
        typeSummary: this.buildTypeSummary(overview.tracks || []),
        dateSummary: (ds.rows || []).map((r) => ({
          key: r.key,
          label: r.label,
          count: r.count,
          distanceKm: (r.distance / 1000).toFixed(1),
          durationText: durText(r.duration),
          kcal: Math.round(r.calories || 0),
        })),
        dateSummaryTitle: ds.title,
        dateBucketLabel: ds.label,
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
    // 活跃天数：按设备本地自然日去重（不能用 ISO 串 slice(0,10)——那是 UTC 日期，东八区凌晨轨迹会算到前一天）
    const dayKey = (t) => {
      const d = new Date(t.startTime);
      return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    };
    const days = new Set((o.tracks || []).map(dayKey)).size;
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

  /** 分类型汇总：当前周期各类型总距离/总时长/次数（按总距离降序） */
  buildTypeSummary(tracks) {
    const TYPE_META = config.ACTIVITY_TYPES || [];
    const map = new Map();
    (tracks || []).forEach((t) => {
      const cur = map.get(t.type) || { type: t.type, count: 0, distance: 0, duration: 0 };
      cur.count += 1;
      cur.distance += t.distance || 0;
      cur.duration += t.duration || 0;
      map.set(t.type, cur);
    });
    return Array.from(map.values())
      .sort((a, b) => b.distance - a.distance)
      .map((r) => {
        const meta = TYPE_META.find((x) => x.type === r.type) || {};
        return {
          type: r.type,
          typeLabel: meta.label || r.type,
          typeIcon: meta.iconImg || '',
          count: r.count,
          distanceKm: (r.distance / 1000).toFixed(1),
          durationText: formatDuration(r.duration),
        };
      });
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
    put(b.minPaceByType, 'minPace', (r) => formatPace(r.fastestKm));
    put(b.maxDurationByType, 'maxDuration', (r) => formatDuration(r.duration));
    put(b.maxElevationByType, 'maxElevation', (r) => `${r.elevationGain}m`);
    return { bestTable: Object.keys(rowsMap).sort().map((t) => rowsMap[t]) };
  },

});
