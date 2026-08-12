/**
 * stat-chart 图表组件（决策 D8：轻量 Canvas 自绘）
 * - type=bar：柱状图（统计趋势）
 * - type=line：折线图（海拔/配速曲线）
 * - 布局：左侧 Y 轴刻度（min/mid/max）+ 网格线，底部 X 标签（左右留白不裁剪）
 * - 折线图数据点小圆 + 最大值标注数值
 */
Component({
  properties: {
    data: { type: Array, value: [] },
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
    'data, type': function () {
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

    renderChart() {
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
      ctx.font = '10px sans-serif';
      const labels = [maxV, minV + span / 2, minV];
      // Y 轴刻度区宽度按最大刻度文字动态计算（防 devtools/长数值溢出画面左缘）
      const labelTexts = labels.map((v) => this.formatValue(v));
      const maxLabelW = Math.max(...labelTexts.map((t) => ctx.measureText(t).width));
      const padLeft = Math.max(34, Math.ceil(maxLabelW) + 12);
      const chartW = width - padLeft - padRight;
      const chartH = height - padTop - padBottom;

      // 3 条水平网格 + Y 轴刻度（max / mid / min）
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      labels.forEach((v, i) => {
        const y = padTop + (chartH * i) / 2;
        // 网格线
        ctx.strokeStyle = i === 0 ? '#e8e8e8' : '#f2f2f2';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(width - padRight, y);
        ctx.stroke();
        // 刻度文字
        ctx.fillStyle = '#999';
        const text = this.formatValue(v);
        ctx.fillText(text, padLeft - 6, y);
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

      // X 标签：上限 7 个均匀抽稀（避免挤在一起），首尾始终保留
      const maxLabels = 7;
      const labelEvery = Math.max(1, Math.ceil(n / maxLabels));
      ctx.font = '10px sans-serif';
      ctx.fillStyle = '#999';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      values.forEach((_, i) => {
        if (i !== 0 && i !== n - 1 && i % labelEvery !== 0) return;
        const x = axis.padLeft + i * slotW + slotW / 2;
        const label = String(data[i].label);
        // 首尾 label 用边缘对齐防裁剪
        if (i === 0) {
          ctx.textAlign = 'left';
          ctx.fillText(label, axis.padLeft, H - axis.padBottom + 16);
          ctx.textAlign = 'center';
        } else if (i === n - 1) {
          ctx.textAlign = 'right';
          ctx.fillText(label, width - axis.padRight, H - axis.padBottom + 16);
          ctx.textAlign = 'center';
        } else {
          ctx.fillText(label, x, H - axis.padBottom + 16);
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

      // 最大值标注：柱子上方偏移 12px（不重叠柱子、不超出画布顶）
      const maxV = Math.max(...values);
      const maxIdx = values.indexOf(maxV);
      const barTop = H - axis.padBottom - norm[maxIdx] * axis.chartH;
      ctx.fillStyle = '#1f2329';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      const maxY = Math.max(axis.padTop + 10, barTop - 12);
      ctx.fillText(
        this.formatValue(maxV),
        axis.padLeft + maxIdx * slotW + slotW / 2,
        maxY,
      );
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

      // 折线
      ctx.strokeStyle = this.data.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      values.forEach((_, i) => {
        if (i === 0) ctx.moveTo(X(i), Y(i));
        else ctx.lineTo(X(i), Y(i));
      });
      ctx.stroke();

      // 数据点圆点 + 关键点数值标注
      const maxV = Math.max(...values);
      const maxIdx = values.indexOf(maxV);
      ctx.font = '10px sans-serif';
      values.forEach((_, i) => {
        // 点：实心小圆（原空心描边圆 3px → 实心 2px）
        ctx.fillStyle = this.data.color;
        ctx.beginPath();
        ctx.arc(X(i), Y(i), 2, 0, Math.PI * 2);
        ctx.fill();
        // 标注：最大值 + 首尾 + 每 5 个点
        const annotate = i === maxIdx || i === 0 || i === n - 1 || (n > 10 && i % 5 === 0);
        if (annotate) {
          ctx.fillStyle = '#1f2329';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          const labelY = Math.max(axis.padTop + 10, Y(i) - 5); // 限制在绘图区内
          ctx.fillText(this.formatValue(values[i]), X(i), labelY);
        }
      });

      // X 标签（左右留白）
      ctx.font = '10px sans-serif';
      ctx.fillStyle = '#999';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      values.forEach((_, i) => {
        if (n <= 12 || i % 3 === 0) {
          const label = String(data[i].label);
          if (i === 0) {
            ctx.textAlign = 'left';
            ctx.fillText(label, axis.padLeft, H - axis.padBottom + 16);
            ctx.textAlign = 'center';
          } else if (i === n - 1) {
            ctx.textAlign = 'right';
            ctx.fillText(label, width - axis.padRight, H - axis.padBottom + 16);
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
  },
});
