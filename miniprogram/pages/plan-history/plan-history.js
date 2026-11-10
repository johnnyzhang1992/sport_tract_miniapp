/**
 * 计划历史（月历）：参照 Apple 健身的月历三环。
 * - 月历每格画一个迷你三环（红=距离/绿=时间/青=次数，按完成度扇形），三项全达成的日子带绿点
 * - 点某天进单日详情；本月涉及的「每周」计划记录单独列在月历下方
 * - 右上角「更改计划」进计划设置页
 * 数据：GET /plan/calendar?month=YYYY-MM（有快照用快照，当期实时聚合）
 */
const api = require('../../services/api');
const { bjParts, bjMid } = require('../../utils/bj-date');

const COLORS = {
  red: '#FA114F', redDim: '#FBD9E4',
  green: '#92E82A', greenDim: '#E6F7D4',
  cyan: '#1AD4E0', cyanDim: '#D5F6F9',
};
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

/** 当前东八区年月 {y, m} */
function bjNowMonth(now = Date.now()) {
  const p = bjParts(now);
  return { y: p.y, m: p.m };
}

/** 该月 1 号是周几（0=周日）→ 月历首格前需要补几个上月尾日 */
function leadingBlanks(y, m) {
  const dow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return (dow + 6) % 7; // 周一起始：周一=0
}

