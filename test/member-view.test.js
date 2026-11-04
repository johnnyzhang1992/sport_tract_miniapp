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
const {
  fenToYuanText, buildPlanCards, bestValueKey, splitStatusText, buildPerkItems, payVisible,
} = require('../miniprogram/utils/member-view');

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

test('MV6 日均最低角标：只挑 key，不产出金额文案；缺字段或只有一档不挂', () => {
  const cards = buildPlanCards([
    { key: 'm', priceFen: 199, durationDays: 30 },
    { key: 'q', priceFen: 499, durationDays: 90 },
    { key: 'y', priceFen: 1699, durationDays: 365 },
  ]);
  assert.equal(bestValueKey(cards), 'y', '1699/365 最小');
  assert.equal(bestValueKey([cards[0]]), '', '只有一档不比较');
  assert.equal(bestValueKey(buildPlanCards([{ key: 'm' }, { key: 'y' }])), '', '缺 priceFen/durationDays 不挂角标');
  // 角标只依赖数值字段，服务端日均文案说什么都不影响
  const decoy = buildPlanCards([
    { key: 'm', priceFen: 199, durationDays: 30, perDayText: '约 0.01 元/天' },
    { key: 'y', priceFen: 1699, durationDays: 365, perDayText: '约 9.99 元/天' },
  ]);
  assert.equal(bestValueKey(decoy), 'y', '按 priceFen/durationDays 比，不解析日均文案');
});

test('MV7 状态句只拆两行，不重写文案：有分隔符拆标题/副标题，没分隔符整句放标题', () => {
  assert.deepEqual(splitStatusText('会员生效中 · 有效期至 2026年12月4日'), {
    title: '会员生效中', sub: '有效期至 2026年12月4日',
  });
  assert.deepEqual(splitStatusText('会员已到期 · 2026年12月4日到期'), {
    title: '会员已到期', sub: '2026年12月4日到期',
  });
  assert.deepEqual(splitStatusText(''), { title: '', sub: '' });
  assert.deepEqual(splitStatusText('会员生效中'), { title: '会员生效中', sub: '' }, '没分隔符不硬拆');
  assert.deepEqual(splitStatusText('会员生效中 · 有效期至 A · 备注 B').sub, '有效期至 A · 备注 B', '只拆第一个分隔符');
});

test('MV8 权益图标映射：按关键词配字形，认不出来用中性宝石兜底且文件都在', () => {
  const items = buildPerkItems(['免广告', '多条轨迹打包导出 GPX', '照片额度 300 张', '订阅消息提醒', '神秘权益']);
  assert.deepEqual(items.map((i) => i.icon), [
    '/assets/icons/lucide-ban-blue.png',
    '/assets/icons/lucide-download-blue.png',
    '/assets/icons/lucide-image-blue.png',
    '/assets/icons/lucide-bell-blue.png',
    '/assets/icons/lucide-gem-blue.png',
  ]);
  assert.deepEqual(buildPerkItems([]), []);
  items.forEach((i) => {
    assert.ok(fs.existsSync(path.join(root, 'miniprogram', i.icon)), `${i.text} 的图标要入包`);
  });
});

test('MV9 状态句不由端上生成：member-view 不拼日期，页面只渲染服务端 statusText', () => {
  const util = read('miniprogram/utils/member-view.js');
  assert.ok(!util.includes('到期'), '端上不得拼「到期」类整句');
  assert.ok(!util.includes('年'), '端上不得格式化日期');
  const page = read('miniprogram/pages/member/member.js');
  assert.ok(page.includes('d.statusText'), '状态行必须来自接口');
  assert.ok(!page.includes('memberUntil'), '端上不该自己读 memberUntil 算文案');
});
