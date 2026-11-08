/**
 * 首页运动类型显示与排序（utils/sport-display.js）+ 两页接线测试。
 * 产品口径（2026-11-07 定稿）：首页默认展示散步/跑步/徒步/骑行四个；设置页把八个类型全部
 * 列出（含默认展示的四个），爬山/滑雪/划船/游泳默认关闭、打开后进首页；可拖 ≡ 排序；
 * 仅前端控制（wx storage），统计/报告/已有记录不受影响；打卡点/休息点不进网格。
 * 运行：npm test；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

/* ---------------------------------- 环境桩 ---------------------------------- */

const storage = new Map();
global.wx = {
  getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
  setStorageSync: (k, v) => storage.set(k, v),
  getSystemInfoSync: () => ({ windowWidth: 375 }),
};

const config = require('../miniprogram/config/index');
const sportDisplay = require('../miniprogram/utils/sport-display.js');

const SPORT_8 = config.ACTIVITY_TYPES.filter((t) => !['checkpoint', 'rest'].includes(t.type)).map((t) => t.type);

test('SD1 默认口径：首页只有散步/跑步/徒步/骑行；设置页八行全列出，其它四个默认关', () => {
  const visible = sportDisplay.visibleTypes().map((t) => t.type);
  assert.deepEqual(visible, ['walking', 'running', 'hiking', 'cycling']);
  assert.equal(visible.includes('checkpoint'), false);
  assert.equal(visible.includes('rest'), false);

  const rows = sportDisplay.toggleRows();
  assert.equal(rows.length, 8, '设置页八行全列出（含默认展示的四个）');
  const byType = Object.fromEntries(rows.map((r) => [r.type, r.visible]));
  assert.equal(byType.walking, true);
  assert.equal(byType.running, true);
  assert.equal(byType.hiking, true);
  assert.equal(byType.cycling, true);
  assert.equal(byType.mountaineering, false, '爬山默认关');
  assert.equal(byType.skiing, false, '滑雪默认关');
  assert.equal(byType.rowing, false, '划船默认关');
  assert.equal(byType.swimming, false, '游泳默认关');
});

test('SD2 打开爬山：进首页（插在徒步与骑行之间，config 顺序）；再关掉回到四类', () => {
  sportDisplay.setTypeVisible('mountaineering', true);
  assert.deepEqual(
    sportDisplay.visibleTypes().map((t) => t.type),
    ['walking', 'running', 'hiking', 'mountaineering', 'cycling'],
    '打开的类型按 order 插回原位',
  );
  const row = sportDisplay.toggleRows().find((r) => r.type === 'mountaineering');
  assert.equal(row.visible, true);

  sportDisplay.setTypeVisible('mountaineering', false);
  assert.deepEqual(
    sportDisplay.visibleTypes().map((t) => t.type),
    ['walking', 'running', 'hiking', 'cycling'],
    '关闭后回落默认四类',
  );
});

test('SD3 拖拽排序：setOrder 全序落库，首页网格按新顺序渲染（默认关闭的仍不显示）', () => {
  const reordered = [...SPORT_8].reverse();
  sportDisplay.setOrder(reordered);
  // 默认关闭的四个仍不可见，可见四个按新顺序倒排
  assert.deepEqual(
    sportDisplay.visibleTypes().map((t) => t.type),
    ['swimming' === 'x' ? '' : 'cycling', 'hiking', 'running', 'walking'],
  );
  assert.deepEqual(
    sportDisplay.toggleRows().map((r) => r.type),
    reordered,
    '设置页行序与首页顺序存储一致（八行）',
  );
});

test('SD4 归一化：setOrder 丢项/传入未知类型都不会弄丢八类（默认关闭的仍关闭）', () => {
  sportDisplay.setOrder(['running', 'walking']); // 只给 2 个
  const rows = sportDisplay.toggleRows();
  assert.equal(rows.length, 8, '缺的自动补到末尾');
  assert.equal(rows[0].type, 'running');
  assert.equal(rows[1].type, 'walking');
  // 可见 = order（running, walking, 补齐的 hiking/...）去掉默认关闭的四个（爬山/滑雪/划船/游泳）
  const visible = sportDisplay.visibleTypes().map((t) => t.type);
  assert.deepEqual(visible, ['running', 'walking', 'hiking', 'cycling']);
  sportDisplay.setOrder([...SPORT_8, 'checkpoint', 'not-a-type']); // 多余项被丢弃
  assert.equal(sportDisplay.visibleTypes().length, 4);
});

