// 榜单用户资料半屏（运动榜 / 微信步数榜共用）：只负责渲染，数据由页面拉好给进来。
// `state` 与运动榜的 userSheet 同形；`viewer` 是头像大图预览层。
// 事件：close（关半屏）、retry（拉取失败重试）、preview（点头像看大图）、closeviewer（关大图）。
Component({
  properties: {
    visible: { type: Boolean, value: false },
    // { loading, error, uid, name, avatarSrc, avatarLargeUrl, avatarText, member, joinDays, stats, statsHidden }
    state: { type: Object, value: null },
    // { visible, src }
    viewer: { type: Object, value: null },
  },
  methods: {
    onClose() {
      this.triggerEvent('close');
    },
    onRetry() {
      this.triggerEvent('retry');
    },
    onPreview() {
      this.triggerEvent('preview');
    },
    onCloseViewer() {
      this.triggerEvent('closeviewer');
    },
    noop() {},
  },
});
