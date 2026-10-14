// 活动成员信息半屏。两个视角：
//   非发起人＝只读汇总三项，数据是页面已在手的排行榜行（`member`），**不发任何请求**；
//   发起人＝额外展示 `GET /:id/members/:uid` 的 stats 概况 + 分页明细（`detail` 由页面拉好给进来），
//   「加载更多」只往页面抛 `loadmore` 事件，数据仍在页面侧 —— 组件保持无请求、无身份判断。
Component({
  properties: {
    visible: { type: Boolean, value: false },
    // { name, avatarSrc, avatarText, countText, distanceText, durationText }
    member: { type: Object, value: null },
    isCreator: { type: Boolean, value: false },
    // 发起人视角的明细数据（页面产物）：
    // { loading, error, stats:{countText,distanceText,durationText}, items:[{id,typeText,timeText,distanceText,durationText,elevationText}], total, hasMore, loadingMore }
    detail: { type: Object, value: null },
  },
  methods: {
    onClose() {
      this.triggerEvent('close');
    },

    /** 「加载更多」：只在上游说还有下一页、且当前不在加载中时抛事件（防连点重复拉） */
    onLoadMore() {
      const d = this.data.detail;
      if (!d || !d.hasMore || d.loadingMore) return;
      this.triggerEvent('loadmore');
    },

    noop() {},
  },
});
