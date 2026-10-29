/**
 * 模板广告（原生模板广告 `<ad-custom>`）外层组件。
 *
 * 用法：页面 json 里
 *   "usingComponents": { "ad-template": "/components/ad-template/ad-template" }
 * 然后 wxml：
 *   <ad-template adslot="tracks_list" />
 * （adslot 的值是后台「广告管理」里配的广告位 key，unit-id 由后台下发，不在端上写死）
 *
 * 展示条件：后台在架（拿得到 unit-id）**且** 未免广告期——任一不满足就不渲染。
 * 广告拉取失败（无库存、单元无效、被驳回）就把整块收掉，不留空白占位
 * （官方建议：保留组件、隐藏父容器，不要移除标签）。
 */
const { isAdFree, onAdFreeChange } = require('../../utils/ad-free');
const { getAdSlot, onAdSlotsChange, refreshAdSlots } = require('../../utils/ad-slots');

Component({
  properties: {
    // 属性名只能用小写单词：自定义组件属性名不做 kebab→camel 转换（WXML 的属性名还会被小写化），
    // 所以 ad-slot / adSlot 都收不到值；也不能叫 slot —— 那是具名插槽保留属性
    adslot: { type: String, value: '' },
    /** 自动刷新间隔（秒，官方要求 >= 30；不传则模板广告不自动刷新） */
    intervals: { type: Number, value: 30 },
    /**
     * 外边距（CSS 简写，rpx 自带单位）：默认对应 .container 里 .card 的 margin-bottom:24rpx。
     * 页面按自己的卡片节奏传：积分页 "16rpx 24rpx 0"、轨迹列表 "0 0 16rpx"。
     * 写在渲染出来的内层节点上（不是宿主），广告不展示时不会留下空隙。
     */
    margin: { type: String, value: '0 0 24rpx' },
    /** 圆角（rpx）：跟宿主页卡片的 border-radius 对齐（全局 .card 16、积分/榜单/活动页 20） */
    radius: { type: Number, value: 16 },
  },

  data: { show: false, unitId: '' },

  observers: {
    adslot() {
      this.refresh();
    },
  },

  lifetimes: {
    attached() {
      this._offs = [onAdFreeChange(() => this.refresh()), onAdSlotsChange(() => this.refresh())];
      this.refresh();
      // 缓存过期才会真的请求；首次进小程序时由 app.onLaunch 先拉，这里兜底
      refreshAdSlots();
    },
    detached() {
      for (const off of this._offs || []) off();
      this._offs = null;
    },
  },

  pageLifetimes: {
    // 回到本页时重算：免广告卡可能刚过期/刚激活，广告位也可能刚被后台上下架
    show() {
      refreshAdSlots();
      this.refresh();
    },
  },

  methods: {
    refresh() {
      const unitId = getAdSlot(this.data.adslot);
      const show = !!unitId && !isAdFree();
      if (show !== this.data.show || unitId !== this.data.unitId) this.setData({ show, unitId });
    },
    onAdLoad(e) {
      this.triggerEvent('load', (e && e.detail) || {});
    },
    onAdError(e) {
      this.setData({ show: false });
      this.triggerEvent('error', (e && e.detail) || {});
    },
  },
});
