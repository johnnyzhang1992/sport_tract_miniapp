/**
 * 数据导出页：足迹 CSV 与照片打包两张卡的接线测试。
 * 后端行为由 sport_track_api 的 export-photos-footprint 测试钉住，这里钉住
 * 「页面结构与请求对齐」：两张卡存在、会员闸门复用、路径/文件名映射正确。
 * 运行：npm test；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('EF-P1 导出页有足迹 CSV 卡（免费）与照片打包卡（会员闸门）', () => {
  const wxml = read('miniprogram/pages/export/export.wxml');
  assert.match(wxml, /bindtap="onExportFootprintCsv"[\s\S]*?导出 CSV/, '足迹卡导出按钮');
  assert.match(wxml, /bindtap="onExportPhotos"[\s\S]*?导出照片包/, '照片卡导出按钮');
  // 照片卡必须复用会员闸门结构（与轨迹卡同款三段式）
  assert.match(wxml, /导出照片包[\s\S]*?member-lock[\s\S]*?开通后可打包导出照片/, '照片卡会员锁文案');
});

test('EF-P1b 卡片顺序：运动记录 → 轨迹记录 → 步数 → 足迹 → 照片（主力导出在前）', () => {
  const wxml = read('miniprogram/pages/export/export.wxml');
  const titles = ['运动记录', '轨迹记录', '微信步数', '足迹记录', '照片'].map((t) =>
    wxml.indexOf(`class="sec-title">${t}<`),
  );
  assert.ok(titles.every((i) => i > 0), `五张卡齐全：${titles}`);
  assert.deepEqual(
    titles,
    [...titles].sort((a, b) => a - b),
    '卡面顺序必须与预期一致',
  );
});

test('EF-P2 doExport 映射：footprints/photos 路径与文件名，均不带 type 参数', () => {
  const js = read('miniprogram/pages/export/export.js');
  assert.match(js, /'footprints' \? '\/footprint-records\/export\/csv'/, '足迹路径');
  assert.match(js, /'photos' \? '\/activities\/export\/photos'/, '照片路径');
  assert.match(js, /足迹记录_\$\{fileStamp\(\)\}\.csv/, '足迹文件名');
  assert.match(js, /照片导出_\$\{fileStamp\(\)\}\.zip/, '照片文件名');
  // 足迹/照片不吃类型：withType 排除两者（steps 单独走自然日口径不受影响）
  assert.match(js, /kind !== 'footprints' && kind !== 'photos'/, '类型参数排除足迹与照片');
  assert.match(js, /kind === 'steps'[\s\S]{0,160}buildStepExportQuery/, '步数仍走自然日口径');
});

test('EF-P3 会员闸门：onExportPhotos 未开通时拦截并引导', () => {
  const js = read('miniprogram/pages/export/export.js');
  assert.match(js, /onExportPhotos\(\) \{[\s\S]*?canExportBundle[\s\S]*?开通后可打包照片/, '照片导出前的会员拦截');
  assert.match(js, /onExportFootprintCsv\(\) \{\s*return this\.doExport\('footprints'\);\s*\}/, '足迹导出无拦截直接走');
});

test('EF-P4 export-file.js 提供两个导出包装（路径与超时同链路）', () => {
  const helper = read('miniprogram/utils/export-file.js');
  assert.match(helper, /footprint-records\/export\/csv/, '足迹下载路径');
  assert.match(helper, /activities\/export\/photos/, '照片下载路径');
  assert.match(helper, /exportFootprintCsv/, '足迹包装函数');
  assert.match(helper, /exportPhotosZip/, '照片包装函数');
});
