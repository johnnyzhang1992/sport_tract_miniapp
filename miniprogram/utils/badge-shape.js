/**
 * 徽章形状 → 样式类（2026-11-16 收口）
 *
 * 为什么单独一个模块：这段映射原来在三个地方各抄了一份
 *   - components/badge-wall/badge-wall.js   徽章墙组件
 *   - pages/plan-history/plan-history.js    计划页（详情半屏 + 扁平表）
 *   - pages/badges/badges.js                我的徽章页（详情半屏）
 * 三份不一致就会出问题——实测踩过：「我的徽章」页漏了这份映射，弹窗里的徽章
 * 没有形状和颜色，只剩一个淡数字。现在统一从这里取。
 *
 * 唯一还需要前端知道的事就是「形状叫什么」：
 * 后端 /plan/summary 的 trophies[].shape 下发形状名（plan/dist/dur/...），
 * 前端把它翻译成 WXSS 里的类名。新增形状时：
 *   1. 后端 badge-config.ts 的 BadgeShape 加一个枚举值
 *   2. 这里加一行映射
 *   3. badge-wall.wxss 写对应的 b-<shape> 样式
 * 三步都在「加形状」这一个动作里，不会漏。
 */

/** 形状 → WXSS 类名 */
const SHAPE_CLASS = {
  plan: 'b-plan',
  dist: 'b-shield b-dist',
  dur: 'b-hex b-dur',
  streak: 'b-hex b-streak',
  ring: 'b-ring',
  // 累计里程=方牌、累计时长=表盘：形状全部由自己的类定义（不能挂 b-shield/b-hex，clip-path 会裁掉装饰）
  'total-dist': 'b-total-dist',
  'total-dur': 'b-total-dur',
  'week-all': 'b-hex b-week-all',
  'week-distance': 'b-shield b-week-distance',
  'week-duration': 'b-hex b-week-duration',
  'week-count': 'b-ring b-week-count',
};

/** 兜底形状：新形状在后端上线而小程序还没发版时，退化成圆牌而不是白框 */
const FALLBACK_SHAPE = 'plan';

/**
 * 形状 → 样式类。
 * @param {string} shape 后端下发的形状名（可能为空/未知）
 * @returns {string} 形如 'b-shield b-dist' 的类名
 */
function shapeClassOf(shape) {
  if (!shape) return SHAPE_CLASS[FALLBACK_SHAPE];
  return SHAPE_CLASS[shape] || SHAPE_CLASS[FALLBACK_SHAPE];
}

/** 徽章中央文字：优先服务端 badgeText（完美周是 emoji），兜底档位数 */
function centerTextOf(t) {
  if (!t) return '';
  return t.badgeText || String(t.tier || '');
}

/**
 * 分运动类型徽章的图标路径（白色变体，叠在彩色章面上才看得清）。
 * 非分类型徽章返回空串；图标缺失也不报错，只是不叠加（宁可只有数字）。
 */
function typeIconOf(t) {
  const id = t && t.activityIconId;
  return id ? `/assets/icons/activity-${id}-white.png` : '';
}

/** 「合上圆环」用嵌套三环造型，与其它形状不是一个渲染分支 */
function isRingBadge(t) {
  return !!t && t.group === 'rings';
}

module.exports = {
  SHAPE_CLASS,
  shapeClassOf,
  centerTextOf,
  typeIconOf,
  isRingBadge,
};