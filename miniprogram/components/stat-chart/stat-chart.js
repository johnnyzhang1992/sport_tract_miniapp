/**
 * stat-chart 图表组件（决策 D8：轻量 Canvas 自绘，不引入重量级图表库）
 * - type=bar：柱状图（统计趋势）
 * - type=line：折线图（海拔/配速曲线）
 * props: data[{label, value}], type, unit, height, color
 * 注意：value 全为 0 时显示空态提示
 */
Component({
  properties: {
    /** [{label: '08-11', value: 3.2}] */
    data: { type: Array, value: [] },
    type: { type: String, value: 'bar' }, // bar | line
    unit: { type: String, value: '' },
    height: { type: Number, value: 220 }, // px
    color: { type: String, value: '#2B6CF6' },
    /** 空态文案 */
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
    /** 归一化：0~1 区间（max 为 0 时全 0 返回 []） */
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

    /** 柱状图 */
    drawBar(ctx, data, values, width) {
      const H = this.data.height;
      const padTop = 12;
      const padBottom = 26; // 底部 label 区
      const chartH = H - padTop - padBottom;
      const n = data.length;
      const slotW = width / n;
      const barW = Math.min(18, slotW * 0.6);
      const norm = this.normalize(values);

      // 坐标轴
      ctx.strokeStyle = '#eee';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, H - padBottom + 6);
      ctx.lineTo(width, H - padBottom + 6);
      ctx.stroke();

      values.forEach((v, i) => {
        const h = norm[i] * chartH;
        const x = i * slotW + (slotW - barW) / 2;
        const y = H - padBottom - h;

        // 柱子
        ctx.fillStyle = this.data.color;
        ctx.globalAlpha = v > 0 ? 0.85 : 0.15;
        ctx.fillRect(x, y, barW, h);
        ctx.globalAlpha = 1;

        // label（每 2 个显示一个，避免拥挤）
        if (n <= 15 || i % 2 === 0) {
          ctx.fillStyle = '#999';
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(String(data[i].label), i * slotW + slotW / 2, H - 8);
        }
      });

      // 最大值标注
      if (n > 0) {
        const maxV = Math.max(...values);
        const maxIdx = values.indexOf(maxV);
        ctx.fillStyle = '#999';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.formatValue(maxV), maxIdx * slotW + slotW / 2, H - padBottom - norm[maxIdx] * chartH - 6);
      }
    },

    /** 折线图 */
    drawLine(ctx, data, values, width) {
      const H = this.data.height;
      const padTop = 16;
      const padBottom = 26;
      const chartH = H - padTop - padBottom;
      const n = data.length;
      const norm = this.normalize(values);
      const stepX = n > 1 ? width / (n - 1) : width;

      // 参考线（1/2 处）
      ctx.strokeStyle = '#f0f0f0';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, H - padBottom - chartH / 2);
      ctx.lineTo(width, H - padBottom - chartH / 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // 折线
      ctx.strokeStyle = this.data.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      values.forEach((v, i) => {
        const x = i * stepX;
        const y = H - padBottom - norm[i] * chartH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // 数据点
      values.forEach((v, i) => {
        const x = i * stepX;
        const y = H - padBottom - norm[i] * chartH;
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = this.data.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // label（每 3 个显示一个）
        if (n <= 12 || i % 3 === 0) {
          ctx.fillStyle = '#999';
          ctx.font = '9px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(String(data[i].label), x, H - 8);
        }
      });
    },

    formatValue(v) {
      if (this.data.unit === 'km') return `${v.toFixed(1)}`;
      if (this.data.unit === 'min') return `${Math.round(v)}`;
      return `${v}`;
    },
  },
});
