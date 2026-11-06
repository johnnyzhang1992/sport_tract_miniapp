/**
 * 微信步数排行榜页（pages/werun-board）接线测试。
 * 页面逻辑走真机，这里钉住「结构与接口对齐」：app.json 注册、四周期与翻期键、
 * 省份 picker、TOP 榜单与「我的排名」卡的绑定关系、运动榜入口。
 * 运行：npm test；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('WB-P1 页面已在 app.json 注册', () => {
  const appJson = JSON.parse(read('miniprogram/app.json'));
  assert.ok(appJson.pages.includes('pages/werun-board/werun-board'), 'werun-board 页面必须在 pages 列表');
});

test('WB-P2 四周期齐全且默认日榜；换周期清 periodKey 防键格式串台', () => {
  const js = read('miniprogram/pages/werun-board/werun-board.js');
  for (const key of ['day', 'week', 'month', 'year']) {
    assert.ok(js.includes(`key: '${key}'`), `周期 ${key} 必须在 PERIODS 里`);
  }
  assert.ok(js.includes("periodIndex: 0, // 默认日榜"), '默认选中日榜');
  assert.match(js, /换周期必须清掉 periodKey/, '换周期要清 periodKey（注释在即逻辑在）');
  // 回到最新一期时清空 periodKey（applyWindow），否则跨期后停在前一期
  assert.match(js, /next === null \? \{ periodKey: '' \}/, 'applyWindow 需在最新期清 periodKey');
});

test('WB-P3 请求对齐后端：/werun/board 三参数 + /werun/board-provinces 省份源', () => {
  const js = read('miniprogram/pages/werun-board/werun-board.js');
  assert.match(js, /\/werun\/board\?period=/, '榜单请求路径');
  assert.match(js, /periodKey=\$\{encodeURIComponent/, '历史周期键随请求下发');
  assert.match(js, /province=\$\{encodeURIComponent/, '省份随请求下发');
  assert.match(js, /\/werun\/board-provinces/, '省份选择器数据源');
  // 游客可看：me 为 null 时不渲染我的排名卡——请求走的是同一个接口
  assert.match(js, /me: board\.me \? deco\(board\.me\) : null/, '游客 me 为 null 的口径在装饰层');
});

test('WB-P4 结构：省份 picker + 周期分段 + 历史翻页 + TOP 榜 + 我的排名卡', () => {
  const wxml = read('miniprogram/pages/werun-board/werun-board.wxml');
  assert.match(wxml, /picker[\s\S]*?range="\{\{provinceOptions\}\}"/, '省份 picker');
  assert.match(wxml, /wx:for="\{\{periods\}\}"/, '周期分段');
  assert.match(wxml, /bindtap="onPrevPeriod"[\s\S]*?下一期/, '上一期/下一期翻页');
  assert.match(wxml, /wx:for="\{\{board\.top\}\}"/, 'TOP 榜单行');
  assert.match(wxml, /wx:if="\{\{board && board\.me\}\}"/, '我的排名卡（游客不渲染）');
  assert.match(wxml, /\{\{item\.stepText\}\} 步/, '行值列展示步数');
});

test('WB-P5 运动榜页有步数榜入口（pill + 跳转）', () => {
  const wxml = read('miniprogram/pages/leaderboard/leaderboard.wxml');
  const js = read('miniprogram/pages/leaderboard/leaderboard.js');
  assert.match(wxml, /werun-board-entry/, '头部入口 pill');
  assert.match(js, /goWerunBoard\(\)[\s\S]*?\/pages\/werun-board\/werun-board/, '点击跳转步数榜页');
});

test('WB-P6 隐私政策披露排行榜展示（昵称/头像/省份/步数）', () => {
  const wxml = read('miniprogram/pages/privacy/privacy.wxml');
  assert.match(wxml, /步数排行榜/, '隐私政策提到步数排行榜');
  assert.match(wxml, /昵称、头像与省份/, '披露榜单展示的字段范围');
});
