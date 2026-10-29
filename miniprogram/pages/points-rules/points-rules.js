/**
 * 积分规则：签到/任务等静态说明 + 榜单奖励段落由服务端下发。
 *
 * 榜单分值写死会和后台脱节（spec §4.6/§4.8）：六句文案的唯一真值在 api 的
 * boardRulesText()，这里只渲染 GET /points/rules 的 boardRules 数组，不写第二份数字。
 * 该接口是公开的（同 GET /ads），游客进规则页也能读；请求失败就整段缺席——
 * 宁可少一段，也不回落硬编码的旧分值。
 */
const api = require('../../services/api');

Page({
  data: {
    // 服务端下发的榜单奖励六句；空数组 ⇒ wxml 的 wx:if 让整段不出（失败时的静默状态）
    boardRules: [],
  },

  onLoad() {
    this.fetchBoardRules();
  },

  async fetchBoardRules() {
    try {
      const data = await api.get('/points/rules');
      this.setData({ boardRules: (data && data.boardRules) || [] });
    } catch (e) {
      // 静默：静态段落照常可读；不弹 toast、不进失败块（规则页没有「重试」需求）
      this.setData({ boardRules: [] });
    }
  },
});
