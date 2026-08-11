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
    'points, markers, currentLocation': function () {
      this.buildPolyline();
      this.buildMarkers();
      if (this.data.mode === 'view') {
        this.fitView();
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