test('SD5 onChange：开关与排序都通知，退订后不再通知', () => {
  let hits = 0;
  const off = sportDisplay.onChange(() => hits++);
  sportDisplay.setTypeVisible('swimming', false);
  assert.equal(hits, 1);
  sportDisplay.setOrder(SPORT_8);
  assert.equal(hits, 2);
  off();
  sportDisplay.setTypeVisible('swimming', true);
  assert.equal(hits, 2, '退订后不再通知');
});

test('SD6 关闭状态跨排序保留：先开游泳再关，拖排序后游泳仍不在首页', () => {
  sportDisplay.setTypeVisible('swimming', true);
  sportDisplay.setTypeVisible('swimming', false);
  const reordered = [...SPORT_8].reverse();
  sportDisplay.setOrder(reordered);
  const visible = sportDisplay.visibleTypes().map((t) => t.type);
  assert.equal(visible.includes('swimming'), false, '排序不得复活已关闭的类型');
  assert.equal(visible.length, 4);
});

/* ------------------------------- 页面接线 ------------------------------- */

const fs = require('node:fs');
const path = require('node:path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('SD-P1 首页网格 = 可见类型按用户顺序渲染；旧默认类型逻辑已移除', () => {
  const js = read('miniprogram/pages/index/index.js');
  assert.match(js, /applySportDisplay\(\) \{[\s\S]*?sportDisplay\.visibleTypes\(\)/, '网格数据来自排序后的可见集');
  assert.match(js, /isTypeVisible\(this\.data\.selectedType\)[\s\S]*?selectedType: 'running'/, '选中类型被关时回落跑步');
  assert.match(js, /sportDisplay\.onChange\(/, '设置页改动实时通知首页');
  assert.equal(js.includes('applyDefaultType'), false, '旧默认类型逻辑应已删除');
});

test('SD-P2 设置页：八行开关 + 拖拽手柄 + 落定写 setOrder', () => {
  const wxml = read('miniprogram/pages/settings/settings.wxml');
  const js = read('miniprogram/pages/settings/settings.js');
  assert.match(wxml, /运动类型显示/, '开关卡标题');
  assert.match(wxml, /wx:for="\{\{sportTypeRows\}\}"/, '八行渲染');
  assert.match(wxml, /catchtouchstart="onDragStart"[\s\S]*?catchtouchmove="onDragMove"[\s\S]*?catchtouchend="onDragEnd"/, '手柄拖拽三件套');
  assert.match(wxml, /bind:change="onSportTypeToggle"/, '开关绑定');
  assert.match(js, /onDragEnd\(\) \{[\s\S]*?sportDisplay\.setOrder\(this\.data\.sportTypeRows\.map/, '落定写全序');
  assert.match(js, /Math\.trunc\(\(y - this\._dragAnchorY\) \/ rowH\)/, '越过阈值整行换位');
  assert.equal(js.includes('defaultType'), false, '设置页不再引用 defaultType');
});

test('SD-P3 排序变更经过 onChange 通知首页（两页联动的通路在）', () => {
  let hits = 0;
  const off = sportDisplay.onChange(() => hits++);
  sportDisplay.setTypeVisible('swimming', true); // 打开一个默认关闭的，验证排序+可见性一起生效
  const reordered = [...SPORT_8].reverse();
  sportDisplay.setOrder(reordered);
  assert.ok(hits >= 2, '开关与排序都触发通知');
  assert.deepEqual(
    sportDisplay.visibleTypes().map((t) => t.type),
    reordered.filter((t) => !['mountaineering', 'skiing', 'rowing'].includes(t)),
    '通知期间首页读到新顺序（其余三个默认关闭的仍不显示）',
  );
  off();
});
