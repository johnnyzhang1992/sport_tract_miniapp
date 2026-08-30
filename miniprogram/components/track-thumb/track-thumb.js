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

          // 等比例缩放（与真实地图一致）：纬度 1°≈111km，经度 1°≈111×cos(纬度)km
          // 各轴独立归一化会把轨迹拉伸变形，这里用同一 scale 保持形状
          const midLat = (minLat + maxLat) / 2;
          const kmPerDegLng = 111 * Math.cos((midLat * Math.PI) / 180);
          const lngKm = spanLng * kmPerDegLng;
          const latKm = spanLat * 111;
          const scale = Math.min((width - pad * 2) / lngKm, (height - pad * 2) / latKm); // px/km
          const drawW = lngKm * scale;
          const drawH = latKm * scale;
          const offsetX = (width - drawW) / 2; // 水平居中
          const offsetY = (height - drawH) / 2; // 垂直居中
          const x = (lng) => offsetX + (lng - minLng) * kmPerDegLng * scale;
          const y = (lat) => height - offsetY - (lat - minLat) * 111 * scale;

          ctx.strokeStyle = this.data.color;
          ctx.lineWidth = 1.5;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          // 按 pauseGap 切段（暂停间隙断开连线，与详情页地图一致）
          const segs = [];
          let segStart = 0;
          for (let i = 0; i < points.length; i++) {
            if (points[i].pauseGap && i > segStart) {
              segs.push(points.slice(segStart, i));
              segStart = i;
            }
          }
          if (segStart < points.length) segs.push(points.slice(segStart));
          for (const seg of segs) {
            if (seg.length < 2) continue;
            ctx.beginPath();
            ctx.moveTo(x(seg[0].lng), y(seg[0].lat));
            for (let i = 1; i < seg.length; i++) {
              ctx.lineTo(x(seg[i].lng), y(seg[i].lat));
            }
            ctx.stroke();
          }
        });
    },
  },
});
