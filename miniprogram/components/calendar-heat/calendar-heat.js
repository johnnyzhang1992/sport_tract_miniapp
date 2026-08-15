/**
 * calendar-heat 日历热力图组件（GitHub contribution graph 经典样式）
 * 横向：每周一列（53 周 × 7 天），纵向：周日~周六
 * 顶部月份标签 + 底部星期标签（一/三/五）
 * props: data = [{ date: 'YYYY-MM-DD', distance, count }]（近 365 天，含 0 值）
 */
Component({
  options: { styleIsolation: 'apply-shared' },

  data: {
    canvasH: 70, // 动态高度（按绘制内容计算）
  },

  properties: {
    data: { type: Array, value: [] },
    // 分级色：无运动 / 低 / 中 / 高
    colorEmpty: { type: String, value: '#ebedf0' },
    colorLow: { type: String, value: '#c6dbff' },
    colorMid: { type: String, value: '#7ea8ff' },
    colorHigh: { type: String, value: '#2b6cf6' },
  },

  observers: {
    data() {
      this.draw();
    },
  },

  lifetimes: {
    ready() {
      this.draw();
    },
  },

  methods: {
    fmt(d) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    draw() {
      const data = this.data.data || [];
      const byDate = {};
      data.forEach((d) => {
        if (d && d.date) byDate[d.date] = d;
      });

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      // 起始：今天往前 364 天，回到所在周的周日
      const start = new Date(today.getTime() - 364 * 86400000);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - start.getDay()); // 回退到周日

      const cols = Math.ceil((today.getTime() - start.getTime()) / (7 * 86400000)) + 1;

      wx.createSelectorQuery()
        .in(this)
        .select('#heatCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const info = res && res[0];
          if (!info || !info.node) return;
          const { node, width } = info;
          if (!width) return;

          const gap = 1;
          const leftPad = 14; // 左侧星期标签区
          // 格子宽浮点：leftPad + cols*(cell+gap) = width，右侧占满
          const cell = Math.max(3, (width - leftPad) / cols - gap);
          const cellW = cell;
          const labelH = 16; // 顶部月份标签（留足空间，防截取）
          // 星期标签（一/三/五）在左侧，底部无标签区 → H 只含顶部标签 + 7 行格子
          const H = labelH + 7 * (cell + gap);

          // 动态高度：canvas style 高度贴合绘制内容（无底部富余/裁剪）
          if (Math.abs(H - this.data.canvasH) > 1) {
            this.setData({ canvasH: Math.ceil(H) }, () => this.draw());
            return;
          }

          const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2;
          node.width = width * dpr;
          node.height = H * dpr;
          const ctx = node.getContext('2d');
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, width, H);

          const maxD = Math.max(...data.map((d) => Number(d.distance) || 0), 1);
          const colorOf = (dist) => {
            const v = Number(dist) || 0;
            if (v <= 0) return this.data.colorEmpty;
            const r = v / maxD;
            if (r < 0.3) return this.data.colorLow;
            if (r < 0.6) return this.data.colorMid;
            return this.data.colorHigh;
          };

          // 格子（行 0=周日 ... 6=周六）
          for (let w = 0; w < cols; w++) {
            const x = leftPad + w * (cell + gap);
            for (let r = 0; r < 7; r++) {
              const d = new Date(start);
              d.setDate(start.getDate() + w * 7 + r);
              if (d.getTime() > today.getTime()) continue; // 未来不画
              const key = this.fmt(d);
              const item = byDate[key];
              const y = labelH + r * (cell + gap);
              ctx.fillStyle = item && Number(item.distance) > 0 ? colorOf(item.distance) : this.data.colorEmpty;
              ctx.fillRect(x, y, cellW, cellW);
            }
          }

          // 月份标签：每月 1 日所在列
          ctx.fillStyle = '#999';
          ctx.font = '9px sans-serif';
          ctx.textAlign = 'left';
          const firstMonth = start.getFullYear() * 12 + start.getMonth();
          const lastMonth = today.getFullYear() * 12 + today.getMonth();
          for (let ym = firstMonth; ym <= lastMonth; ym++) {
            const mDate = new Date(Math.floor(ym / 12), ym % 12, 1, 0, 0, 0, 0);
            if (mDate.getTime() < start.getTime() || mDate.getTime() > today.getTime()) continue;
            const col = Math.floor((mDate.getTime() - start.getTime()) / (7 * 86400000));
            const x = leftPad + col * (cell + gap);
            ctx.fillText(`${ym % 12 + 1}月`, x, labelH - 5);
          }

          // 左侧星期标签：按空间（格子大小）决定展示数量
          ctx.fillStyle = '#bbb';
          ctx.font = '8px sans-serif';
          ctx.textAlign = 'right';
          const weekLabels =
            cell >= 11
              ? ['日', '一', '二', '三', '四', '五', '六'] // 空间足：全部
              : ['日', '', '', '三', '', '', '六']; // 首/中/末三行（周日/周三/周六）
          weekLabels.forEach((t, r) => {
            if (!t) return;
            const y = labelH + r * (cell + gap) + cell / 2;
            ctx.fillText(t, leftPad - 4, y + 3);
          });
        });
    },
  },
});
