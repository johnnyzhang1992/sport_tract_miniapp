/**
 * 首页运动类型显示与排序（2026-11-07，纯前端控制，不同步后端）。
 *
 * 产品口径：
 * - 散步/跑步/徒步/骑行 默认在首页展示；爬山/滑雪/划船/游泳 默认关闭，设置页打开后显示；
 * - 设置页把八个类型全部列出（含默认展示的四个），拖 ≡ 调整首页顺序，开关控制是否在首页展示；
 * - 只影响首页「运动类型」网格，统计/报告/已有记录/进行中的运动一概不受影响；
 * - 打卡点/休息点是标记工具不是运动，不进首页运动类型网格。
 *
 * 存储：{ order: [type...], hidden: [type...] }——order 持有全序（拖拽写入），hidden 持有关闭集合。
 * 读出时做归一化：config 增删类型后，旧存储自动补齐/剔除，不需要数据迁移。
 */
const config = require('../config/index');

const STORAGE_KEY = 'sport_type_display';

/** 参与首页显示/排序的 8 个运动类型（打卡点/休息点排除在外） */
const SPORT_TYPES = config.ACTIVITY_TYPES.filter((t) => !['checkpoint', 'rest'].includes(t.type));

/** 默认顺序 = config 顺序 */
const DEFAULT_ORDER = SPORT_TYPES.map((t) => t.type);

/** 默认关闭的四个：爬山/滑雪/划船/游泳（散步/跑步/徒步/骑行默认展示） */
const DEFAULT_HIDDEN = ['mountaineering', 'skiing', 'rowing', 'swimming'];

const listeners = [];

function readState() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (raw && Array.isArray(raw.order)) {
      // 归一化：**保留已存的顺序**（拖拽排序的意义就在这），config 新增的类型补到末尾，已删除的自动丢弃
      const known = raw.order.filter((t) => DEFAULT_ORDER.includes(t));
      const added = DEFAULT_ORDER.filter((t) => !known.includes(t));
      const hidden = Array.isArray(raw.hidden) ? raw.hidden.filter((t) => DEFAULT_ORDER.includes(t)) : [...DEFAULT_HIDDEN];
      return { order: [...known, ...added], hidden };
    }
  } catch (e) {
    // 读不到（隐私模式等）回落默认口径
  }
  return { order: [...DEFAULT_ORDER], hidden: [...DEFAULT_HIDDEN] };
}

function writeState(state) {
  try {
    wx.setStorageSync(STORAGE_KEY, state);
  } catch (e) {
    // 写不进就静默：本次会话内状态仍在内存里生效
  }
}

/** 首页网格数据：8 个运动类型按用户排序，滤掉已关闭的 */
function visibleTypes() {
  const { order, hidden } = readState();
  return SPORT_TYPES.filter((t) => !hidden.includes(t.type)).sort(
    (a, b) => order.indexOf(a.type) - order.indexOf(b.type),
  );
}

/** 设置页开关行：全部 8 行（按用户顺序），visible = 首页是否展示 */
function toggleRows() {
  const { order, hidden } = readState();
  const byType = new Map(SPORT_TYPES.map((t) => [t.type, t]));
  return order
    .map((type) => byType.get(type))
    .filter(Boolean)
    .map((t) => ({ type: t.type, label: t.label, iconImg: t.iconImg, visible: !hidden.includes(t.type) }));
}

/** 开关：从首页收起 / 恢复展示 */
function setTypeVisible(type, visible) {
  const { order, hidden } = readState();
  const next = new Set(hidden);
  if (visible) next.delete(type);
  else next.add(type);
  writeState({ order, hidden: [...next] });
  for (const fn of listeners) fn();
}

/** 拖拽排序落定：写入全序（归一化交给读出端） */
function setOrder(orderTypes) {
  const { hidden } = readState();
  writeState({ order: orderTypes, hidden });
  for (const fn of listeners) fn();
}

function isTypeVisible(type) {
  const { hidden } = readState();
  return !hidden.includes(type);
}

/** 订阅变化（首页实时刷新网格用），返回退订函数 */
function onChange(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

module.exports = { SPORT_TYPES, DEFAULT_ORDER, DEFAULT_HIDDEN, visibleTypes, toggleRows, setTypeVisible, setOrder, isTypeVisible, onChange };
