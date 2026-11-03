/**
 * 会员 util 回归：版本闸门、分→元、卡片格式化、付费入口可见性、状态句不由端上生成。
 * 运行：node --test test/member-view.test.js；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const { compareVersion, MIN_XPAY_SDK, MIN_IOS_CLIENT } = require('../miniprogram/utils/compare-version');
const { fenToYuanText, buildPlanCards, payVisible } = require('../miniprogram/utils/member-view');

test('MV1 compareVersion 数值比较，不是字典序：2.19.2 vs 2.9.10', () => {
  assert.equal(compareVersion('2.19.2', '2.9.10'), 1, '字典序会把 2.19 判成小于 2.9');
  assert.equal(compareVersion('2.19.2', '2.19.2'), 0);
  assert.equal(compareVersion('2.19.1', '2.19.2'), -1);
  assert.equal(compareVersion('8.0.68', '8.0.7'), 1);
  assert.equal(compareVersion('', '2.19.2'), -1, '缺版本号按不满足处理');
  assert.equal(MIN_XPAY_SDK, '2.19.2');
  assert.equal(MIN_IOS_CLIENT, '8.0.68');
});

test('MV2 分→元：199→1.99、1699→16.99、5→0.05、100→1（不是 5 元也不是 0.5 元）', () => {
  assert.equal(fenToYuanText(199), '1.99');
  assert.equal(fenToYuanText(1699), '16.99');
  assert.equal(fenToYuanText(5), '0.05');
  assert.equal(fenToYuanText(100), '1');
  assert.equal(fenToYuanText(0), '0');
});

test('MV3 档位卡直接用服务端下发文案，端上不重算日均', () => {
  const cards = buildPlanCards([
    {
      key: 'month_card', name: '会员月卡', priceFen: 199, durationDays: 30,
      priceText: '1.99 元', perDayText: '约 0.07 元/天', durationText: '30 天', perkLines: ['a', 'b'],
    },
  ]);
  assert.equal(cards[0].perDayText, '约 0.07 元/天');
  assert.equal(cards[0].priceText, '1.99 元');
  assert.equal(cards[0].perkLines.length, 2);
  assert.ok(!('perDayFen' in cards[0]), '端上不该再算出第二个日均值');
  // 故意让服务端文案与「按价格自己算」的结果不同：只要端上改回自算，这条立刻红
  const decoy = buildPlanCards([{ key: 'x', priceFen: 199, durationDays: 30, perDayText: '约 0.08 元/天' }]);
  assert.equal(decoy[0].perDayText, '约 0.08 元/天', '必须原样透传服务端文案');
});

test('MV4 付费入口可见性：开关关 / iOS 未开 IAP / 基础库过低 三种都隐藏', () => {
  assert.equal(payVisible({ enabled: false, platform: 'android', sdkVersion: '3.0.0' }), false);
  assert.equal(payVisible({ enabled: true, platform: 'ios', sdkVersion: '3.0.0', iosPayReady: false }), false, 'iOS 未开 IAP 要整块隐藏（spec §8）');
  assert.equal(payVisible({ enabled: true, platform: 'ios', sdkVersion: '3.0.0', iosPayReady: true }), true);
  assert.equal(payVisible({ enabled: true, platform: 'android', sdkVersion: '2.19.1' }), false, '低于 2.19.2 不可支付');
  assert.equal(payVisible({ enabled: true, platform: 'android', sdkVersion: '2.19.2' }), true);
});

test('MV5 状态句不由端上生成：member-view 不拼日期，页面只渲染服务端 statusText', () => {
  const util = read('miniprogram/utils/member-view.js');
  assert.ok(!util.includes('到期'), '端上不得拼「到期」类整句');
  assert.ok(!util.includes('年'), '端上不得格式化日期');
  const page = read('miniprogram/pages/member/member.js');
  assert.ok(page.includes('d.statusText'), '状态行必须来自接口');
  assert.ok(!page.includes('memberUntil'), '端上不该自己读 memberUntil 算文案');
});
