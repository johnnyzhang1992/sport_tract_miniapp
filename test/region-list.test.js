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
  attachCities,
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

/* ---- attachCities：/stats/footprint 的 provinces[].cities 是「市个数」数字、城市在扁平 cities 里 ---- */

const FP_PROVINCES = [
  { name: '浙江省', count: 4, cities: 2 },
  { name: '北京市', count: 1, cities: 1 },
  { name: '广东省', count: 1, cities: 0 }, // 有省无市（早期直连库数据）
];
const FP_CITIES = [
  { name: '杭州市', province: '浙江省', count: 3 },
  { name: '北京市', province: '北京市', count: 1 },
  { name: '舟山市', province: '浙江省', count: 1 },
];

test('R6 挂城市：省保持接口顺序与计数，市按接口给的回填（不在前端重排）', () => {
  const nested = attachCities(FP_PROVINCES, FP_CITIES);
  assert.deepEqual(nested.map((p) => p.name), ['浙江省', '北京市', '广东省']);
  assert.equal(nested[0].count, 4);
  assert.deepEqual(nested[0].cities.map((c) => `${c.name}:${c.count}`), ['杭州市:3', '舟山市:1'], '维持 cities 原序＝后端按足迹数倒序');
  assert.deepEqual(nested[1].cities.map((c) => c.name), ['北京市']);
});

test('R6b 城市顺序原样透传：即使计数不单调也不在前端重排（口径归后端）', () => {
  const odd = attachCities(
    [{ name: '浙江省', count: 5 }],
    [{ name: '舟山市', province: '浙江省', count: 1 }, { name: '杭州市', province: '浙江省', count: 3 }],
  );
  assert.deepEqual(odd[0].cities.map((c) => c.name), ['舟山市', '杭州市']);
});

test('R7 有省无市挂成空数组，喂给 buildRegionRows 就不给展开箭头', () => {
  const nested = attachCities(FP_PROVINCES, FP_CITIES);
  assert.deepEqual(nested[2].cities, []);
  const rows = buildRegionRows(nested, ['广东省']);
  assert.equal(rows[2].expandable, false);
  assert.equal(rows[2].cityCount, 0);
});

test('R8 不修改入参、脏输入退化成空表', () => {
  const before = JSON.stringify(FP_PROVINCES);
  attachCities(FP_PROVINCES, FP_CITIES);
  assert.equal(JSON.stringify(FP_PROVINCES), before, 'provinces 必须原样（接口那份 cities 是数字，改了会污染地图数据）');
  assert.deepEqual(attachCities(null, FP_CITIES), []);
  assert.deepEqual(attachCities([{ name: '浙江省', count: 1 }], null).map((p) => p.cities), [[]]);
});

test('R9 端到端：挂完再出行，汇总文案与列表对得上', () => {
  const nested = attachCities(FP_PROVINCES, FP_CITIES);
  assert.equal(regionSummaryText(nested), '共 3 省 3 城');
  const rows = buildRegionRows(nested, []);
  assert.deepEqual(rows.map((r) => `${r.name}/${r.cityCount}/${r.expandable}`), [
    '浙江省/2/true', '北京市/1/true', '广东省/0/false',
  ]);
});
