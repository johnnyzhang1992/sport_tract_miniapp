/**
 * utils/loading.js — wx.showLoading / wx.hideLoading 配对保护
 *
 * 背景：原生 showLoading/hideLoading 必须严格配对，违背了会报
 * "请注意 showLoading 与 hideLoading 必须配对使用"（重复 show、或先 showToast 抢占后 hide 等）。
 *
 * 思路：计数器守卫。
 *  - show()：重复调用只累加计数，不重复弹 Loading（消除连点/多流程叠加导致的重复 show）；
 *  - hide()：只在计数归零时真正调 hideLoading；无 Loading 时调用是安全的空操作；
 *  - reset()：页面 onUnload / 组件 detached 时兜底清理，避免跨页面串号残留。
 */
let count = 0;

function show(title, options = {}) {
  count += 1;
  if (count === 1) {
    wx.showLoading({ title: title || '加载中', ...options });
  }
}

function hide() {
  if (count <= 0) return;
  count -= 1;
  if (count === 0) {
    wx.hideLoading();
  }
}

function reset() {
  if (count > 0) {
    count = 0;
    wx.hideLoading();
  }
}

module.exports = { show, hide, reset };