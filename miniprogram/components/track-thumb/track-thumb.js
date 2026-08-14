Component({
  options: { styleIsolation: 'apply-shared' },

  properties: {
    points: { type: Array, value: [] },
    color: { type: String, value: '#2B6CF6' },
  },

  observers: {
    'points, color'() {
      this.draw();
    },
  },

  lifetimes: {
    ready() {
      this.draw();
    },
  },

  methods: {
    draw() {
      const points = (this.data.points || []).filter((p) => p && p.lat != null && p.lng != null);
      if (points.length < 2) return;
      this.createSelectorQuery()
        .select('#thumb')
        .fields({ node: true, size: true })
        .exec((res) => {
          const info = res && res[0];
          if (!info || !info.node) return;
          const { node, width, height } = info;
          if (!width || !height) return;
          const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio;
          node.width = width * dpr;
          node.height = height * dpr;
          const ctx = node.getContext('2d');
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, width, height);

          let minLat = Infinity;
          let maxLat = -Infinity;
          let minLng = Infinity;
          let maxLng = -Infinity;
          for (const p of points) {
            if (p.lat < minLat) minLat = p.lat;
            if (p.lat > maxLat) maxLat = p.lat;
            if (p.lng < minLng) minLng = p.lng;
            if (p.lng > maxLng) maxLng = p.lng;
          }
          const spanLat = maxLat - minLat || 1e-9;
          const spanLng = maxLng - minLng || 1e-9;
          const pad = 10; // 内边距：轨迹线离容器边缘留白
          const x = (lng) => pad + ((lng - minLng) / spanLng) * (width - pad * 2);
          const y = (lat) => height - pad - ((lat - minLat) / spanLat) * (height - pad * 2);

          ctx.strokeStyle = this.data.color;
          ctx.lineWidth = 1.5;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x(points[0].lng), y(points[0].lat));
          for (let i = 1; i < points.length; i++) {
            ctx.lineTo(x(points[i].lng), y(points[i].lat));
          }
          ctx.stroke();
        });
    },
  },
});
