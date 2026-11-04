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
    // 只用于挑「日均最低」角标，金额文案仍然只认服务端 perDayText
    priceFen: Number(i.priceFen) || 0,
    durationDays: Number(i.durationDays) || 0,
  }));
}

/**
 * 「日均最低」角标落在哪一档：拿服务端的 priceFen/durationDays 比大小，
 * 只产出 key、不产出金额文案；缺字段或只有一档时返回空串（不挂角标）。
 */
function bestValueKey(cards) {
  const list = (Array.isArray(cards) ? cards : []).filter((c) => c.priceFen > 0 && c.durationDays > 0);
  if (list.length < 2) return '';
  const ratio = (c) => c.priceFen / c.durationDays;
  const best = list.reduce((a, b) => (ratio(b) < ratio(a) ? b : a));
  return best.key || '';
}

/**
 * 状态句拆成「大标题 / 副标题」两行展示，不新增也不改写文案：
 * 服务端给的是「会员生效中 · 有效期至 …」，按 ' · ' 断开；没有分隔符就整句放标题。
 */
function splitStatusText(text) {
  const s = String(text || '').trim();
  if (!s) return { title: '', sub: '' };
  const at = s.indexOf(' · ');
  if (at < 0) return { title: s, sub: '' };
  return { title: s.slice(0, at), sub: s.slice(at + 3) };
}

/** 权益行 → 图标：按服务端文案关键词配字形，认不出来就给中性宝石，不隐藏这一行 */
const PERK_ICONS = [
  { re: /广告/, icon: '/assets/icons/lucide-ban-blue.png' },
  { re: /GPX|导出/, icon: '/assets/icons/lucide-download-blue.png' },
  { re: /照片|图片/, icon: '/assets/icons/lucide-image-blue.png' },
  { re: /订阅|提醒/, icon: '/assets/icons/lucide-bell-blue.png' },
];
const PERK_FALLBACK_ICON = '/assets/icons/lucide-gem-blue.png';

function buildPerkItems(lines) {
  return (Array.isArray(lines) ? lines : []).map((text) => {
    const hit = PERK_ICONS.find((p) => p.re.test(text));
    return { text, icon: hit ? hit.icon : PERK_FALLBACK_ICON };
  });
}

/** 付费入口可见性（spec §8 平台差异 + §11.7 总开关） */
function payVisible(o) {
  if (!o || o.enabled !== true) return false;
  if (compareVersion(o.sdkVersion, MIN_XPAY_SDK) < 0) return false;
  if (o.platform === 'ios') return o.iosPayReady === true;
  return true;
}

module.exports = {
  fenToYuanText,
  buildPlanCards,
  bestValueKey,
  splitStatusText,
  buildPerkItems,
  payVisible,
  MIN_IOS_CLIENT,
};
