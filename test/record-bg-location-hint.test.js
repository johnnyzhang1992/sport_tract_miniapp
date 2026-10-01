/**
 * 录制页「后台定位未开启」提示条（底部按钮组上方）
 *
 * 判据只用 wx.getSetting().authSetting['scope.userLocationBackground']：
 * undefined（从没问过）和 false（明确没给）都算没开 → 提示；true → 不提示。
 * 关闭只对当前页面实例生效（不写 storage）：下次进这一页还要提示。
 * 桩：Page() 就地捕获定义 + wx.getSetting/openSetting 计数（同 record-vehicle-toast 写法）。
 * 跑法：node --test test/record-bg-location-hint.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let page = null;
let bgScope;
const calls = [];

global.wx = {
  getSetting(opts) {
    calls.push(['getSetting']);
    opts.success({ authSetting: { 'scope.userLocationBackground': bgScope } });
  },
  openSetting(opts) {
    calls.push(['openSetting']);
    if (opts && opts.success) opts.success({ authSetting: {} });
  },
  showToast(o) {
    calls.push(['showToast', o]);
  },
  getStorageSync: () => '',
  setStorageSync() {},
  removeStorageSync() {},
  showLoading() {},
  hideLoading() {},
  stopLocationUpdate() {},
  setKeepScreenOn() {},
  vibrateShort() {},
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667 }),
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }),
  createMapContext: () => ({}),
};
global.getApp = () => ({ globalData: {}, hasSession: () => false });
global.Page = (o) => {
  page = o;
};
require('../miniprogram/pages/record/record.js');

/** 假页面：走原型链拿到页面方法（真 Page 实例就是这样），只带这条提示逻辑要用的字段 */
function makeCtx() {
  const ctx = Object.create(page);
  ctx.data = { bgLocHintVisible: false };
  ctx.tracker = null; // 首次进入时 tracker 还没建
  ctx.setData = function setData(patch) {
    Object.assign(this.data, patch);
  };
  return ctx;
}

test('H1 scope 明确没给（false）→ 提示', () => {
  bgScope = false;
  const c = makeCtx();
  page.refreshBgLocHint.call(c);
  assert.equal(c.data.bgLocHintVisible, true);
});

test('H2 从没问过（undefined）也算没开 → 提示', () => {
  bgScope = undefined;
  const c = makeCtx();
  page.refreshBgLocHint.call(c);
  assert.equal(c.data.bgLocHintVisible, true, 'undefined 不等于"已开启"，不提示就等于漏提醒');
});

test('H3 已开启（true）→ 不提示', () => {
  bgScope = true;
  const c = makeCtx();
  c.data.bgLocHintVisible = true;
  page.refreshBgLocHint.call(c);
  assert.equal(c.data.bgLocHintVisible, false);
});

test('H4 关掉只对当次有效：本实例不再弹，重进这一页还会弹', () => {
  bgScope = false;
  const c = makeCtx();
  c.data.bgLocHintVisible = true;

  page.dismissBgLocHint.call(c);
  assert.equal(c.data.bgLocHintVisible, false, '点 X 要当场收起');

  page.refreshBgLocHint.call(c);
  assert.equal(c.data.bgLocHintVisible, false, '同一场运动里不该又弹回来');

  const again = makeCtx();
  page.refreshBgLocHint.call(again);
  assert.equal(again.data.bgLocHintVisible, true, '新一次进入页面要重新提示（不持久化关闭状态）');
});

test('H5「去开启」直接进设置页，不自己拼引导文案', () => {
  bgScope = false;
  const c = makeCtx();
  calls.length = 0;
  page.openBgLocationSetting.call(c);
  assert.ok(
    calls.some((x) => x[0] === 'openSetting'),
    `应调 wx.openSetting，实际 ${JSON.stringify(calls)}`,
  );
});

test('H6 首次进入（tracker 还没建）也要算一次提示：刷新必须排在 tracker 早退之前', () => {
  bgScope = false;
  const c = makeCtx();
  calls.length = 0;
  page.onShow.call(c);
  assert.ok(
    calls.some((x) => x[0] === 'getSetting'),
    'onShow 要重查权限（去设置里开完回来，提示该自动消失）',
  );
  assert.equal(c.data.bgLocHintVisible, true, '查完就要落到 visible 上');
});
