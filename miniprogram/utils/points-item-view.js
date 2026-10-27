/**
 * 商品详情页取数纯函数（pages/points-item 用）：
 * 从 GET /points/items 的整张在架商品表里挑出 ?key= 指定的那一件。
 * 取不到就回落第一项：老链接不带 key、链接里的 key 拼错、商品已被后台下架（不在在架表里）都走这条路。
 * 服务端 listActiveItems 按 sortOrder 升序且把 makeup_card 排最前（老客户端读 items[0]），
 * 所以回落第一项＝一期只有补签卡时的老行为，老链接不会破。
 */
function pickItem(items, key) {
  if (!Array.isArray(items) || !items.length) return null;
  if (key) {
    const hit = items.find((it) => it && it.key === key);
    if (hit) return hit;
  }
  return items[0] || null;
}

/**
 * 是否补签卡（决定「我的补签卡」「去补签」「登录后兑换补签卡」这些补签专属块显不显示）：
 * effect 缺失＝目录表化之前的老数据（当时只有补签卡），按 makeup 处理；其余只看 effect.kind。
 */
function isMakeup(item) {
  if (!item) return false;
  if (!item.effect) return true;
  return item.effect.kind === 'makeup';
}

/**
 * 实物商品：兑换要填收货地址、落的是订单（不发卡），所以详情页多出地址卡与详情图轮播。
 * kind 由服务端 listActiveItems 兜底成 'virtual'（老目录行物理缺这个字段），这里只看字面值。
 */
function isPhysical(item) {
  return !!item && item.kind === 'physical';
}

/**
 * 收货地址三件套校验（与 api 的 validateAddress 同口径）：返回第一条错误文案，全对返回 ''。
 * 服务端仍是最终裁判，这里只是让人在点「兑换」当场看到哪个格子不对；
 * 上限与判据必须照抄服务端，两边各写一套就会出现「前端放行、后端 400」。
 */
function addressError(addr) {
  const a = addr || {};
  const receiver = typeof a.receiver === 'string' ? a.receiver.trim() : '';
  if (receiver.length < 1 || receiver.length > 20) return '收货人姓名需 1–20 字';
  const phone = typeof a.phone === 'string' ? a.phone.trim() : '';
  if (!/^1[3-9]\d{9}$/.test(phone)) return '请填写 11 位大陆手机号';
  const detail = typeof a.detail === 'string' ? a.detail.trim() : '';
  if (detail.length < 5 || detail.length > 120) return '详细地址需 5–120 字';
  return '';
}

/** 交给服务端的地址：trim 后提交，别把带首尾空格的值丢过去再被服务端打回 */
function cleanAddress(addr) {
  const a = addr || {};
  return {
    receiver: String(a.receiver || '').trim(),
    phone: String(a.phone || '').trim(),
    detail: String(a.detail || '').trim(),
  };
}

module.exports = { pickItem, isMakeup, isPhysical, addressError, cleanAddress };
