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
  },

  data: {
    polyline: [],
    displayMarkers: [],
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
  },

  lifetimes: {
    ready() {
      this.buildPolyline();
      this.buildMarkers();
      if (this.data.mode === 'view') {
        this.fitView();
      }
    },
  },

  methods: {
    buildPolyline() {
      // 过滤非法坐标点（undefined/NaN），空点集时传空数组避免渲染异常
      const pts = this.data.points
        .map((p) => ({ latitude: p.lat, longitude: p.lng }))
        .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
      this.setData({
        polyline:
          pts.length >= 2
            ? [
                {
                  points: pts,
                  color: '#2B6CF6',
                  width: 6,
                },
              ]
            : [],
      });
    },

    buildMarkers() {
      // 微信 map 组件：marker id 必须是 number（字符串会报渲染层错误）
      const base = this.data.markers.map((m, idx) => ({
        id: idx + 1,
        latitude: m.lat,
        longitude: m.lng,
        iconPath: m.iconPath || defaultMarkerIcon(),
        width: m.width || 28,
        height: m.height || 28,
        label: m.label
          ? { content: m.label, color: '#fff', fontSize: 10, bgColor: '#2B6CF6', borderRadius: 8, padding: 4 }
          : undefined,
      }));

      // 当前位置 marker（动态追点）
      if (this.data.currentLocation) {
        base.push({
          id: 999999,
          latitude: this.data.currentLocation.latitude,
          longitude: this.data.currentLocation.longitude,
          iconPath: defaultCurrentIcon(),
          width: 22,
          height: 22,
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

    /**
     * 轨迹回放（决策 F16：marker 沿轨迹移动）
     * 用 translateMarker 逐段移动回放 marker，每段时长按“目标速度”计算
     * @param {Array<{lat:number,lng:number}>} points 轨迹点序列
     * @param {object} opts { speedMps?: 移动速度(米/秒, 默认 8), onEnd? }
     */
    startReplay(points, opts = {}) {
      this.stopReplay();
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
            width: 24,
            height: 24,
          },
        ]),
      });

      this._moveNextReplaySegment();
    },

    stopReplay() {
      if (this._replayIdx == null) return;
      this._replayIdx = null;
      this._replayPoints = null;
      // 移除回放 marker
      this.setData({
        displayMarkers: (this.data.displayMarkers || []).filter((m) => m.id !== 100001),
      });
    },

    _moveNextReplaySegment() {
      if (this._replayIdx == null || !this._replayPoints) return;
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
