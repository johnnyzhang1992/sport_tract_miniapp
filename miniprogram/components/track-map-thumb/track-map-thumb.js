/**
 * 轨迹卡片左侧「原生地图」缩略图（存档组件；轨迹列表当前使用 canvas 版 track-thumb）。
 * 用法：
 *   <view class="map-wrap">
 *     <track-map-thumb class="track-map-thumb" item-id="{{item.id}}" preview-points="{{item.previewPoints}}"
 *       type="{{item.type}}" icon-img="{{item.iconImg}}" bind:tap="onTapItem" />
 *   </view>
 * - 列表预览点先出图；进入视口（上下各 240px）才拉 /activities/:id/map-points 详情点并替换；
 * - 离开视口只卸载 map 节点（详情点留模块级缓存），长列表不会同时挂多个原生地图；
 * - 点击只抛 tap 事件，导航由页面决定。
 */
const api = require('../../services/api');
const { buildMapView } = require('../../utils/map-preview');

const CACHE_LIMIT = 60;
const viewCache = new Map();

/** 卡片左图 220×170rpx 换算真实像素（scale 预算用） */
function cardSize() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
  const unit = (info.windowWidth || 375) / 750;
  return { width: Math.round(220 * unit), height: Math.round(170 * unit) };
}

Component({
  options: { styleIsolation: 'apply-shared' },

  properties: {
    itemId: { type: String, value: '' },
    previewPoints: { type: Array, value: [] },
    type: { type: String, value: '' },
    iconImg: { type: String, value: '' },
  },

  data: {
    mounted: false,
    center: null,
    scale: 15,
    polyline: [],
    includePoints: [],
    empty: false,
    failed: false,
  },

  observers: {
    'itemId, previewPoints, type'() {
      this.applyPreview();
    },
  },

  lifetimes: {
    ready() {
      this.applyPreview();
      this.observe();
    },
    detached() {
      if (this._io) {
        this._io.disconnect();
        this._io = null;
      }
      if (this._fitTimer) {
        clearTimeout(this._fitTimer);
        this._fitTimer = null;
      }
    },
  },

  methods: {
    applyPreview() {
      const view = buildMapView(this.data.previewPoints || [], this.data.type, cardSize());
      this._fitPoints = view ? view.fitPoints : null;
      if (!view) {
        this.setData({ center: null, polyline: [], includePoints: [], mounted: false });
        return;
      }
      this.setData(
        {
          center: view.center,
          scale: view.scale,
          polyline: view.polyline,
          includePoints: view.includePoints,
          empty: false,
        },
        () => {
          if (this.data.mounted) this.fit();
        },
      );
    },

    /** 原生 map 太重：进出视口只挂/卸节点，详情点留在缓存 */
    observe() {
      if (!this.createIntersectionObserver) return;
      this._io = this.createIntersectionObserver({ thresholds: [0] });
      this._io.relativeToViewport({ top: 240, bottom: 240 }).observe('.thumb-root', (res) => {
        if (res && res.intersectionRatio > 0) this.mount();
        else this.setData({ mounted: false });
      });
    },

    async mount() {
      this.setData({ mounted: true }, () => this.fit());
      await this.loadDetail();
    },

    async loadDetail() {
      const id = this.data.itemId;
      if (!id || this._loading) return;
      if (viewCache.has(id)) {
        this.applyView(viewCache.get(id));
        return;
      }
      this._loading = true;
      try {
        const data = await api.get(`/activities/${id}/map-points`);
        const view = buildMapView((data && data.points) || [], this.data.type, cardSize());
        if (!view) {
          this._fitPoints = null;
          this.setData({ empty: true, center: null, polyline: [], includePoints: [] });
          return;
        }
        if (viewCache.size >= CACHE_LIMIT) viewCache.delete(viewCache.keys().next().value);
        viewCache.set(id, view);
        this.applyView(view);
      } catch (e) {
        this.setData({ failed: true });
      } finally {
        this._loading = false;
      }
    },

    applyView(view) {
      this._fitPoints = view.fitPoints;
      this.setData(
        {
          center: view.center,
          scale: view.scale,
          polyline: view.polyline,
          includePoints: view.includePoints,
          empty: false,
          failed: false,
        },
        () => {
          if (this.data.mounted) this.fit();
        },
      );
    },

    /** include-points 属性只能紧贴边，MapContext 才能留 12px 内边距 */
    fit() {
      if (!wx.createMapContext || !this._fitPoints || !this._fitPoints.length) return;
      if (this._fitTimer) clearTimeout(this._fitTimer);
      this._fitTimer = setTimeout(() => {
        this._fitTimer = null;
        try {
          const ctx = wx.createMapContext('thumb-map', this);
          if (ctx && ctx.includePoints) {
            ctx.includePoints({ points: this._fitPoints, padding: [12, 12, 12, 12], animated: false });
          }
        } catch (e) {}
      }, 60);
    },

    onTap() {
      this.triggerEvent('tap');
    },
  },
});
