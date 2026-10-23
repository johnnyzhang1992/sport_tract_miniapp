/**
 * stat-chart 图表组件（决策 D8：轻量 Canvas 自绘）
 * - type=bar：柱状图（统计趋势）
 * - type=line：折线图（海拔/配速曲线）
 * - type=multi-line：多系列折线（`series` + `labels`），用于活动累计趋势的「按人 / 按类型」两档
 * - 布局：左侧 Y 轴刻度（min/mid/max）+ 网格线，底部 X 标签（左右留白不裁剪）
 * - 折线图圆滑曲线（中点二次贝塞尔，无数据点圆），最大值标注数值
 */
/** 一个 X 标签的占位：10px 字号下「MM/DD」约 26px，再留 2px 呼吸 */
const LABEL_SLOT_PX = 28;
/** 相邻两格中心至少隔这么远：首格左对齐、末格右对齐，各比居中多吃半个占位，所以按最严的 1.5 倍统一留 */
const LABEL_MIN_PX = LABEL_SLOT_PX * 1.5;
/** 拿不到绘图区宽度时的兜底：最多画这么多个 */
const LABEL_MAX = 8;

Component({
  properties: {
    data: { type: Array, value: [] },
    // 多系列折线：[{ name, values:[], color, isMe }]（与 `data` 二选一，multi-line 时用这个）
    series: { type: Array, value: [] },
    // 多系列折线的 X 轴标签（与 series 的 values 等长）
    labels: { type: Array, value: [] },
    type: { type: String, value: 'bar' },
    unit: { type: String, value: '' },
    height: { type: Number, value: 220 },
    color: { type: String, value: '#2B6CF6' },
    emptyText: { type: String, value: '暂无数据' },
  },

  data: {
    hasData: false,
  },

  observers: {
    'data, type, series, labels': function () {
      this.renderChart();
    },
  },

  lifetimes: {
    ready() {
      this.renderChart();
    },
  },

  methods: {
    normalize(values) {
      const max = Math.max(...values, 0);
      if (max === 0) return values.map(() => 0);
      return values.map((v) => v / max);
    },

    /**
     * X 标签抽稀步长（单位＝格）：按**像素留位**算，不是按个数写死。
     * 旧口径写死「>12 就每 3 个画一个」，一年活动 53 个周桶会画出 18 个标签互相盖字。
     * chartW 拿不到时退回「最多 LABEL_MAX 个」的兜底，不硬画也不炸。
     */
    labelStep(count, chartW) {
      const n = Number(count) || 0;
      if (n <= 1) return 1;
      const w = Number(chartW) || 0;
      if (w <= 0) return Math.max(1, Math.ceil(n / LABEL_MAX));
      const seg = w / (n - 1);
      return Math.max(1, Math.ceil(LABEL_MIN_PX / seg));
    },

    /**
     * 按步长算出「画哪几格」的下标。首格恒画（左对齐贴绘图区左缘）；末格恒画（右对齐贴右缘，
     * 各系列的末点数值就标在那儿），但它会把**离自己不足一个步长**的那一格挤掉——
     * 否则末格与前一格会贴在一起（步长是格数，末格却不一定落在整步长落点上）。
     */
    labelIndices(count, chartW) {
      const n = Number(count) || 0;
      if (!Number.isFinite(n) || n <= 0) return [];
      const step = this.labelStep(n, chartW);
      const out = [];
      for (let i = 0; i < n; i += step) out.push(i);
      const last = n - 1;
      if (out[out.length - 1] !== last) {
        if (last - out[out.length - 1] < step) out.pop();
        out.push(last);
      }
      return out;
    },

    renderChart() {
      if (this.data.type === 'multi-line') {
        this.renderMultiLine();
        return;
      }
      const data = this.data.data || [];
      const values = data.map((d) => Number(d.value) || 0);
      const hasData = values.some((v) => v > 0);
      this.setData({ hasData });
      if (!hasData || values.length === 0) return;

      wx.createSelectorQuery()
        .in(this)
        .select('#chartCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) return;
          const canvas = res[0].node;
          const { width, height } = res[0];
          const ctx = canvas.getContext('2d');
          const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2;
          canvas.width = width * dpr;
          canvas.height = this.data.height * dpr;
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, width, this.data.height);

          if (this.data.type === 'bar') {
            this.drawBar(ctx, data, values, width);
          } else {
            this.drawLine(ctx, data, values, width);
          }
        });
    },

    /** 绘制 Y 轴刻度 + 网格（返回绘图区左右 padding） */
    drawAxis(ctx, values, width, height) {
      const padRight = 10;
      const padTop = 18;
      const padBottom = 26; // X 标签区
      const maxV = Math.max(...values);
      const minV = Math.min(...values);
      const span = maxV - minV || 1;
      ctx.font = '9px sans-serif';
      const labels = [
        maxV,
        minV + span * 0.75,
        minV + span / 2,
        minV + span * 0.25,
        minV,
      ];
      // Y 轴刻度区宽度按最大刻度文字动态计算（防 devtools/长数值溢出画面左缘）
      const labelTexts = labels.map((v) => this.formatValue(v));
      const maxLabelW = Math.max(...labelTexts.map((t) => ctx.measureText(t).width));
      const padLeft = Math.max(34, Math.ceil(maxLabelW) + 12);
      const chartW = width - padLeft - padRight;
      const chartH = height - padTop - padBottom;

      // 5 条水平网格 + Y 轴刻度（四等分：max / 3/4 / mid / 1/4 / min）
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      let prevText = null;
      labels.forEach((v, i) => {
        const y = padTop + (chartH * i) / 4;
        // 网格线
        ctx.strokeStyle = i === 0 ? '#e8e8e8' : '#f2f2f2';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(width - padRight, y);
        ctx.stroke();
        // 刻度文字：整数指标（次数）四等分会算出重复值，重复的不再画第二次
        ctx.fillStyle = '#667080';
        const text = this.formatValue(v);
        if (text !== prevText) {
          ctx.fillText(text, padLeft - 6, y);
          prevText = text;
        }
      });

      return { padLeft, padRight, padTop, padBottom, chartW, chartH, maxV, minV };
    },

    /** 柱状图 */
    drawBar(ctx, data, values, width) {
      const H = this.data.height;
      const axis = this.drawAxis(ctx, values, width, H);
      const n = data.length;
      const slotW = axis.chartW / n;
      const barW = Math.min(16, slotW * 0.55);
      const norm = this.normalize(values);

      // X 标签：与两条折线共用同一套抽稀（含「末格挤掉太近的上一格」）
      ctx.font = '10px sans-serif';
      ctx.fillStyle = '#999';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const drawIdx = new Set(this.labelIndices(n, axis.chartW));
      values.forEach((_, i) => {
        if (!drawIdx.has(i)) return;
        const x = axis.padLeft + i * slotW + slotW / 2;
        const label = String(data[i].label);
        // 首尾 label 用边缘对齐防裁剪
        if (i === 0) {
          ctx.textAlign = 'left';
          ctx.fillText(label, axis.padLeft, H - axis.padBottom + 8);
          ctx.textAlign = 'center';
        } else if (i === n - 1) {
          ctx.textAlign = 'right';
          ctx.fillText(label, width - axis.padRight, H - axis.padBottom + 8);
          ctx.textAlign = 'center';
        } else {
          ctx.fillText(label, x, H - axis.padBottom + 8);
        }
      });

      // 柱子
      values.forEach((v, i) => {
        const h = norm[i] * axis.chartH;
        const x = axis.padLeft + i * slotW + (slotW - barW) / 2;
        const y = H - axis.padBottom - h;
        ctx.fillStyle = this.data.color;
        ctx.globalAlpha = v > 0 ? 0.85 : 0.15;
        ctx.fillRect(x, y, barW, h);
        ctx.globalAlpha = 1;
      });

      // 最大值标注：柱上方白底块（不遮柱、不出界、不受柱宽影响）
      // padTop=18 保证上方空间：白块高 14px，by=8 时白块 [0,14]，柱顶 ≥18 不重叠
      const maxV = Math.max(...values);
      const maxIdx = values.indexOf(maxV);
      const barTop = H - axis.padBottom - norm[maxIdx] * axis.chartH;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      const text = this.formatValue(maxV);
      const tw = ctx.measureText(text).width;
      const bx = axis.padLeft + maxIdx * slotW + slotW / 2;
      const blockH = 14;
      const by = Math.max(8, barTop - 10);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(bx - tw / 2 - 4, by - 8, tw + 8, blockH, 4) : ctx.rect(bx - tw / 2 - 4, by - 8, tw + 8, blockH);
      ctx.fill();
      ctx.fillStyle = '#1f2329';
      ctx.fillText(text, bx, by);
    },

    /** 折线图（Y 轴基于数据 min~max 范围，曲线占满绘图区） */
    drawLine(ctx, data, values, width) {
      const H = this.data.height;
      const axis = this.drawAxis(ctx, values, width, H);
      const n = data.length;
      const span = axis.maxV - axis.minV || 1;
      const stepX = n > 1 ? axis.chartW / (n - 1) : axis.chartW;
      const X = (i) => axis.padLeft + i * stepX;
      // 以最低海拔为起点：值映射到 minV~maxV 区间占满高度
      const Y = (i) =>
        H - axis.padBottom - ((values[i] - axis.minV) / span) * axis.chartH;

      // 圆滑曲线：相邻数据点取中点，二次贝塞尔以数据点为控制点（平滑且不过冲出界）
      ctx.strokeStyle = this.data.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(X(0), Y(0));
      for (let i = 1; i < n - 1; i++) {
        const xc = (X(i) + X(i + 1)) / 2;
        const yc = (Y(i) + Y(i + 1)) / 2;
        ctx.quadraticCurveTo(X(i), Y(i), xc, yc);
      }
      ctx.lineTo(X(n - 1), Y(n - 1));
      ctx.stroke();

      // X 标签：与多系列图同一条抽稀规则（各自写一份迟早分叉，且旧的「≤12 全画」在 12 格时已经压字）
      ctx.font = '10px sans-serif';
      ctx.fillStyle = '#999';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const drawIdx = new Set(this.labelIndices(n, axis.chartW));
      values.forEach((_, i) => {
        if (drawIdx.has(i)) {
          const label = String(data[i].label);
          if (i === 0) {
            ctx.textAlign = 'left';
            ctx.fillText(label, axis.padLeft, H - axis.padBottom + 8);
            ctx.textAlign = 'center';
          } else if (i === n - 1) {
            ctx.textAlign = 'right';
            ctx.fillText(label, width - axis.padRight, H - axis.padBottom + 8);
            ctx.textAlign = 'center';
          } else {
            ctx.fillText(label, X(i), H - axis.padBottom + 8);
          }
        }
      });
    },

    formatValue(v) {
      if (this.data.unit === 'km') return `${Number(v).toFixed(1)}`;
      if (this.data.unit === 'min') return `${Math.round(v)}`;
      return `${Math.round(Number(v))}`;
    },

    /**
     * 多系列折线（我 vs 前三的累计趋势）：每条系列一条线，共享同一套 Y 轴（0 基线），
     * 线色取 series.color；本人那条加粗并在末端点一个圆点，便于在交叉处认出自己。
     */
    renderMultiLine() {
      const series = (this.data.series || []).filter(
        (s) => s && Array.isArray(s.values) && s.values.length > 0,
      );
      const hasData = series.some((s) => s.values.some((v) => (Number(v) || 0) > 0));
      this.setData({ hasData });
      if (!hasData || series.length === 0) return;

      const labels = (this.data.labels || []).map(String);
      wx.createSelectorQuery()
        .in(this)
        .select('#chartCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) return;
          const canvas = res[0].node;
          const { width } = res[0];
          const height = this.data.height;
          const ctx = canvas.getContext('2d');
          const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2;
          canvas.width = width * dpr;
          canvas.height = height * dpr;
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, width, height);
          this.drawMultiLine(ctx, series, labels, width);
        });
    },

    drawMultiLine(ctx, series, labels, width) {
      const H = this.data.height;
      const all = [];
      series.forEach((s) => s.values.forEach((v) => all.push(Number(v) || 0)));
      // 累计值从 0 起算：Y 轴强制 0 基线（把 0 混进样本，min 才是 0）
      const axis = this.drawAxis(ctx, [0].concat(all), width, H);
      const n = Math.max.apply(null, series.map((s) => s.values.length));
      const stepX = n > 1 ? axis.chartW / (n - 1) : axis.chartW;
      const X = (i) => axis.padLeft + i * stepX;
      const span = axis.maxV - axis.minV || 1;
      const Y = (v) => H - axis.padBottom - ((v - axis.minV) / span) * axis.chartH;

      series.forEach((s) => {
        const values = s.values.map((v) => Number(v) || 0);
        const color = s.color || this.data.color;
        ctx.strokeStyle = color;
        ctx.lineWidth = s.isMe ? 2.5 : 1.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(X(0), Y(values[0]));
        for (let i = 1; i < values.length - 1; i++) {
          const xc = (X(i) + X(i + 1)) / 2;
          const yc = (Y(values[i]) + Y(values[i + 1])) / 2;
          ctx.quadraticCurveTo(X(i), Y(values[i]), xc, yc);
        }
        ctx.lineTo(X(values.length - 1), Y(values[values.length - 1]));
        ctx.stroke();
        // 末端点：标出各系列的当前累计值
        const last = values.length - 1;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(X(last), Y(values[last]), 2.5, 0, Math.PI * 2);
        ctx.fill();
      });

      // X 标签：按 labelIndices 抽稀（目标最多 8 个、首尾恒在），左右留白不裁剪
      ctx.font = '10px sans-serif';
      ctx.fillStyle = '#999';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const drawIdx = new Set(this.labelIndices(labels.length, axis.chartW));
      labels.forEach((label, i) => {
        if (!drawIdx.has(i)) return;
        const y = H - axis.padBottom + 8;
        if (i === 0) {
          ctx.textAlign = 'left';
          ctx.fillText(label, axis.padLeft, y);
          ctx.textAlign = 'center';
        } else if (i === labels.length - 1) {
          ctx.textAlign = 'right';
          ctx.fillText(label, width - axis.padRight, y);
          ctx.textAlign = 'center';
        } else {
          ctx.fillText(label, X(i), y);
        }
      });
    },
  },
});
