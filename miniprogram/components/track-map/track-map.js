/**
 * track-map 地图组件（决策：原生 map 组件封装）
 * props: points(轨迹点[{lat,lng}]), markers(打点), followMode(动态追点), mapType(图层)
 * 对外：fitView() 自适应视野、switchLayer() 图层切换
 */
Component({
  properties: {
    /** 轨迹点数组 [{lat, lng}] */
    points: { type: Array, value: [] },
    /** 打点 [{id, lat, lng, iconPath, width, height, label}] */
    markers: { type: Array, value: [] },
    /** 当前位置（动态追点 marker） */
    currentLocation: { type: Object, value: null },
    /** 动态追点：新点到来时视野跟随 */
    followMode: { type: Boolean, value: false },
    /** 图层：standard / satellite */
    mapType: { type: String, value: 'standard' },
    /** 展示模式：record 动态 / view 静态（静态自动 fitView） */
    mode: { type: String, value: 'record' },
    /** 合集模式（M6）：多轨迹 [{id, type, color, points:[{lat,lng}]}] */
    overviewTracks: { type: Array, value: [] },
    /** 合集模式：热力网格 [{lat, lng, weight(0~1)}] → map circles */
    heat: { type: Array, value: [] },
  },

  data: {
    polyline: [],
    displayMarkers: [],
    heatCircles: [],
  },

  observers: {
    'points, markers, currentLocation': function (points, markers, currentLocation) {
      this.buildPolyline();
      this.buildMarkers();
      if (this.data.mode === 'view') {
        this.fitView();
      }
      // 动态追点：map 组件的 latitude/longitude 属性初始化后不再生效，
      // 必须用 MapContext.includePoints 移动视野（节流 1.5s，避免频繁跳动）
      if (this.data.followMode && currentLocation) {
        this.followLocation();
      }
    },
    'overviewTracks, heat': function () {
      this.buildOverview();
      if (this.data.mode === 'overview') {
        this.fitOverviewView();
      }
    },
  },

  lifetimes: {
    ready() {
      this.buildPolyline();
      this.buildMarkers();
      if (this.data.mode === 'view') {
        this.fitView();
      }
      if (this.data.mode === 'overview') {
        this.buildOverview();
        this.fitOverviewView();
      }
    },
  },

  methods: {
    buildPolyline() {
      // 过滤非法坐标点（undefined/NaN），空点集时传空数组避免渲染异常
      const pts = this.data.points
        .map((p) => ({ lat: p.lat, lng: p.lng }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      if (pts.length < 2) {
        this.setData({ polyline: [] });
        return;
      }

      // 按打点分段：每个打点投影到最近的轨迹点作为分段索引，轨迹切成多段
      const segs = this.splitByMarkers(pts);

      const colors = ['#2B6CF6', '#34A853', '#FF9800', '#9C27B0'];
      // 双层抗锯齿：底层浅色宽线平滑边缘，上层 4px 彩色主体线
      const polylines = [];
      segs.forEach((seg, i) => {
        const segPts = seg.map((p) => ({ latitude: p.lat, longitude: p.lng }));
        const color = colors[i % colors.length];
        polylines.push({ points: segPts, color: '#D6E4FF', width: 9, arrowLine: false });
        polylines.push({ points: segPts, color, width: 4, arrowLine: false });
      });
      this.setData({ polyline: polylines });
    },

    /** 以打点为分段点切分轨迹点序列 */
    splitByMarkers(pts) {
      const markers = (this.data.markers || []).filter(
        (m) => m && Number.isFinite(m.lat) && Number.isFinite(m.lng),
      );
      if (markers.length === 0) return [pts];

      // 每个打点 → 最近轨迹点索引
      const cutIdx = markers
        .map((m) => this.nearestPointIndex(pts, m))
        .sort((a, b) => a - b);
      const uniq = [...new Set(cutIdx)].filter((i) => i > 0 && i < pts.length - 1);

      const segs = [];
      let start = 0;
      for (const idx of uniq) {
        if (idx > start) segs.push(pts.slice(start, idx + 1));
        start = idx;
      }
      if (start < pts.length - 1) segs.push(pts.slice(start));
      return segs.length > 0 ? segs : [pts];
    },

    /** 点到轨迹点序列的最近索引（平方距离近似） */
    nearestPointIndex(pts, marker) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const d =
          (pts[i].lat - marker.lat) ** 2 + (pts[i].lng - marker.lng) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    },

    buildMarkers() {
      // 微信 map 组件：marker id 必须是 number（字符串会报渲染层错误）
      // 打点图标：按打卡顺序用带数字的圆圈（marker-1.png ~ marker-20.png）
      // anchor 用中心 {0.5, 0.5}：默认底部锚点会让图标悬在坐标点上方（打点不贴轨迹线）
      const base = this.data.markers.map((m, idx) => {
        const num = idx + 1;
        return {
          id: num,
          latitude: m.lat,
          longitude: m.lng,
          iconPath:
            num <= 20 ? `/assets/icons/marker-${num}.png` : defaultMarkerIcon(),
          width: m.width || 24,
          height: m.height || 24,
          anchor: { x: 0.5, y: 0.5 },
        };
      });

      // 当前位置 marker（动态追点）
      if (this.data.currentLocation) {
        base.push({
          id: 999999,
          latitude: this.data.currentLocation.latitude,
          longitude: this.data.currentLocation.longitude,
          iconPath: defaultCurrentIcon(),
          width: 18,
          height: 18,
          anchor: { x: 0.5, y: 0.5 },
        });
      }
      this.setData({ displayMarkers: base });
    },

    /** 动态追点：视野跟随当前位置（节流） */
    followLocation() {
      const now = Date.now();
      if (this._lastFollow && now - this._lastFollow < 1500) return;
      this._lastFollow = now;

      const loc = this.data.currentLocation;
      if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) return;
      const mapCtx = wx.createMapContext('trackMap', this);
      mapCtx.includePoints({
        points: [{ latitude: loc.latitude, longitude: loc.longitude }],
        padding: [80, 40, 80, 40],
      });
    },

    /** 自适应视野（fitView 思路：include-points） */
    fitView() {
      const pts = this.data.points.map((p) => ({
        latitude: p.lat,
        longitude: p.lng,
      }));
      if (pts.length === 0) return;
      const mapCtx = wx.createMapContext('trackMap', this);
      mapCtx.includePoints({
        points: pts,
        padding: [60, 40, 60, 40],
      });
    },

    /** 图层切换 */
    switchLayer() {
      this.setData({
        mapType: this.data.mapType === 'standard' ? 'satellite' : 'standard',
      });
    },

    /** 合集模式：多轨迹 polyline（按类型配色）+ 热力 circles */
    buildOverview() {
      const tracks = this.data.overviewTracks || [];
      console.log('[track-map] buildOverview tracks=', tracks.length, 'heat=', (this.data.heat || []).length);
      const polylines = [];
      tracks.forEach((t) => {
        const pts = (t.points || [])
          .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
          .map((p) => ({ latitude: p.lat, longitude: p.lng }));
        if (pts.length < 2) return;
        const color = t.color || '#2B6CF6';
        // 半透明主体线：多条重叠自然加深 → 高频路线视觉强化
        polylines.push({ points: pts, color, width: 4, arrowLine: false });
      });
      console.log('[track-map] polylines=', polylines.length);

      // 热力：150m 网格 → 半透明橙色圆（权重越高越浓），≤200 个
      const heatCircles = (this.data.heat || []).map((h) => ({
        latitude: h.lat,
        longitude: h.lng,
        radius: 90,
        color: `rgba(255, 152, 0, ${0.08 + 0.45 * h.weight})`,
        fillColor: `rgba(255, 152, 0, ${0.08 + 0.45 * h.weight})`,
        strokeWidth: 0,
      }));

      this.setData({ polyline: polylines, heatCircles });
    },

    /** 合集模式：视野包含所有轨迹点 */
    fitOverviewView() {
      const pts = [];
      (this.data.overviewTracks || []).forEach((t) => {
        (t.points || []).forEach((p) => {
          if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
            pts.push({ latitude: p.lat, longitude: p.lng });
          }
        });
      });
      if (pts.length === 0) return;
      const mapCtx = wx.createMapContext('trackMap', this);
      mapCtx.includePoints({ points: pts, padding: [50, 40, 50, 40] });
    },

    /**
     * 轨迹回放（决策 F16：marker 沿轨迹移动）
     * 用 translateMarker 逐段移动回放 marker，每段时长按“目标速度”计算
     * @param {Array<{lat:number,lng:number}>} points 轨迹点序列
     * @param {object} opts { speedMps?: 移动速度(米/秒, 默认 8), onEnd? }
     */
    startReplay(points, opts = {}) {
      this.stopReplay();
      this._replayStopped = false;
      const pts = (points || []).filter(
        (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng),
      );
      if (pts.length < 2) {
        this.triggerEvent('replayend');
        return;
      }
      this._replayPoints = pts;
      this._replayIdx = 0;
      this._replaySpeed = opts.speedMps || 8;

      const mapCtx = wx.createMapContext('trackMap', this);
      // 视野包含整条轨迹
      mapCtx.includePoints({
        points: pts.map((p) => ({ latitude: p.lat, longitude: p.lng })),
        padding: [80, 40, 80, 40],
      });

      // 回放 marker（独立 id，与打点/当前位置区分）
      const first = pts[0];
      this.setData({
        displayMarkers: (this.data.displayMarkers || []).concat([
          {
            id: 100001,
            latitude: first.lat,
            longitude: first.lng,
            iconPath: defaultCurrentIcon(),
            width: 12,
            height: 12,
            anchor: { x: 0.5, y: 0.5 },
          },
        ]),
      });

      this._moveNextReplaySegment();
    },

    stopReplay() {
      if (this._replayIdx == null && !this._replayStopped) return;
      // 标记停止：正在进行的 translateMarker 动画让其自然结束，回调检测标志不再继续
      this._replayStopped = true;
      this._replayIdx = null;
      this._replayPoints = null;
      // 延迟移除回放 marker：避免动画中途移除 marker 触发渲染层崩溃（faceTo）
      setTimeout(() => {
        if (this._replayStopped) {
          this.setData({
            displayMarkers: (this.data.displayMarkers || []).filter((m) => m.id !== 100001),
          });
        }
      }, 400);
    },

    _moveNextReplaySegment() {
      // 停止标记或状态已清空则不再继续
      if (this._replayStopped || this._replayIdx == null || !this._replayPoints) return;
      const pts = this._replayPoints;
      const idx = this._replayIdx;
      if (idx >= pts.length - 1) {
        this.stopReplay();
        this.triggerEvent('replayend');
        return;
      }
      const from = pts[idx];
      const to = pts[idx + 1];
      const d = haversineKm(from, to);
      // 每段动画时长：距离/速度（最小 200ms）
      const duration = Math.max(200, Math.round((d / this._replaySpeed) * 1000));
      const mapCtx = wx.createMapContext('trackMap', this);
      mapCtx.translateMarker({
        markerId: 100001,
        destination: { latitude: to.lat, longitude: to.lng },
        duration,
        animationEnd: () => {
          if (this._replayStopped) {
            this._replayIdx = null;
            return;
          }
          this._replayIdx = idx + 1;
          this._moveNextReplaySegment();
        },
      });
    },

    onMapTap(e) {
      this.triggerEvent('maptap', e.detail);
    },

    onMarkerTap(e) {
      this.triggerEvent('markertap', e.detail.markerId);
    },

    onMapCalloutTap(e) {
      this.triggerEvent('callouttap', e.detail);
    },
  },
});

/** 默认打点图标（数据 URI 蓝色圆点，避免依赖图片资源） */
function defaultMarkerIcon() {
  return '/assets/icons/marker-dot.png';
}
function defaultCurrentIcon() {
  return '/assets/icons/current-dot.png';
}

/** 两点球面距离（公里），兼容 {lat,lng} */
function haversineKm(a, b) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
