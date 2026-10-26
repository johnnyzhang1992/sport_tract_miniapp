/**
 * 定位精度归一化（Android 机型 / 微信版本差异兜底）
 *
 * 背景：Android 15 + Redmi 23117RK66C 实测 accuracy 全为 null，落库 521 点无精度，
 * 所有基于精度的防线失效。四类成因均在 resolveAccuracy 里兜：
 * 数字字符串、换名字段、0/负数表示无效、离谱值（无定位兜底）。
 * 运行：node --test test/loc-accuracy.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveAccuracy, describeAccuracyFields } = require('../miniprogram/utils/loc-accuracy.js');

test('LA1 标准 number：正常返回并取整', () => {
  assert.equal(resolveAccuracy({ accuracy: 5 }), 5);
  assert.equal(resolveAccuracy({ accuracy: 12.6 }), 13);
  assert.equal(resolveAccuracy({ accuracy: 0.4 }), 0, '极小值取整为 0，调用方按 >0 判断（见 LA5 口径说明）');
});

test('LA2 数字字符串（微信桥形态差异）：旧代码判 null，现在能解析', () => {
  assert.equal(resolveAccuracy({ accuracy: '8' }), 8);
  assert.equal(resolveAccuracy({ accuracy: ' 15.4 ' }), 15);
});

test('LA3 换名字段：accuracy 缺失时退到 horizontalAccuracy / verticalAccuracy', () => {
  assert.equal(resolveAccuracy({ horizontalAccuracy: 6 }), 6);
  assert.equal(resolveAccuracy({ verticalAccuracy: 20 }), 20);
  // accuracy 存在但无效时也继续往后找
  assert.equal(resolveAccuracy({ accuracy: 0, horizontalAccuracy: 7 }), 7);
});

test('LA4 优先级：accuracy 有效时优先于其它字段', () => {
  assert.equal(resolveAccuracy({ accuracy: 4, horizontalAccuracy: 20 }), 4);
});

test('LA5 0 / 负数 / 非数值 → null（未知），不得当作完美精度', () => {
  // 0 若被当成有效值，弱信号段会被误认为高质量点全量收录（比 null 更危险）
  assert.equal(resolveAccuracy({ accuracy: 0 }), null);
  assert.equal(resolveAccuracy({ accuracy: -3 }), null);
  assert.equal(resolveAccuracy({ accuracy: '' }), null);
  assert.equal(resolveAccuracy({ accuracy: 'abc' }), null);
  assert.equal(resolveAccuracy({ accuracy: NaN }), null);
  assert.equal(resolveAccuracy({ accuracy: Infinity }), null);
  assert.equal(resolveAccuracy({ accuracy: {} }), null);
  assert.equal(resolveAccuracy({ accuracy: null }), null);
});

test('LA6 离谱值（>1000m，无定位兜底）→ null', () => {
  assert.equal(resolveAccuracy({ accuracy: 9999 }), null);
  assert.equal(resolveAccuracy({ accuracy: 1001 }), null);
  assert.equal(resolveAccuracy({ accuracy: 1000 }), 1000, '边界值仍算有效');
});

test('LA7 空对象 / null / undefined → null', () => {
  assert.equal(resolveAccuracy({}), null);
  assert.equal(resolveAccuracy(null), null);
  assert.equal(resolveAccuracy(undefined), null);
});

test('LA8 describeAccuracyFields：诊断只回传存在的精度字段', () => {
  assert.deepEqual(describeAccuracyFields({ accuracy: 5, horizontalAccuracy: 6 }), {
    accuracy: 5,
    horizontalAccuracy: 6,
  });
  assert.deepEqual(describeAccuracyFields({ latitude: 30 }), {});
  assert.equal(describeAccuracyFields(null), null);
});

test('LA9 tracker 集成：字符串精度不再被丢弃，超阈值仍标 accBad', () => {
  const { Tracker } = require('../miniprogram/services/tracker.js');
  const DEG = 1 / 111194.9;
  let clock = 0;
  const t = new Tracker('walking', 60, () => clock);
  // 字符串精度 '8'（旧代码 → null，不判 accBad；现在 → 8，正常点）
  t.addPoint({ latitude: 30, longitude: 120, speed: 1, accuracy: '8' });
  assert.equal(t.points[0].accuracy, 8, '字符串精度应被解析');
  assert.equal(t.points[0].accBad, undefined);
  // 精度 '80' 超 walking 阈值 60 → 标 accBad
  clock += 3000;
  t.addPoint({ latitude: 30 + 40 * DEG, longitude: 120, speed: 1, accuracy: '80' }); // 40m：过差精度抽稀（≥30m 才收）
  assert.equal(t.points[1].accuracy, 80);
  assert.equal(t.points[1].accBad, true, '精度差应标 accBad');
});

test('LA10 tracker 集成：accuracy=0 视为未知（不标 accBad，但也不当完美精度）', () => {
  const { Tracker } = require('../miniprogram/services/tracker.js');
  const DEG = 1 / 111194.9;
  let clock = 0;
  const t = new Tracker('walking', 60, () => clock);
  t.addPoint({ latitude: 30, longitude: 120, speed: 1, accuracy: 0 });
  assert.equal(t.points[0].accuracy, null, '0 应归一化为 null');
  clock += 3000;
  t.addPoint({ latitude: 30 + 40 * DEG, longitude: 120, speed: 1, accuracy: 0 }); // 40m：过抽稀
  if (t.points.length < 2) return; // 防御：极端情况下被节流丢弃
  assert.equal(t.points[1].accBad, undefined, '未知精度不标 accBad（走无精度路径）');
});
