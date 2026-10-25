/**
 * 激励视频广告（miniprogram/utils/rewarded-ad.js）单测：
 * 只有 onClose 回传 isEnded === true 才算完播，其余（提前关闭/空回调）一律不发奖。
 * 运行：node --test test/rewarded-ad.test.js；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isAdRewardEligible } = require('../miniprogram/utils/rewarded-ad.js');

test('PV3 广告只有 isEnded=true 才算完播', () => {
  assert.equal(isAdRewardEligible({ isEnded: true }), true);
  assert.equal(isAdRewardEligible({ isEnded: false }), false);
  assert.equal(isAdRewardEligible(null), false);
});
