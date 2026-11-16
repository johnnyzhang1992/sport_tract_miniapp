/**
 * utils/badge-shape.js（2026-11-16 收口）：形状 → 样式类等纯展示翻译。
 *
 * 这份映射原来在三个地方各抄了一遍（badge-wall 组件 / 计划页 / 我的徽章页），
 * 实测踩过「我的徽章页漏了它 → 弹窗里徽章没形状没颜色」的 bug。
 * 这些测试守两件事：
 *   1. 每种形状都能翻译成样式类，且三处调用方取到的是同一份结果
 *   2. 后端加了新形状而小程序没发版时，退化成圆牌而不是白框
 * 运行：node --test test/badge-shape.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  SHAPE_CLASS,
  shapeClassOf,
  centerTextOf,
  typeIconOf,
  isRingBadge,
} = require('../miniprogram/utils/badge-shape.js');

test('BS1 配置里的 11 种形状都有样式类', () => {
  const shapes = [
    'plan', 'dist', 'dur', 'streak', 'ring',
    'total-dist', 'total-dur',
    'week-all', 'week-distance', 'week-duration', 'week-count',
  ];
  for (const s of shapes) {
    assert.equal(shapeClassOf(s), SHAPE_CLASS[s], `${s} 没有映射到自己的类`);
    assert.ok(SHAPE_CLASS[s], `${s} 样式类为空`);
  }
  assert.equal(Object.keys(SHAPE_CLASS).length, shapes.length, '映射数量与形状数量一致');
});

test('BS2 未知/空形状兜底成圆牌，不返回空串', () => {
  for (const bad of ['never-seen', '', null, undefined, 0]) {
    assert.equal(shapeClassOf(bad), 'b-plan', `${String(bad)} 应兜底 b-plan`);
  }
});

test('BS3 中央文字：优先 badgeText（完美周是 emoji），否则用档位数', () => {
  assert.equal(centerTextOf({ badgeText: '🌟', tier: 1 }), '🌟', '完美周用 emoji');
  assert.equal(centerTextOf({ tier: 100 }), '100', '普通章印档位');
  assert.equal(centerTextOf({ badgeText: '', tier: 365 }), '365', '空 badgeText 退回档位');
  assert.equal(centerTextOf(null), '');
  assert.equal(centerTextOf({}), '');
});

test('BS4 类型图标：只有分类型徽章有，且用白色变体', () => {
  assert.equal(typeIconOf({ activityIconId: 'running' }), '/assets/icons/activity-running-white.png');
  assert.equal(typeIconOf({ activityIconId: 'cycling' }), '/assets/icons/activity-cycling-white.png');
  assert.equal(typeIconOf({}), '', '普通徽章没有图标');
  assert.equal(typeIconOf(null), '');
});

test('BS5 类型图标文件确实存在（防路径写错导致破图）', () => {
  for (const id of ['walking', 'running', 'hiking', 'cycling', 'mountaineering']) {
    const rel = typeIconOf({ activityIconId: id });
    const file = path.join(__dirname, '../miniprogram', rel);
    assert.ok(fs.existsSync(file), `${rel} 不存在`);
  }
});

test('BS6 只有「合上圆环」走嵌套三环造型', () => {
  assert.equal(isRingBadge({ group: 'rings' }), true);
  for (const g of ['plan', 'record', 'streak', 'activity-type', 'week', 'total-distance']) {
    assert.equal(isRingBadge({ group: g }), false, `${g} 不应是三环`);
  }
  assert.equal(isRingBadge(null), false);
});

test('BS7 三个调用方引用的都是同一份实现（防再次各抄一份）', () => {
  const files = [
    'components/badge-wall/badge-wall.js',
    'pages/plan-history/plan-history.js',
    'pages/badges/badges.js',
  ];
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, '../miniprogram', f), 'utf8');
    assert.ok(src.includes("require('../../utils/badge-shape.js')"), `${f} 应引用 utils/badge-shape.js`);
    // 不允许再出现写死的映射表
    assert.ok(!src.includes('b-shield b-dist'), `${f} 又写死了形状映射`);
    assert.ok(!src.includes('BADGE_SHAPE_CLASS'), `${f} 又自建了映射表`);
  }
});