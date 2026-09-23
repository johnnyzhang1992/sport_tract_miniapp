/**
 * 运动榜分类 chips 排序纯函数（utils/leaderboard-types.js）单测：
 * 有数据的排前面、同数量保持 config 原序（稳定）、缺计数当 0、重排后按 type 找回选中项。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { sortTypesByCount, indexOfType, applyTypeCounts } = require('../miniprogram/utils/leaderboard-types.js');

// 与 config.ACTIVITY_TYPES 同序的桩（只关心 type 字段）
const TYPES = ['walking', 'running', 'hiking', 'mountaineering', 'cycling', 'skiing', 'rowing', 'swimming'].map(
  (type) => ({ type, label: type }),
);
const keys = (list) => list.map((t) => t.type);
const counts = (pairs) => pairs.map(([type, count]) => ({ type, count }));

test('LT1 有数据的排前面：dev 真实分布下骑行从第 5 提到第 4', () => {
  const c = counts([
    ['walking', 430], ['running', 292], ['hiking', 209], ['mountaineering', 0],
    ['cycling', 5], ['skiing', 0], ['rowing', 0], ['swimming', 0],
  ]);
  assert.deepEqual(keys(sortTypesByCount(TYPES, c)), [
    'walking', 'running', 'hiking', 'cycling', 'mountaineering', 'skiing', 'rowing', 'swimming',
  ]);
});

test('LT2 同数量保持稳定：计数相同（含全 0）时顺序与 config 完全一致', () => {
  const zero = counts(TYPES.map((t) => [t.type, 0]));
  assert.deepEqual(keys(sortTypesByCount(TYPES, zero)), keys(TYPES), '全 0 不该打乱原序');
  const tie = counts([['swimming', 7], ['walking', 7], ['running', 3]]);
  assert.deepEqual(keys(sortTypesByCount(TYPES, tie)), ['walking', 'swimming', 'running', 'hiking', 'mountaineering', 'cycling', 'skiing', 'rowing'], '并列按原序、0 的排后面');
});

test('LT3 缺计数当 0：接口少给某项时它落到末尾，不当最大值', () => {
  const partial = counts([['rowing', 12], ['walking', 1]]);
  assert.deepEqual(keys(sortTypesByCount(TYPES, partial)).slice(0, 2), ['rowing', 'walking']);
  assert.equal(keys(sortTypesByCount(TYPES, partial)).pop(), 'swimming', '未给计数的仍按原序垫底');
});

test('LT4 脏输入不改顺序：counts 为空/null/含非法项时原样返回', () => {
  for (const bad of [null, undefined, [], counts([['walking', 'x'], ['running', -1]])]) {
    assert.deepEqual(keys(sortTypesByCount(TYPES, bad)), keys(TYPES), `异常计数应退化成 config 原序：${JSON.stringify(bad)}`);
  }
  assert.deepEqual(sortTypesByCount([], counts([['walking', 1]])), [], '空类型表返回空');
});

test('LT5 不修改入参数组', () => {
  const before = keys(TYPES);
  sortTypesByCount(TYPES, counts([['swimming', 9]]));
  assert.deepEqual(keys(TYPES), before, '排序必须返回新数组');
});

test('LT6 重排后按 type 找回选中项；找不到的兜底 -1 由调用方决定', () => {
  const sorted = sortTypesByCount(TYPES, counts([['swimming', 9], ['walking', 5]]));
  assert.equal(indexOfType(sorted, 'swimming'), 0);
  assert.equal(indexOfType(sorted, 'walking'), 1);
  assert.equal(indexOfType(sorted, 'hiking'), 3, '徒步无计数落到 0 数组的第 3 格');
  assert.equal(indexOfType(sorted, 'nope'), -1);
  assert.equal(indexOfType(sorted, undefined), -1);
});

test('LT7 页面一次落地：排完序顺带给出选中项新下标', () => {
  const r = applyTypeCounts({ types: TYPES, counts: counts([['swimming', 9], ['walking', 5]]), currentType: 'hiking' });
  assert.deepEqual(keys(r.types), ['swimming', 'walking', 'running', 'hiking', 'mountaineering', 'cycling', 'skiing', 'rowing']);
  assert.equal(r.typeIndex, 3, '原来选中的徒步重排后落到第 4 格');
  assert.equal(r.types[r.typeIndex].type, 'hiking');
});

test('LT8 计数拉不到时保持原序，选中项不丢', () => {
  for (const bad of [null, undefined, [], 'oops']) {
    const r = applyTypeCounts({ types: TYPES, counts: bad, currentType: 'cycling' });
    assert.deepEqual(keys(r.types), keys(TYPES), `脏计数不该动顺序：${JSON.stringify(bad)}`);
    assert.equal(r.types[r.typeIndex].type, 'cycling', '选中项必须还在');
  }
});

test('LT9 选中项已不在表里（如外部传了非法 type）时退回第一格', () => {
  const r = applyTypeCounts({ types: TYPES, counts: counts([['rowing', 3]]), currentType: 'yoga' });
  assert.equal(r.typeIndex, 0);
  assert.equal(r.types[0].type, 'rowing', '有数据的仍排最前');
});