Page({
  data: {
    hitRowH: 48, // 点击层单行高度（draw 时按真实列宽算好下发）
    canvasH: 300, // canvas CSS 高度（必须与内部像素高宽比一致，否则圆环会被拉成椭圆）
    y: 0,
    m: 0,
    monthText: '',
    weekHead: ['一', '二', '三', '四', '五', '六', '日'],
    /** 画布上的日期格：{ date, day, out, today, pct:[a,b,c], done, hasData } */
    cells: [],
    weeks: [],
    loading: true,
    failed: false,
    canvasW: 0,
    canvasH: 0,
  },

  onLoad() {
    const { y, m } = bjNowMonth();
    this.setData({ y, m, monthText: `${y}年${m}月` });
    this.load();
  },

  onShow() {
    // 从计划页改完计划回来：历史进度可能变化，静默重拉
    if (this._loaded) this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  prevMonth() {
    const { y, m } = this.data;
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    this.setData({ y: py, m: pm, monthText: `${py}年${pm}月` });
    this.load();
  },

  nextMonth() {
    const { y, m } = this.data;
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    this.setData({ y: ny, m: nm, monthText: `${ny}年${nm}月` });
    this.load();
  },

  async load() {
    const { y, m } = this.data;
    const month = `${y}-${String(m).padStart(2, '0')}`;
    this.setData({ loading: true, failed: false });
    try {
      const res = await api.get(`/plan/calendar?month=${month}`);
      const days = (res && res.days) || [];
      const byDate = {};
      for (const d of days) byDate[d.date] = d;

      // 组装整月格子（含上月尾巴若干天，只是为了补满首行）
      const cells = [];
      const blanks = leadingBlanks(y, m);
      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const todayStr = (() => { const p = bjParts(Date.now()); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; })();
      for (let i = 0; i < blanks; i += 1) cells.push({ key: `b${i}`, out: true, day: '', pct: [0, 0, 0], done: false });
      for (let d = 1; d <= daysInMonth; d += 1) {
        const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const item = byDate[date];
        cells.push({
          key: date,
          date,
          day: String(d),
          out: false,
          today: date === todayStr,
          pct: item ? item.rings.map((r) => Math.max(0, Math.min(1, Number(r.pct) || 0))) : [0, 0, 0],
          done: !!(item && item.allAchieved),
          hasData: !!(item && item.source !== 'none'),
        });
      }
      // 末尾补齐到整行
      while (cells.length % 7 !== 0) cells.push({ key: `t${cells.length}`, out: true, day: '', pct: [0, 0, 0], done: false });

      const weeks = ((res && res.weeks) || []).map((w) => {
        const s = bjParts(w.windowStart);
        const e = bjParts(w.windowEnd - 1);
        const dist = (w.rings || []).find((r) => r.key === 'distance') || { value: 0, target: 0, pct: 0 };
        return {
          key: `${w.period}:${w.periodKey}`,
          rangeText: `${s.m}月${s.d}日 - ${e.m}月${e.d}日`,
          achieved: !!w.allAchieved,
          distText: `${(Math.round(dist.value / 100) / 10).toFixed(1)}/${(Math.round(dist.target / 100) / 10).toFixed(1)} km`,
          pct: Math.round((dist.pct || 0) * 100),
        };
      });

      this.setData({ cells, weeks, loading: false }, () => this.draw());
      this._loaded = true;
    } catch (e) {
      this.setData({ loading: false, failed: true });
    }
  },

  /** 把整月的「日期数字 + 迷你三环 + 今天圈 + 达成点」一次画在一张 canvas 上
   *  （数字与环必须同一坐标系，否则会出现数字与环错行） */
  draw(retry = 1) {
    this.createSelectorQuery().select('#cal-canvas').boundingClientRect().exec((res) => {
      const rect = res && res[0];
      if (!rect || !rect.width) {
        if (retry > 0) setTimeout(() => this.draw(retry - 1), 120);
        return;
      }
      this.createSelectorQuery().select('#cal-canvas').node((n) => {
        const canvas = n && n.node;
        if (!canvas) return;
        const dpr = (wx.getSystemInfoSync().pixelRatio) || 2;
        const W = rect.width;
        const colW = W / 7;
        const rowH = colW * 1.05;
        const rows = Math.ceil(this.data.cells.length / 7);
        const H = rowH * rows;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, W, H);

        if (Math.abs((this.data.hitRowH || 0) - rowH) > 0.5) this.setData({ hitRowH: rowH });
        if (Math.abs((this.data.canvasH || 0) - H) > 0.5) this.setData({ canvasH: H });
        const numY = rowH * 0.24;      // 数字基线（上移，与环拉开）
        const ringCy = rowH * 0.63;    // 环中心
        const R = Math.min(colW * 0.205, 12); // 外环半径（略收小）
        const rings = [
          { dr: 0, color: COLORS.red, dim: COLORS.redDim },
          { dr: -3.2, color: COLORS.green, dim: COLORS.greenDim },
          { dr: -6.4, color: COLORS.cyan, dim: COLORS.cyanDim },
        ];

        this.data.cells.forEach((c, i) => {
          const cx = (i % 7) * colW + colW / 2;
          const originY = Math.floor(i / 7) * rowH;
          if (c.out) return;

          // 日期数字：今天用蓝色实心圈包住
          ctx.font = `${c.today ? 'bold ' : ''}11px -apple-system, "PingFang SC", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          if (c.today) {
            ctx.beginPath();
            ctx.fillStyle = '#2B6CF6';
            ctx.arc(cx, originY + numY, 8.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
          } else {
            ctx.fillStyle = '#4E5969';
          }
          ctx.fillText(c.day, cx, originY + numY + 0.5);

          // 三环
          const cy = originY + ringCy;
          ctx.lineWidth = 2.4;
          ctx.lineCap = 'round';
          rings.forEach((ring, ri) => {
            const r = R + ring.dr;
            ctx.beginPath();
            ctx.strokeStyle = ring.dim;
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();
            const pct = c.pct[ri] || 0;
            if (pct > 0) {
              ctx.beginPath();
              ctx.strokeStyle = ring.color;
              ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, pct));
              ctx.stroke();
            }
          });

          // 三项全达成：日期数字右侧绿点
          if (c.done) {
            ctx.beginPath();
            ctx.fillStyle = '#7CC93F';
            ctx.arc(cx + 11, originY + numY - 3, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      }).exec();
    });
  },

  /** 点某天（透明点击层）→ 单日详情 */
  onCellTap(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    wx.navigateTo({ url: `/pages/plan-day/plan-day?date=${date}` });
  },

  /** 兜底：直接点 canvas 时按坐标反推日期（当前 wxml 已改用点击层，保留以防改回） */
  onCalTap(e) {
    const touch = (e.detail && e.detail.x != null)
      ? { x: e.detail.x, y: e.detail.y }
      : (e.touches && e.touches[0] ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null);
    if (!touch) return;
    const query = this.createSelectorQuery();
    query.select('#cal-canvas').boundingClientRect();
    query.exec((res) => {
      const rect = res && res[0];
      if (!rect) return;
      const colW = rect.width / 7;
      const rowH = colW * 1.05;
      const col = Math.floor((touch.x - rect.left) / colW);
      const row = Math.floor((touch.y - rect.top) / rowH);
      const idx = row * 7 + col;
      const cell = this.data.cells[idx];
      if (!cell || cell.out || !cell.date) return;
      wx.navigateTo({ url: `/pages/plan-day/plan-day?date=${cell.date}` });
    });
  },

  goPlan() {
    wx.navigateTo({ url: '/pages/plan/plan' });
  },

  onRetry() {
    this.load();
  },
});
