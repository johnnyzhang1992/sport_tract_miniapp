// 活动成员信息半屏（**只读**，非发起人视角）。
//
// 数据由页面给：`member` 就是详情页已在手的排行榜行（`GET /:id/leaderboard` 的 rows）格式化后的对象——
// 「只有该成员的汇总三项」是需求 §5 的硬边界（他人明细只有发起人能看），所以本组件**不发任何请求**。
// 发起人视角（`GET /:id/members/:uid` 概况 + 分页明细 + 移出）由 Task 11 在本组件内补。
Component({
  properties: {
    visible: { type: Boolean, value: false },
    // { name, avatarSrc, avatarText, countText, distanceText, durationText }
    member: { type: Object, value: null },
  },
  methods: {
    onClose() {
      this.triggerEvent('close');
    },
    noop() {},
  },
});
