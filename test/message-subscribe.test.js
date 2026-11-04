/** 消息订阅半屏：只负责展示与事件，授权/上报留在页面层 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
let def = null;
global.Component = (d) => { def = d; };
require('../miniprogram/components/message-subscribe/message-subscribe.js');
assert.ok(def, '组件应通过 Component() 注册');

function makeCtx() {
  const events = [];
  return {
    events,
    triggerEvent(name, detail) { events.push({ name, detail }); },
  };
}

test('MS1 订阅按钮把 key/template 抛给页面（属性名全小写）', () => {
  const ctx = makeCtx();
  def.methods.onSubscribeTap.call(ctx, {
    currentTarget: { dataset: { key: 'memberExpiry', template: 'TPL' } },
  });
  assert.deepEqual(ctx.events, [
    { name: 'subscribe', detail: { key: 'memberExpiry', templateId: 'TPL' } },
  ]);
  assert.deepEqual(Object.keys(def.properties), ['visible', 'items', 'loading', 'failed', 'busy']);
});

test('MS2 关闭 / 重试事件', () => {
  const ctx = makeCtx();
  def.methods.onClose.call(ctx);
  def.methods.onRetry.call(ctx);
  assert.deepEqual(ctx.events.map((e) => e.name), ['close', 'retry']);
});

test('MS3 已订阅态按钮不可再点；空态/错误态文案在位', () => {
  const wxml = read('miniprogram/components/message-subscribe/message-subscribe.wxml');
  assert.ok(wxml.includes('wx:if="{{item.subscribed}}"'), '已订阅单独渲染');
  assert.ok(wxml.includes('>已订阅</view>'));
  assert.ok(wxml.includes('暂无可订阅的消息'));
  assert.ok(wxml.includes('订阅信息加载失败'));
  assert.ok(wxml.includes('data-template="{{item.templateId}}"'));
  const wxss = read('miniprogram/components/message-subscribe/message-subscribe.wxss');
  assert.ok(!/\s>\s*\*/.test(wxss), '禁止通配子选择器（WXSS 会整页白屏）');
  assert.ok(wxss.includes('env(safe-area-inset-bottom)'), '底部垫安全区');
});
