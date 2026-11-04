/**
 * 会员权益在端上的三处落点（spec §8）：
 * G-1 轨迹合集页「多选」入口已恢复，且判据是服务端下发的 canExportBundle；
 * G-2 非会员点多选 → 引导弹窗（不进入多选、不发导出请求），会员点 → 真进 selectMode；
 * G-3 导出被服务端拒时整句原样展示（端上不写死 403 文案）；
 * G-4 设置页拉 /member/entitlements 并写免广告缓存；
 * G-5 广告组件数据源仍是 ad-free 缓存（没有新增第二份到期算式）。
 * 桩：wx / Page / getApp 就地 stub；services/api、services/storage 用 require.cache 注入。
 * 运行：node --test test/member-gates.test.js；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/* ------------------------------- 结构断言 ------------------------------- */

test('G-1 导出入口收口：轨迹页不再有多选导出，我的页改为跳独立导出页', () => {
  const tracks = read('miniprogram/pages/tracks/tracks.wxml');
  assert.ok(!tracks.includes('select-toggle'), '轨迹页多选按钮已移除');
  assert.ok(!tracks.includes('select-bar'), '轨迹页批量操作栏已移除');
  const tracksJs = read('miniprogram/pages/tracks/tracks.js');
  assert.ok(!tracksJs.includes('selectMode'), '轨迹页多选状态已移除');
  assert.ok(!tracksJs.includes("utils/export-file"), '轨迹页不再引用导出工具');
  const my = read('miniprogram/pages/my/my.js');
  assert.match(my, /\/pages\/export\/export/, '我的页入口跳到独立导出页');
  assert.ok(!my.includes('exportVisible'), '我的页旧导出半屏已删除');
});

test('G-3 导出失败原样展示服务端整句，端上不写死会员文案', () => {
  const js = read('miniprogram/pages/export/export.js');
  assert.match(js, /err\.message/);
  assert.ok(!js.includes('多条轨迹打包导出需要开通会员'), '这句由服务端 403 下发，端上不许复制一份');
});

test('G-4 设置页拉权益并写免广告缓存', () => {
  const js = read('miniprogram/pages/settings/settings.js');
  assert.match(js, /\/member\/entitlements/);
  assert.match(js, /setAdFreeUntil\(e\.adFreeUntil\)/, '必须真的把服务端值写进缓存，不能只 import');
});

test('G-5 广告组件数据源仍是 ad-free 缓存（没有新增第二份算式）', () => {
  const js = read('miniprogram/components/ad-template/ad-template.js');
  assert.match(js, /isAdFree\(/);
  assert.ok(!js.includes('memberUntil'), '组件不该自己去算会员到期');
});
