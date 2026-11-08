/**
 * 导航栏标题防串页（2026-11-07）。
 *
 * 动态标题都写在异步回调里（详情落地后改写标题）。回调回来时页面可能已经退场
 * （用户手快返回/跳走），此时 wx.setNavigationBarTitle 作用在**当前前台页**上——
 * 最常见的事故就是详情页的标题落到首页（首页明明配了「开始运动」也会被盖掉）。
 *
 * 闸门口径：只有能证明「调用页不是栈顶」时才拦截；运行时 getCurrentPages 恒可用，
 * 拦截必然生效。缺这个全局的环境（部分测试桩）直接放行走原行为——宁可少拦，不误伤。
 */
function setPageTitle(page, title) {
  if (typeof getCurrentPages === 'function') {
    const stack = getCurrentPages();
    const top = stack && stack[stack.length - 1];
    if (top && top !== page) return;
  }
  wx.setNavigationBarTitle({ title: String(title || '') });
}

module.exports = { setPageTitle };
