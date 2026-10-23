// 活动成员信息半屏：标题行是头像+昵称（`member` 由页面给，组件不自己拉）+ 「我 vs TA」对照
// （`compare`，页面算好给进来）+ 该成员在本活动内计入的轨迹明细（`detail` 由页面拉好给进来，
// 「加载更多」只往页面抛 `loadmore` 事件）。
// 明细对活动内成员一律开放，所以组件不持有查看者身份：它只认 `detail` 有没有落地。
Component({
  properties: {
    visible: { type: Boolean, value: false },
    // { name, avatarSrc, avatarText, countText, distanceText, durationText }
    member: { type: Object, value: null },
    // 明细数据（页面产物）：
    // { loading, error, stats:{countText,distanceText,durationText}, items:[{id,typeText,timeText,distanceText,durationText,elevationText}], total, hasMore, loadingMore }
    detail: { type: Object, value: null },
    // 「我 vs TA」对照（页面产物）：{ rows:[{label,myText,taText,state,diffText}] }；没有对照时为 null
    compare: { type: Object, value: null },
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
