const config = require('../config/index');

function isAdRewardEligible(res) {
  return !!(res && res.isEnded === true);
}

function createRewardedAd() {
  if (!wx.createRewardedVideoAd) return null;
  return wx.createRewardedVideoAd({ adUnitId: config.REWARDED_VIDEO_AD_UNIT_ID });
}

module.exports = { isAdRewardEligible, createRewardedAd };
