// 活动成员信息半屏：标题行是头像+昵称（`member` 由页面给，组件不自己拉）+ 「我 vs TA」对照
// （`compare`，页面算好给进来）+ 该成员在本活动内计入的轨迹明细（`detail` 由页面拉好给进来）。
// 开启步数辅助 / 步数PK 时多一档「按天」视图（`steps` 同样由页面拉），翻页只往页面抛事件。
// 明细对活动内成员一律开放，所以组件不持有查看者身份：它只认数据有没有落地。
Component({
  properties: {
    visible: { type: Boolean, value: false },
    // { name, avatarSrc, avatarText, countText, distanceText, durationText, stepText }
    member: { type: Object, value: null },
    // none＝普通活动（只有轨迹）；aux＝普通活动开启了步数辅助；steps＝步数PK
    stepMode: { type: String, value: 'none' },
    // 明细数据（页面产物）：
    // { loading, error, stats:{countText,distanceText,durationText}, items:[{id,typeText,timeText,distanceText,durationText,elevationText}], total, hasMore, loadingMore }
    detail: { type: Object, value: null },
    // 按天数据（页面产物）：
    // { loading, error, summary:{distanceText,stepText,days}, items:[{dateText,weekText,distanceText,stepText,hasStep,status,statusText}], total, hasMore, loadingMore }
    steps: { type: Object, value: null },
    // 「我 vs TA」对照（页面产物）：{ rows:[{label,myText,taText,state,diffText}] }；没有对照时为 null
    compare: { type: Object, value: null },
  },

  data: {
    tab: 'track', // track | day
  },

  observers: {
    'visible, member, stepMode': function (visible, member, stepMode) {
      if (!visible || !member) {
        this.setData({ tab: 'track' });
        return;
      }
      // 步数PK 没有轨迹口径，直接落在按天；普通活动（含辅助）默认轨迹
      this.setData({ tab: stepMode === 'steps' ? 'day' : 'track' });
    },
  },

  methods: {
    onClose() {
      this.triggerEvent('close');
    },

    onTabTap(e) {
      const tab = e.currentTarget.dataset.tab;
      if (!tab || tab === this.data.tab) return;
      this.setData({ tab });
      // 按天数据懒加载：第一次切过去、或上次失败时再请一次
      if (tab === 'day' && (!this.data.steps || this.data.steps.error)) {
        this.triggerEvent('loadsteps');
      }
    },

    /** 「加载更多」：只在上游说还有下一页、且当前不在加载中时抛事件（防连点重复拉） */
    onLoadMore() {
      const d = this.data.detail;
      if (!d || !d.hasMore || d.loadingMore) return;
      this.triggerEvent('loadmore');
    },

    onStepsLoadMore() {
      const d = this.data.steps;
      if (!d || !d.hasMore || d.loadingMore) return;
      this.triggerEvent('stepsloadmore');
    },

    noop() {},
  },
});
