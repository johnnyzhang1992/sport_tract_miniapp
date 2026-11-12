/**
 * 首页运动榜/步数榜单行卡（2026-11-09）：
 * 去图标、单行左标题右文案 + ›；只展示一条上榜数据；未上榜走默认文案。
 * 只断首页 .duo-row 段内的两张卡；官方专题卡（.lb-card 横排）不受影响。
 * 运行：node --test test/index-lb-cards.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function duoBlock() {
  const w = read('miniprogram/pages/index/index.wxml');
  const start = w.indexOf('<view class="duo-row">');
  assert.ok(start > 0, '应有 duo-row');
  const end = w.indexOf('</view>', w.indexOf('官方专题', start) > 0 ? w.indexOf('官方专题', start) : start + 4000);
  assert.ok(end > start);
  return w.slice(start, w.indexOf('<!-- 官方专题', start));
}

test('LC1 单行左右结构：去图标、左标题、右文案 + ›', () => {
  const block = duoBlock();
  assert.ok(!block.includes('lb-icon'), '两张榜卡不再有图标');
  assert.ok(!block.includes('lb-foot'), '不再有脚部两行结构');
  assert.equal((block.match(/class="lb-title"/g) || []).length, 2, '左标题各一个');
  assert.match(block, /class="lb-title">运动榜</);
  assert.match(block, /class="lb-title">步数榜</);
  assert.equal((block.match(/class="lb-side"/g) || []).length, 2, '右侧文案区各一个');
  assert.equal((block.match(/class="lb-arrow">›</g) || []).length, 2, '两卡都保留可点箭头');
});

test('LC2 已上榜：运动榜「类型+周期+第N名」；步数榜「第N名 · 今日步数」', () => {
  const block = duoBlock();
  assert.match(block, /\{\{lbSummary\.ranks\[0\]\.label\}\}第 \{\{lbSummary\.ranks\[0\]\.rank\}\} 名/);
  assert.match(block, /第 \{\{stepsSummary\.rank\}\} 名 · \{\{stepsSummary\.stepText\}\} 步/);
  assert.ok(!block.includes('lb-rank-line'), '不再有旧的「今日第 N 名 / 走了 X 步」两行结构');
});

test('LC3 未上榜默认文案：运动榜「未上榜，去运动」/ 步数榜「今天走了多少步？」', () => {
  const block = duoBlock();
  assert.ok(block.includes('未上榜，去运动'), '运动榜未上榜默认文案');
  assert.ok(block.includes('今天走了多少步？'), '步数榜未上榜默认文案');
});

test('LC4 右侧文案单行省略：nowrap + ellipsis，不撑破半宽卡', () => {
  const css = read('miniprogram/pages/index/index.wxss');
  assert.match(css, /\.lb-copy\s*\{[^}]*white-space:\s*nowrap/, '单行');
  assert.match(css, /\.lb-copy\s*\{[^}]*text-overflow:\s*ellipsis/, '超出省略');
  assert.match(css, /\.lb-side\s*\{[^}]*flex:\s*1/, '右侧占满剩余宽');
});