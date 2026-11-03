/**
 * 会员页视图数据（纯函数，真值全部来自服务端）。
 * 纪律与 utils/points-view.js 一致：价格、日均、权益行、状态行都由接口下发，
 * 端上只做「有没有」的形态判断，不做金额换算与文案拼装。
 */
const { compareVersion, MIN_XPAY_SDK, MIN_IOS_CLIENT } = require('./compare-version');

/** 分→元：仅用于兜底（服务端没下发 priceText 时）。199→1.99、5→0.05、100→1 */
function fenToYuanText(fen) {
  const n = Number(fen);
  if (!Number.isFinite(n) || n <= 0) return '0';
  const yuan = n / 100;
  return Number.isInteger(yuan) ? String(yuan) : String(Number(yuan.toFixed(2)));
}

function buildPlanCards(items) {
  return (Array.isArray(items) ? items : []).map((i) => ({
    key: i.key,
    name: i.name,
    subtitle: i.subtitle || '',
    priceText: i.priceText || fenToYuanText(i.priceFen),
    perDayText: i.perDayText || '',
    durationText: i.durationText || '',
    perkLines: Array.isArray(i.perkLines) ? i.perkLines : [],
  }));
}

/** 付费入口可见性（spec §8 平台差异 + §11.7 总开关） */
function payVisible(o) {
  if (!o || o.enabled !== true) return false;
  if (compareVersion(o.sdkVersion, MIN_XPAY_SDK) < 0) return false;
  if (o.platform === 'ios') return o.iosPayReady === true;
  return true;
}

module.exports = { fenToYuanText, buildPlanCards, payVisible, MIN_IOS_CLIENT };
