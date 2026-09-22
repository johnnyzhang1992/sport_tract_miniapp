/**
 * 省市列表纯函数（packageFootprint/utils/region-list.js）单测：
 * 统计页「省份包含城市、城市默认收起」的视图态换算——WXML 不能算展开态，也不能给缺失字段兜底。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRegionRows,
  toggleRegion,
  regionSummaryText,
} = require('../miniprogram/packageFootprint/utils/region-list.js');

const PROVINCES = [
  { name: '浙江省', count: 4, cities: [{ name: '杭州市', count: 3 }, { name: '舟山市', count: 1 }] },
  { name: '北京市', count: 1, cities: [{ name: '北京市', count: 1 }] },
  { name: '广东省', count: 1, cities: [] }, // 早期直连库数据：有省无市
];

test('R1 行视图：保序（后端已按计数倒序）、带市数与可展开标记', () => {
  const rows = buildRegionRows(PROVINCES, []);
  assert.deepEqual(rows.map((r) => r.name), ['浙江省', '北京市', '广东省'], '不在前端重排序，保持接口口径');
  assert.equal(rows[0].cityCount, 2);
  assert.equal(rows[0].expandable, true);
  assert.equal(rows[0].expanded, false);
  assert.deepEqual(rows[0].cities, [{ name: '杭州市', count: 3 }, { name: '舟山市', count: 1 }]);
  assert.equal(rows[2].expandable, false, '没有城市的省不给展开箭头');
  assert.equal(rows[2].cityCount, 0);
});

test('R2 展开态来自传入集合，且支持多省同时展开', () => {
  const rows = buildRegionRows(PROVINCES, ['浙江省', '北京市']);
  assert.equal(rows[0].expanded, true);
  assert.equal(rows[1].expanded, true);
  assert.equal(rows[2].expanded, false);
});

test('R3 toggle 返回新数组（setData 要新引用），再点即收起', () => {
  const before = ['浙江省'];
  const added = toggleRegion(before, '北京市');
  assert.deepEqual(added, ['浙江省', '北京市']);
  assert.deepEqual(before, ['浙江省'], '不原地改入参');
  assert.deepEqual(toggleRegion(added, '北京市'), ['浙江省']);
  assert.deepEqual(toggleRegion(['浙江省'], '浙江省'), [], '全部收起是合法态');
});

test('R4 汇总文案：省数取条目数、市数是各省城市之和', () => {
  assert.equal(regionSummaryText(PROVINCES), '共 3 省 3 城');
  assert.equal(regionSummaryText([]), '共 0 省 0 城');
  assert.equal(regionSummaryText(undefined), '共 0 省 0 城');
});

test('R5 脏数据不炸：缺 cities / 缺 name / 非数组入参', () => {
  const rows = buildRegionRows([{ name: '无市省' }, { cities: [] }, null], ['无市省']);
  assert.deepEqual(rows.map((r) => r.name), ['无市省'], '没有省名的行渲染不出来，直接丢掉');
  assert.equal(rows[0].count, 0, '缺 count 兜 0');
  assert.equal(rows[0].expandable, false, '缺 cities 按无市处理');
  assert.equal(rows[0].expanded, false, '无城市的省即便在展开集合里也不算展开（否则点它只亮一下，展不出行）');
  assert.deepEqual(buildRegionRows(null, null), []);
});
