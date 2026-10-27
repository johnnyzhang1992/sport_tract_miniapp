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

module.exports = { pickItem, isMakeup };
