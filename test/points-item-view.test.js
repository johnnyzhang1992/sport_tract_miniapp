/**
 * 商品详情页取数纯函数（miniprogram/utils/points-item-view.js）单测：
 * 详情页按 ?key= 从整张商品表里挑一件展示，兑换接口也按这件商品的 key 拼；
 * 老链接不带 key、key 拼错、商品被后台下架（不在在架列表里）都回落第一项——
 * 服务端 listActiveItems 把 makeup_card 排在 sortOrder 最前（老客户端读 items[0]），回落即老行为。
 * 运行：node --test test/points-item-view.test.js；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickItem, isMakeup, isPhysical, addressError, cleanAddress } = require('../miniprogram/utils/points-item-view.js');

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

test('PIV-3 实物判据只看 kind：老目录行缺字段算虚拟（服务端已兜底成 virtual）', () => {
  assert.equal(isPhysical({ kind: 'physical' }), true);
  assert.equal(isPhysical({ kind: 'virtual' }), false);
  assert.equal(isPhysical({}), false, '缺 kind 的老数据不许被当成实物，否则补签卡会冒出收货地址表单');
  assert.equal(isPhysical(null), false);
});

test('PIV-4 地址校验与服务端 validateAddress 同口径（越界与格式各一条）', () => {
  const ok = { receiver: '张三丰', phone: '13800001234', detail: '广东省深圳市南山区科技园南路 1 号' };
  assert.equal(addressError(ok), '', '合法地址不该报错');
  assert.equal(addressError(undefined), '收货人姓名需 1–20 字', '整个地址没填时点名第一个格子');
  assert.equal(addressError({}), '收货人姓名需 1–20 字');
  assert.equal(addressError({ ...ok, receiver: '  ' }), '收货人姓名需 1–20 字', '只有空格的姓名算没填');
  assert.equal(addressError({ ...ok, receiver: 'x'.repeat(21) }), '收货人姓名需 1–20 字');
  assert.equal(addressError({ ...ok, phone: '12345678901' }), '请填写 11 位大陆手机号', '12 开头不是大陆号段');
  assert.equal(addressError({ ...ok, phone: '1380000123' }), '请填写 11 位大陆手机号', '少一位');
  assert.equal(addressError({ ...ok, phone: '138000012345' }), '请填写 11 位大陆手机号', '多一位也不行（没有锚点就会被整串放过）');
  assert.equal(addressError({ ...ok, detail: '深圳' }), '详细地址需 5–120 字');
  assert.equal(addressError({ ...ok, detail: '深'.repeat(121) }), '详细地址需 5–120 字');
});

test('PIV-5 提交前 trim：带首尾空格的地址不该原样发给服务端', () => {
  assert.deepEqual(
    cleanAddress({ receiver: ' 张三 ', phone: ' 13800001234 ', detail: '  广东省深圳市  ' }),
    { receiver: '张三', phone: '13800001234', detail: '广东省深圳市' },
  );
  assert.deepEqual(cleanAddress(null), { receiver: '', phone: '', detail: '' }, '没填也返回三个键，别让端上拼出 undefined');
});
