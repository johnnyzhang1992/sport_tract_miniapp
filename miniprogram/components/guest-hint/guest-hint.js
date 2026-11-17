/**
 * 未登录引导（2026-11-17 统一）
 *
 * 背景：接入徽章页时发现未登录 UI 有 3 种实现并存——
 *   - login-hint（stats/tracks/report/overview/leaderboard 各抄一份 wxss）
 *   - guest-card（badges/plan-history 各一份）
 *   - 行内 login-empty（footprint-list）、fp-tip（footprints）
 * 样式和文案都不一致，改一次要改五处。这个组件把它们收成一份。
 *
 * 用法：
 *   <guest-hint wx:if="{{notLoggedIn}}" feature="运动统计" bind:login="onLogin" />
 *
 * props:
 *   feature  功能名，用于拼文案：标题「登录后查看你的{feature}」
 *   icon     图标路径（不同功能给不同图标，保持页面辨识度）
 *   tip      标题下方的补充说明（默认一句通用的）
 *   compact  紧凑模式：不撑满整屏，用于卡片内嵌（如首页顶部提示条场景）
 *
 * 事件：
 *   bind:login  用户点了「微信一键登录」。**组件不自己调 app.login()**，
 *               因为不同页面的登录后动作不同（重拉数据/刷新 canvas/跳转），统一由页面处理。
 */
Component({
  properties: {
    /** 功能名，如「运动统计」「我的徽章」「运动计划」 */
    feature: { type: String, value: '运动数据' },
    /** 图标路径；不传则用通用用户图标 */
    icon: { type: String, value: '/assets/icons/lucide-user.png' },
    /** 补充说明；不传用默认文案 */
    tip: { type: String, value: '' },
    /** 紧凑模式：缩小内边距，用于嵌在卡片里 */
    compact: { type: Boolean, value: false },
  },

  methods: {
    onTapLogin() {
      this.triggerEvent('login');
    },
  },
});