/**
 * 首页「数据已过期」标记。
 * 首页 onShow 有 60s 节流；跑完/删除一条轨迹、加入/退出/发起活动之后，数字必须立刻更新，
 * 所以这些写操作成功后打一个标记，让下一次 onShow 无视 TTL 重拉。
 * 只认全局一个布尔量：首页自己消费后清掉（见 pages/index/index.js 的 onShow）。
 */
function markHomeDirty() {
  // sync.js 也会调（结束运动），单测里不一定有 getApp —— 缺了就什么都不做
  if (typeof getApp !== 'function') return;
  const app = getApp();
  if (app && app.globalData) app.globalData.homeDirty = true;
}

module.exports = { markHomeDirty };
