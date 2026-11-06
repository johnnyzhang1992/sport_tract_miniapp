/**
 * 运动数据导出工具（miniprogram/utils/export-file.js）单测：
 * 只测纯函数——范围/自定义日期的东八区换算、query 拼装、错误体解码、文件名时间戳。
 * wx.request/FileSystemManager/shareFileMessage 链路在真机/工具里人工验收（与 track-detail 单条导出同款）。
 * 运行：node --test test/export-file.test.js；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPORT_RANGES,
  parseExportDate,
  rangeParams,
  buildExportQuery,
  buildStepExportQuery,
  decodeErrorMessage,
  fileStamp,
} = require('../miniprogram/utils/export-file.js');

// 固定「现在」：2026-11-01 12:00:00 东八区 = 04:00 UTC
const NOW = Date.UTC(2026, 10, 1, 4, 0, 0);
const DAY = 86400000;
const BJ = 8 * 3600000;

test('EF1 范围档：全部/30/90/自定义四档；固定档从 now 回退、自定义走自然日', () => {
  assert.deepEqual(EXPORT_RANGES.map((r) => r.key), ['all', '30d', '90d', 'custom']);
  assert.deepEqual(rangeParams('all', '', '', NOW), { from: null, to: null }, '全部不带时间参数');
  assert.deepEqual(rangeParams('30d', '', '', NOW), { from: NOW - 30 * DAY, to: null });
  assert.deepEqual(rangeParams('90d', '', '', NOW), { from: NOW - 90 * DAY, to: null });
  assert.deepEqual(rangeParams('unknown', '', '', NOW), { from: null, to: null }, '未知档位不猜参数');
});

test('EF2 自定义日期：按东八区自然日，结束日含 23:59:59.999', () => {
  assert.equal(
    parseExportDate('2026-11-01', false),
    Date.UTC(2026, 10, 1) - BJ,
    '开始 = 东八区当天 00:00:00',
  );
  assert.equal(
    parseExportDate('2026-11-01', true),
    Date.UTC(2026, 10, 1) - BJ + DAY - 1,
    '结束 = 东八区当天 23:59:59.999',
  );
  assert.equal(parseExportDate('2026-02-30', false), null, '不存在的日期返回 null');
  assert.equal(parseExportDate('2026/11/01', false), null, '只认 YYYY-MM-DD');
  const r = rangeParams('custom', '2026-10-01', '2026-10-31', NOW);
  assert.equal(r.from, Date.UTC(2026, 9, 1) - BJ);
  assert.equal(r.to, Date.UTC(2026, 9, 31) - BJ + DAY - 1);
});

test('EF3 自定义校验：缺日期 / 开始晚于结束都抛中文提示', () => {
  assert.throws(() => rangeParams('custom', '', '2026-11-01', NOW), /请选择开始和结束日期/);
  assert.throws(() => rangeParams('custom', '2026-11-01', '', NOW), /请选择开始和结束日期/);
  assert.throws(() => rangeParams('custom', '2026-11-02', '2026-11-01', NOW), /开始日期不能晚于结束日期/);
  assert.doesNotThrow(() => rangeParams('custom', '2026-11-01', '2026-11-01', NOW), '同一天是合法区间');
});

test('EF4 buildExportQuery：全部为空串，固定档只带 from，自定义带 from+to，类型编码', () => {
  assert.equal(buildExportQuery({ rangeKey: 'all' }, NOW), '');
  assert.equal(buildExportQuery({ rangeKey: 'all', type: 'running' }, NOW), '?type=running');
  assert.equal(
    buildExportQuery({ rangeKey: '30d', type: '' }, NOW),
    `?from=${NOW - 30 * DAY}`,
  );
  const from = Date.UTC(2026, 9, 1) - BJ;
  const to = Date.UTC(2026, 9, 31) - BJ + DAY - 1;
  assert.equal(
    buildExportQuery({ rangeKey: 'custom', startDate: '2026-10-01', endDate: '2026-10-31', type: 'walking' }, NOW),
    `?from=${from}&to=${to}&type=walking`,
  );
});

test('EF7 buildStepExportQuery：按自然日取窗口（含今天共 N 天）、不带宽类型、自定义原样', () => {
  const todayStart = Date.UTC(2026, 10, 1) - BJ; // 2026-11-01 00:00 东八区
  assert.equal(buildStepExportQuery({ rangeKey: 'all' }, NOW), '');
  assert.equal(buildStepExportQuery({ rangeKey: 'all', type: 'running' }, NOW), '', '步数与运动类型无关');
  assert.equal(
    buildStepExportQuery({ rangeKey: '30d', type: 'running' }, NOW),
    `?from=${todayStart - 29 * DAY}`,
    '近 30 天 = 今天起往前 29 天（共 30 个自然日），不是滚动 30×24h',
  );
  assert.equal(
    buildStepExportQuery({ rangeKey: '90d' }, NOW),
    `?from=${todayStart - 89 * DAY}`,
  );
  const from = Date.UTC(2026, 9, 1) - BJ;
  const to = Date.UTC(2026, 9, 31) - BJ + DAY - 1;
  assert.equal(
    buildStepExportQuery({ rangeKey: 'custom', startDate: '2026-10-01', endDate: '2026-10-31' }, NOW),
    `?from=${from}&to=${to}`,
  );
  assert.throws(() => buildStepExportQuery({ rangeKey: 'custom', startDate: '', endDate: '' }, NOW), /请选择开始和结束日期/);
});

test('EF5 decodeErrorMessage：arraybuffer 里的 success 包装取 message，坏体给空串', () => {
  const ab = (obj) => new TextEncoder().encode(JSON.stringify(obj)).buffer;
  assert.equal(decodeErrorMessage(ab({ success: false, code: 400, message: '一次最多导出 100 条轨迹' })), '一次最多导出 100 条轨迹');
  assert.equal(decodeErrorMessage(ab({ message: '导出太频繁，请稍后再试' })), '导出太频繁，请稍后再试');
  assert.equal(decodeErrorMessage(ab({ success: true })), '', '没有 message 给空串');
  assert.equal(decodeErrorMessage(new TextEncoder().encode('not json').buffer), '', '非 JSON 给空串');
  assert.equal(decodeErrorMessage(undefined), '', '空响应给空串');
  assert.equal(decodeErrorMessage('纯文本错误页'), '', '字符串体非 JSON 同样落空串');
});

test('EF5b utf8Decode：三字节中文与四字节 emoji 正确解码（小程序无 TextDecoder 的兜底）', () => {
  const { utf8Decode } = require('../miniprogram/utils/export-file.js');
  const bytes = new TextEncoder().encode('一次最多导出 100 条轨迹 🏃');
  assert.equal(utf8Decode(bytes), '一次最多导出 100 条轨迹 🏃');
  assert.equal(utf8Decode(new Uint8Array([0x61, 0x62])), 'ab', 'ASCII 直通');
});

test('EF6 fileStamp：东八区 YYYYMMDD-HHmmss', () => {
  assert.equal(fileStamp(NOW), '20261101-120000');
  assert.equal(fileStamp(Date.UTC(2026, 10, 1, 15, 59, 5)), '20261101-235905', 'UTC 15:59 = 东八区次日 23:59');
});
