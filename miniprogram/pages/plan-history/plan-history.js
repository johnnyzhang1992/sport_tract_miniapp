/**
 * 计划历史（月历）：参照 Apple 健身的月历三环。
 * - 月历每格画一个迷你三环（红=距离/绿=时间/青=次数，按完成度扇形），三项全达成的日子带绿点
 * - 点某天进单日详情；本月涉及的「每周」计划记录单独列在月历下方
 * - 右上角「更改计划」进计划设置页
 * 数据：GET /plan/calendar?month=YYYY-MM（有快照用快照，当期实时聚合）
 */
const api = require('../../services/api');
const { bjParts } = require('../../utils/bj-date');
const config = require('../../config/index');

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
    /** 当前周期概况：{ periodText, achieved, metrics, remainText }（未选中日期时展示） */
    current: null,
    /** 记录数据概况 + 里程碑奖杯（GET /plan/summary） */
    summary: null,
    /** 是否已有计划：右上角据此显示「更改计划」或「创建计划」 */
    hasPlan: false,
    /** 创建/更改计划半屏 */
    sheetVisible: false,
    planForSheet: null,
    /** 选中的日期与当日详情（点日历某天后在下方就地展开，不再跳页） */
    selectedDate: '',
    selected: null,
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

  onReady() {
    // 首帧布局就绪后补画一次：draw 内部有重试，这里兜住更极端的时序
    this.draw();
  },

  onShow() {
    // 从半屏/其他页回来：历史进度可能变化，静默重拉并重绘
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
      // 并行拉当前周期进度（概况卡用），失败不影响月历
      const [res, cur, sum] = await Promise.all([
        api.get(`/plan/calendar?month=${month}`),
        api.get('/plan/current').catch(() => null),
        api.get('/plan/summary').catch(() => null),
      ]);
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

      this.setData({
        cells,
        weeks,
        current: this.buildCurrent(cur),
        hasPlan: !!(cur && cur.plan),
        planForSheet: (cur && cur.plan) || null,
        summary: this.buildSummary(sum),
        loading: false,
      }, () => this.draw());
      this._loaded = true;
    } catch (e) {
      this.setData({ loading: false, failed: true });
    }
  },

  /** 记录数据概况 + 奖杯：里程碑固定档位，未解锁也占位（与统计页奖杯墙同款口径） */
  buildSummary(sum) {
    if (!sum) return null;
    const km = (m) => (Math.round((Number(m) || 0) / 100) / 10).toFixed(1);
    const hours = (sec) => {
      const s2 = Number(sec) || 0;
      if (s2 < 3600) return `${Math.round(s2 / 60)} 分钟`;
      return `${(Math.round((s2 / 3600) * 10) / 10).toFixed(1)} 小时`;
    };
    return {
      cards: [
        { key: 'periods', num: String(sum.totalPeriods || 0), cap: '已完成周期' },
        { key: 'achieved', num: String(sum.achievedPeriods || 0), cap: '达成次数' },
        { key: 'rate', num: `${Math.round((sum.rate || 0) * 100)}%`, cap: '达成率' },
        { key: 'streak', num: String((sum.streak && sum.streak.current) || 0), cap: '连续达成' },
      ],
      totalsText: `累计 ${km(sum.totals && sum.totals.distanceM)} km · ${hours(sum.totals && sum.totals.durationSec)} · ${(sum.totals && sum.totals.count) || 0} 次运动`,
      bestStreakText: `最佳连续 ${(sum.streak && sum.streak.best) || 0} 次`,
      trophies: (sum.milestones || []).map((m) => ({
        key: m.key,
        label: m.label,
        desc: m.desc,
        unlocked: !!m.unlocked,
        progressText: m.unlocked ? '已解锁' : `${m.cur}/${m.need}`,
      })),
    };
  },

  /** 当前周期概况：三项当前/目标 + 百分比 + 剩余 */
  buildCurrent(cur) {
    if (!cur || !cur.plan) return null;
    const byKey = {};
    for (const r of cur.rings || []) byKey[r.key] = r;
    const dist = byKey.distance || { value: 0, target: 0, pct: 0 };
    const dur = byKey.duration || { value: 0, target: 0, pct: 0 };
    const cnt = byKey.count || { value: 0, target: 0, pct: 0 };
    const km = (m) => (Math.round((Number(m) || 0) / 100) / 10).toFixed(1);
    const min = (sec) => String(Math.round((Number(sec) || 0) / 60));
    const remainOf = (value, target, fmt) => Math.max(0, target - value);
    const remain = [
      remainOf(dist.value, dist.target) > 0 ? `${km(remainOf(dist.value, dist.target))} km` : '',
      remainOf(dur.value, dur.target) > 0 ? `${min(remainOf(dur.value, dur.target))} 分钟` : '',
      remainOf(cnt.value, cnt.target) > 0 ? `${remainOf(cnt.value, cnt.target)} 次` : '',
    ].filter(Boolean);
    return {
      periodText: cur.plan.period === 'weekly' ? '本周' : '今天',
      achieved: remain.length === 0,
      metrics: [
        { key: 'distance', label: '距离', dot: 'red', cur: km(dist.value), target: km(dist.target), unit: 'km', pct: Math.round((dist.pct || 0) * 100) },
        { key: 'duration', label: '时间', dot: 'green', cur: min(dur.value), target: min(dur.target), unit: '分钟', pct: Math.round((dur.pct || 0) * 100) },
        { key: 'count', label: '次数', dot: 'cyan', cur: String(cnt.value), target: String(cnt.target), unit: '次', pct: Math.round((cnt.pct || 0) * 100) },
      ],
      remainText: remain.length ? `还差 ${remain.join(' · ')}` : '本期目标已全部达成',
    };
  },

  /** 把整月的「日期数字 + 迷你三环 + 今天圈 + 达成点」一次画在一张 canvas 上
   *  （数字与环必须同一坐标系，否则会出现数字与环错行） */
  draw(attempt = 0) {
    // 每次绘制领一个令牌：并发/过期请求回来后直接丢弃，避免旧数据覆盖新画布
    const token = (this._drawToken = (this._drawToken || 0) + 1);
    const q = this.createSelectorQuery();
    q.select('#cal-canvas').boundingClientRect();
    q.select('#cal-canvas').node();
    q.exec((res) => {
      if (this._drawToken !== token) return;
      const rect = res && res[0];
      const canvas = res && res[1] && res[1].node;
      const cells = this.data.cells || [];
      /**
       * 为什么需要重试：进页首帧里 canvas 节点/布局往往还没就绪（rect.width=0 或 node 为 null），
       * 之前 node 拿不到就直接 return，于是偶发「日历空白」且不会再画。
       * 这里统一短间隔重试（最多 10 次 ≈ 800ms），并跳过空数据态。
       */
      if (!canvas || !rect || !rect.width || cells.length === 0) {
        if (attempt < 10) {
          setTimeout(() => {
            if (this._drawToken === token) this.draw(attempt + 1);
          }, 80);
        }
        return;
      }
      {
        const dpr = (wx.getSystemInfoSync().pixelRatio) || 2;
        const W = rect.width;
        const colW = W / 7;
        const rowH = colW * 1.05;
        const rows = Math.ceil(cells.length / 7);
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
      }
    });
  },

  /** 点某天（透明点击层）→ 在日历下方就地展示当日数据（不再跳页） */
  onCellTap(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    if (date === this.data.selectedDate) { // 再点一次收起，回到当前周期概况
      this.clearSelected();
      return;
    }
    this.loadDay(date);
  },

  /** 加载某天详情（三项 + 当天轨迹），失败只清空详情、不影响月历 */
  async loadDay(date) {
    const p = bjParts(Date.parse(`${date}T00:00:00+08:00`));
    this.setData({
      selectedDate: date,
      selected: { date, title: `${p.m}月${p.d}日 · 周${WEEK_CN[p.dow]}`, loading: true, achieved: false, metrics: [], tracks: [], failed: false },
    });
    try {
      const d = await api.get(`/plan/day?date=${date}`);
      if (this.data.selectedDate !== date) return; // 快速连点：只认最后一次
      const byKey = {};
      for (const r of d.rings || []) byKey[r.key] = r;
      const dist = byKey.distance || { value: 0, target: 0, pct: 0 };
      const dur = byKey.duration || { value: 0, target: 0, pct: 0 };
      const cnt = byKey.count || { value: 0, target: 0, pct: 0 };
      const km = (m) => (Math.round((Number(m) || 0) / 100) / 10).toFixed(1);
      const min = (sec) => String(Math.round((Number(sec) || 0) / 60));
      this.setData({
        selected: {
          date,
          title: `${p.m}月${p.d}日 · 周${WEEK_CN[p.dow]}`,
          loading: false,
          achieved: !!d.allAchieved,
          metrics: [
            { key: 'distance', label: '距离', dot: 'red', cur: km(dist.value), target: km(dist.target), unit: 'km', pct: Math.round((dist.pct || 0) * 100) },
            { key: 'duration', label: '时间', dot: 'green', cur: min(dur.value), target: min(dur.target), unit: '分钟', pct: Math.round((dur.pct || 0) * 100) },
            { key: 'count', label: '次数', dot: 'cyan', cur: String(cnt.value), target: String(cnt.target), unit: '次', pct: Math.round((cnt.pct || 0) * 100) },
          ],
          tracks: (d.tracks || []).map((t) => {
            const meta = (config.ACTIVITY_TYPES || []).find((x) => x.type === t.type) || {};
            const tt = new Date(t.startTime + 8 * 3600_000);
            return {
              id: t.id,
              icon: meta.icon || '🏃',
              label: meta.label || '运动',
              distText: `${km(t.distanceM)} km`,
              durText: `${min(t.durationSec)} 分钟`,
              timeText: `${String(tt.getUTCHours()).padStart(2, '0')}:${String(tt.getUTCMinutes()).padStart(2, '0')}`,
            };
          }),
          failed: false,
        },
      });
    } catch (e) {
      if (this.data.selectedDate !== date) return;
      this.setData({ selected: Object.assign({}, this.data.selected, { loading: false, failed: true }) });
    }
  },

  /** 收起当日详情，回到当前周期概况 */
  clearSelected() {
    this.setData({ selectedDate: '', selected: null });
  },

  /** 兜底：直接点 canvas 时按坐标反推日期（当前 wxml 用透明点击层，保留以防改回） */
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
      this.loadDay(cell.date);
    });
  },

  /** 右上角：打开「创建/更改计划」半屏（不再跳页面） */
  openPlanSheet() {
    this.setData({ sheetVisible: true });
  },

  closePlanSheet() {
    this.setData({ sheetVisible: false }, () => this.draw());
  },

  /** 半屏保存成功 → 收起并重拉（月历/概况/奖杯一起刷新） */
  onPlanSaved() {
    this.setData({ sheetVisible: false }, () => this.draw());
    this.load();
  },

  onRetry() {
    this.load();
  },
});
