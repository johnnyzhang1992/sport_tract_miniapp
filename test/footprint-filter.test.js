/**
 * 地图页筛选纯函数（miniprogram/utils/footprint-filter.js）单测：
 * 省份/年份/分类候选从首次未过滤快照算，query 参数只带非空项。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFilterOptions,
  buildGeoQuery,
  hasActiveFilter,
  activeFilterCount,
} = require('../miniprogram/utils/footprint-filter.js');

const rec = (over) => ({ id: 'x', title: 't', visitDate: '2024-06-01', province: '', city: '', category: '', ...over });
const CAT_ORDER = ['scenic', 'mountain', 'park', 'heritage', 'museum', 'street', 'food', 'camp', 'other'];

test('F1 候选：按计数倒序给省份，计数相同按名称；空省市不进候选', () => {
  const { provinces } = buildFilterOptions([
    rec({ province: '浙江省' }),
    rec({ province: '浙江省' }),
    rec({ province: '陕西省' }),
    rec({ province: '' }),
    rec({}),
  ]);
  assert.deepEqual(provinces, [{ name: '浙江省', count: 2 }, { name: '陕西省', count: 1 }]);
});

test('F2 候选：年份从 visitDate 取 4 位、倒序，脏日期忽略', () => {
  const { years } = buildFilterOptions([
    rec({ visitDate: '2023-04-01' }),
    rec({ visitDate: '2025-01-01' }),
    rec({ visitDate: '2025-11-11' }),
    rec({ visitDate: '' }),
    rec({ visitDate: 'abc' }),
  ]);
  assert.deepEqual(years, [{ year: 2025, count: 2 }, { year: 2023, count: 1 }]);
});

test('F3 候选：分类按传入顺序排（不是按计数），未分类不计入', () => {
  const { categories } = buildFilterOptions(
    [rec({ category: 'camp' }), rec({ category: 'camp' }), rec({ category: 'scenic' }), rec({ category: '' })],
    CAT_ORDER,
  );
  assert.deepEqual(categories, [{ key: 'scenic', count: 1 }, { key: 'camp', count: 2 }]);
});

test('F4 query 参数：只带非空项，keyword 去首尾空格，全空即空对象', () => {
  assert.deepEqual(buildGeoQuery({}), {});
  assert.deepEqual(buildGeoQuery({ province: '', year: 0, category: '', keyword: '   ' }), {});
  assert.deepEqual(
    buildGeoQuery({ province: '浙江省', year: 2024, category: 'mountain', keyword: ' 西湖 ' }),
    { province: '浙江省', year: '2024', category: 'mountain', keyword: '西湖' },
  );
});

test('F5 生效判定：只算筛选弹窗里的三项，关键词不算筛选', () => {
  assert.equal(hasActiveFilter({ keyword: '西湖' }), false);
  assert.equal(activeFilterCount({ keyword: '西湖' }), 0);
  assert.equal(activeFilterCount({ province: '浙江省', year: 2024, category: '' }), 2);
  assert.equal(hasActiveFilter({ category: 'other' }), true);
});

test('F6 省份短名：按 34 个省级单位的对照表取，表外原样显示', () => {
  const { shortProvinceName, PROVINCE_SHORT_NAMES } = require('../miniprogram/utils/footprint-filter.js');
  assert.equal(Object.keys(PROVINCE_SHORT_NAMES).length, 34, '23 省 + 5 自治区 + 4 直辖市 + 2 特区 + 台湾');
  assert.equal(shortProvinceName('黑龙江省'), '黑龙江');
  assert.equal(shortProvinceName('内蒙古自治区'), '内蒙古');
  assert.equal(shortProvinceName('新疆维吾尔自治区'), '新疆');
  assert.equal(shortProvinceName('广西壮族自治区'), '广西');
  assert.equal(shortProvinceName('宁夏回族自治区'), '宁夏');
  assert.equal(shortProvinceName('西藏自治区'), '西藏');
  assert.equal(shortProvinceName('香港特别行政区'), '香港');
  assert.equal(shortProvinceName('浙江省'), '浙江');
  assert.equal(shortProvinceName('北京市'), '北京');
  assert.equal(shortProvinceName('广东省'), '广东');
  assert.equal(shortProvinceName('河南省'), '河南');
  assert.equal(shortProvinceName('重庆市'), '重庆');
  // 表外（脏数据/城市串/新写法）不猜、不截：宁可 chip 宽一点，也别出「黑龙」这种破词
  assert.equal(shortProvinceName('西康省'), '西康省');
  assert.equal(shortProvinceName('杭州'), '杭州');
  assert.equal(shortProvinceName(''), '');
  assert.equal(shortProvinceName(undefined), '');
  assert.equal(shortProvinceName(null), '');
});
