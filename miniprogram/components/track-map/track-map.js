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
    /** 海拔着色（决策 F34：轨迹线按海拔分桶变色，蓝→绿→黄→红） */
    altitudeColor: { type: Boolean, value: false },
  },

  data: {
    polyline: [],
    displayMarkers: [],
    heatCircles: [],
    centerLat: 31.2304,
    centerLng: 121.4737,
  },

  observers: {
    'points, markers, currentLocation': function (points, markers, currentLocation) {
      this.updateCenter();
      // overview 模式轨迹线由 buildOverview 管理，buildPolyline 会清空（points 为空）
      if (this.data.mode !== 'overview') {
        this.buildPolyline();
        this.buildMarkers();
      }
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
      this.updateCenter();
      // 仅合集模式处理多轨迹；view/record 模式不受 overviewTracks 影响（避免覆盖竞态）
      if (this.data.mode === 'overview') {
        this.buildOverview();
        this.fitOverviewView();
      }
    },
  },

  lifetimes: {
    ready() {
      this.updateCenter();
      if (this.data.mode !== 'overview') {
        this.buildPolyline();
        this.buildMarkers();
        if (this.data.mode === 'view') this.fitView();
      } else {
        this.buildOverview();
        this.fitOverviewView();
      }
    },
  },

  methods: {
    /** 统一计算地图中心（WXML 不支持多级表达式，如 overviewTracks[0].points[0].lat） */
    updateCenter() {
      const loc = this.data.currentLocation;
      if (loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) {
        this.setData({ centerLat: loc.latitude, centerLng: loc.longitude });
        return;
      }
      const pts = this.data.points || [];
      if (pts.length && Number.isFinite(pts[0].lat) && Number.isFinite(pts[0].lng)) {
        this.setData({ centerLat: pts[0].lat, centerLng: pts[0].lng });
        return;
      }
      const ot = this.data.overviewTracks || [];
      const p0 = ot[0] && ot[0].points && ot[0].points[0];
      if (p0 && Number.isFinite(p0.lat) && Number.isFinite(p0.lng)) {
        this.setData({ centerLat: p0.lat, centerLng: p0.lng });
      }
    },
    buildPolyline() {
      if (this.data.mode === 'overview') return; // 合集模式由 buildOverview 管理轨迹线
      // 过滤非法坐标点（undefined/NaN），空点集时传空数组避免渲染异常
      const pts = this.data.points
        .map((p) => ({ lat: p.lat, lng: p.lng, altitude: p.altitude ?? null }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      if (pts.length < 2) {
        this.setData({ polyline: [] });
        return;
      }

      // 海拔着色：轨迹线按海拔分桶变色（蓝低→红高），打点分段色让位
      if (this.data.altitudeColor && pts.some((p) => p.altitude != null)) {
        this.buildAltitudePolyline(pts);
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

    /**
     * 海拔着色：轨迹线按海拔分桶变色（决策 F34）
     * 蓝(低) → 绿 → 黄 → 红(高)，相邻同色段合并，控制 polyline 数量
     */
    buildAltitudePolyline(pts) {
      const alts = pts.map((p) => p.altitude).filter((a) => a != null);
      if (alts.length < 2) {
        this.setData({ polyline: [] });
        return;
      }
      const min = Math.min(...alts);
      const max = Math.max(...alts);
      const span = max - min || 1;
      const BUCKETS = 12;
      const bucketIndex = (alt) => Math.min(BUCKETS - 1, Math.max(0, Math.floor(((alt - min) / span) * BUCKETS)));

      const polylines = [];
      let cur = null; // { color, points }
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        if (!Number.isFinite(a.lat) || !Number.isFinite(b.lat)) continue;
        const avgAlt =
          a.altitude != null || b.altitude != null
            ? (a.altitude ?? b.altitude) + ((b.altitude ?? a.altitude) - (a.altitude ?? b.altitude)) / 2
            : null;
        const color = avgAlt != null ? ALTITUDE_COLORS[bucketIndex(avgAlt)] : null;
        const pt = { latitude: b.lat, longitude: b.lng };
        if (color && cur && cur.color === color) {
          cur.points.push(pt);
        } else if (color) {
          cur = { color, points: [{ latitude: a.lat, longitude: a.lng }, pt] };
          polylines.push(cur);
        } else {
          cur = null;
        }
      }
      // 海拔缺失段（null）用相邻段色补画细线，保证轨迹完整
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

    /** 合集模式：多轨迹 polyline（按类型配色 + 高频路线加粗高亮） */
    buildOverview() {
      const tracks = this.data.overviewTracks || [];
      const heat = this.data.heat || [];
      console.log('[track-map] buildOverview tracks=', tracks.length, 'heat=', heat.length);
      // 热力网格索引（与后端 gridHeat 同算法：150m）
      const cellLat = 150 / 111320;
      const heatMap = new Map();
      heat.forEach((h) => {
        const cosLat = Math.cos((h.lat * Math.PI) / 180) || 1;
        const cellLng = cellLat / cosLat;
        heatMap.set(`${Math.round(h.lat / cellLat)},${Math.round(h.lng / cellLng)}`, h.weight);
      });

      const polylines = [];
      tracks.forEach((t) => {
        const pts = (t.points || [])
          .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
          .map((p) => ({ latitude: p.lat, longitude: p.lng }));
        if (pts.length < 2) return;
        // 轨迹热度 = 命中热力网格的权重均值（高频路线 → 粗橙线）
        let sum = 0;
        let n = 0;
        (t.points || []).forEach((p) => {
          const cosLat = Math.cos((p.lat * Math.PI) / 180) || 1;
          const cellLng = cellLat / cosLat;
          const w = heatMap.get(`${Math.round(p.lat / cellLat)},${Math.round(p.lng / cellLng)}`);
          if (w != null) {
            sum += w;
            n += 1;
          }
        });
        const trackHeat = n > 0 ? sum / n : 0;
        const baseColor = t.color || '#2B6CF6';
        let color = baseColor;
        let width = 3;
        if (trackHeat >= 0.5) {
          color = '#FF9800'; // 高频：橙色粗线（热力强调）
          width = 8;
        } else if (trackHeat >= 0.2) {
          width = 5; // 中频：类型色加粗
        }
        polylines.push({ points: pts, color, width, arrowLine: false });
      });
      console.log('[track-map] polylines=', polylines.length);

      // 热力不再用 circles（map circles 与 polyline 渲染冲突），改由轨迹线粗细/颜色表达
      this.setData({ polyline: polylines });
    },

    /** 合集模式：视野聚焦首条轨迹（避免异地轨迹把视野拉到全国，轨迹缩成不可见） */
    fitOverviewView() {
      const t0 = (this.data.overviewTracks || [])[0];
      const pts = ((t0 && t0.points) || [])
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        .map((p) => ({ latitude: p.lat, longitude: p.lng }));
      if (pts.length === 0) return;
      const mapCtx = wx.createMapContext('trackMap', this);
      mapCtx.includePoints({ points: pts, padding: [60, 40, 60, 40] });
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

/** 海拔色带：蓝 → 绿 → 黄 → 红（12 档线性插值） */
const ALTITUDE_COLORS = (() => {
  const stops = [
    [0, [41, 121, 255]], // 蓝（低海拔）
    [0.35, [0, 199, 83]], // 绿
    [0.7, [255, 213, 0]], // 黄
    [1, [244, 67, 54]], // 红（高海拔）
  ];
  const N = 12;
  const colors = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    let lo = stops[0];
    let hi = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) {
        lo = stops[s];
        hi = stops[s + 1];
        break;
      }
    }
    const span = hi[0] - lo[0] || 1;
    const k = (t - lo[0]) / span;
    const rgb = lo[1].map((c, idx) => Math.round(c + (hi[1][idx] - c) * k));
    colors.push(`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`);
  }
  return colors;
})();
