/**
 * 运动数据导出工具（miniprogram/utils/export-file.js）单测：
 * 只测纯函数——query 拼装（范围/类型/ids 上限截断）、错误体解码、文件名时间戳。
 * wx.request/FileSystemManager/shareFileMessage 链路在真机/工具里人工验收（与 track-detail 单条导出同款）。
 * 运行：node --test test/export-file.test.js；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  GPX_MAX_ITEMS,
  SUMMARY_RANGES,
  buildSummaryQuery,
  buildGpxQuery,
  decodeErrorMessage,
  fileStamp,
} = require('../miniprogram/utils/export-file.js');

// 固定「现在」：2026-11-01 12:00:00 东八区 = 04:00 UTC
const NOW = Date.UTC(2026, 10, 1, 4, 0, 0);
const DAY = 86400000;

test('EF1 buildSummaryQuery：全部记录不带参数，30/90 天从 now 回退，类型透传编码', () => {
  assert.equal(buildSummaryQuery('all', '', NOW), '', '全部+全部类型 = 空 query');
  assert.equal(buildSummaryQuery('all', 'running', NOW), '?type=running');
  assert.equal(buildSummaryQuery('30d', '', NOW), `?from=${NOW - 30 * DAY}`, '30 天只带 from（to 即 now，后端可比对）');
  assert.equal(buildSummaryQuery('90d', 'walking', NOW), `?from=${NOW - 90 * DAY}&type=walking`);
  assert.equal(buildSummaryQuery('unknown-key', '', NOW), '', '未知范围键不猜参数');
  // 选项与页面弹层共用：全部记录必须无 days
  assert.deepEqual(SUMMARY_RANGES.map((r) => r.key), ['all', '30d', '90d']);
  assert.equal(SUMMARY_RANGES[0].days, undefined);
});

test('EF2 buildGpxQuery：去重去空、超上限截断并标 overflow', () => {
  assert.deepEqual(buildGpxQuery([]), { query: '', overflow: false }, '空选择不给 query');
  assert.deepEqual(buildGpxQuery(undefined), { query: '', overflow: false });
  assert.equal(
    buildGpxQuery(['a', 'a', '', ' b ']).query,
    '?ids=a,b',
    '去重 + trim + 去空',
  );
  const many = Array.from({ length: GPX_MAX_ITEMS + 5 }, (_, i) => `id${i}`);
  const r = buildGpxQuery(many);
  assert.equal(r.overflow, true, '超 100 标记 overflow');
  assert.ok(r.query.startsWith('?ids=id0,'), '保留勾选顺序的前 100 条');
  assert.equal(r.query.split(',').length, GPX_MAX_ITEMS, '截断到 100');
  const ok = buildGpxQuery(['x']);
  assert.equal(ok.overflow, false);
});

test('EF3 decodeErrorMessage：arraybuffer 里的 success 包装取 message，坏体给空串', () => {
  const ab = (obj) => new TextEncoder().encode(JSON.stringify(obj)).buffer;
  assert.equal(decodeErrorMessage(ab({ success: false, code: 400, message: '一次最多导出 100 条轨迹' })), '一次最多导出 100 条轨迹');
  assert.equal(decodeErrorMessage(ab({ message: '导出太频繁，请稍后再试' })), '导出太频繁，请稍后再试');
  assert.equal(decodeErrorMessage(ab({ success: true })), '', '没有 message 给空串');
  assert.equal(decodeErrorMessage(new TextEncoder().encode('not json').buffer), '', '非 JSON 给空串');
  assert.equal(decodeErrorMessage(undefined), '', '空响应给空串');
  assert.equal(decodeErrorMessage('纯文本错误页'), '', '字符串体非 JSON 同样落空串');
});

test('EF3b utf8Decode：三字节中文与四字节 emoji 正确解码（小程序无 TextDecoder 的兜底）', () => {
  const { utf8Decode } = require('../miniprogram/utils/export-file.js');
  const bytes = new TextEncoder().encode('一次最多导出 100 条轨迹 🏃');
  assert.equal(utf8Decode(bytes), '一次最多导出 100 条轨迹 🏃');
  assert.equal(utf8Decode(new Uint8Array([0x61, 0x62])), 'ab', 'ASCII 直通');
});

test('EF4 fileStamp：东八区 YYYYMMDD-HHmmss', () => {
  assert.equal(fileStamp(NOW), '20261101-120000');
  assert.equal(fileStamp(Date.UTC(2026, 10, 1, 15, 59, 5)), '20261101-235905', 'UTC 15:59 = 东八区次日 23:59');
});
