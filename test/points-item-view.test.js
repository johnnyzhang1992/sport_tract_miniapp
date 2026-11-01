/**
 * 商品详情页取数纯函数（miniprogram/utils/points-item-view.js）单测：
 * 详情页按 ?key= 从整张商品表里挑一件展示，兑换接口也按这件商品的 key 拼；
 * 老链接不带 key、key 拼错、商品被后台下架（不在在架列表里）都回落第一项——
 * 服务端 listActiveItems 把 makeup_card 排在 sortOrder 最前（老客户端读 items[0]），回落即老行为。
 * 运行：node --test test/points-item-view.test.js；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickItem, isMakeup } = require('../miniprogram/utils/points-item-view.js');

test('PIV-1 按 key 命中；key 缺失或查不到时回落到第一项（老链接不破）', () => {
  const items = [{ key: 'makeup_card' }, { key: 'ad_free_7d' }];
  assert.equal(pickItem(items, 'ad_free_7d').key, 'ad_free_7d');
  assert.equal(pickItem(items, '').key, 'makeup_card');
  assert.equal(pickItem(items, 'nope').key, 'makeup_card');
  assert.equal(pickItem(undefined, 'x'), null);
});

test('PIV-1b 空表 / 非数组 / 表里空项都不炸，取不到就是 null', () => {
  assert.equal(pickItem([], 'x'), null, '在架商品全下架时给 null，页面走「无商品」分支而不是拿 undefined 去取值');
  assert.equal(pickItem(null, 'x'), null);
  assert.equal(pickItem({ 0: { key: 'makeup_card' } }, 'x'), null, '非数组按无数据处理');
  assert.equal(pickItem([null], 'x'), null, '空项不当作商品');
  assert.equal(pickItem([null, { key: 'ad_free_7d' }], 'nope'), null, '回落目标是第一项本身为空时也不越界取第二项');
});

test('PIV-2 effect 缺失的老数据按 makeup 处理（补签说明与入口照常显示）', () => {
  assert.equal(isMakeup({}), true);
  assert.equal(isMakeup({ effect: { kind: 'ad_free', days: 7 } }), false);
});

test('PIV-2b effect.kind === makeup 显式下发时同样算 makeup；null 商品不算', () => {
  assert.equal(isMakeup({ effect: { kind: 'makeup', days: 0 } }), true);
  assert.equal(isMakeup(null), false, 'item 还没拉到时不能把补签块带出来');
  assert.equal(isMakeup(undefined), false);
});
