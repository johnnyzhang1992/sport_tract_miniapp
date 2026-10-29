/**
 * 「游泳/骑行不看配速」单一来源（miniprogram/utils/pace-types.js）
 *
 * 背景：这条规则原先以 ['swimming', 'cycling'] 内联字面量的形式散在 tracker / track-detail /
 * year-report 三处。再加第四种「不算配速」的类型时，漏改一处就会静默漂移（服务端早已抽出
 * NO_PACE_TYPES / hasNoPace，小程序侧此前没有对应物）。
 *
 * 源码守卫的注意点：本仓被「注释里提到的话被自己的守卫匹配到」咬过，所以守卫先剥掉注释
 * （块注释 + 行注释）再匹配「两个类型组成的数组字面量」——注释里写 `['swimming', 'cycling']`
 * 不算违规，只有真正的代码字面量才算。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { NO_PACE_TYPES, hasNoPace } = require('../miniprogram/utils/pace-types');

/** 八个运动类型里的其余六个：都不该被判成「不算配速」 */
const PACED_TYPES = ['walking', 'running', 'hiking', 'mountaineering', 'skiing', 'rowing'];

/** 去掉块注释与行注释（行注释留一个分隔符，避免把 x // y 粘成一个词；不碰 http:// 的冒号后 //） */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 代码里的硬编码清单（两种顺序、单双引号都算），注释已被剥掉，不会误报 */
const INLINE_LIST =
  /\[\s*['"]swimming['"]\s*,\s*['"]cycling['"]\s*\]|\[\s*['"]cycling['"]\s*,\s*['"]swimming['"]\s*\]/;

const GUARDED_FILES = [
  'miniprogram/services/tracker.js',
  'miniprogram/pages/track-detail/track-detail.js',
  'miniprogram/pages/year-report/year-report.js',
];

test('NP1 游泳/骑行判为不算配速', () => {
  assert.equal(hasNoPace('swimming'), true);
  assert.equal(hasNoPace('cycling'), true);
});

test('NP2 其余六种类型仍算配速', () => {
  for (const type of PACED_TYPES) {
    assert.equal(hasNoPace(type), false, `${type} 不该被判成不算配速`);
  }
});

test('NP3 缺类型/空串一律 false 且不抛（旧数据 type 可能缺失）', () => {
  assert.equal(hasNoPace(undefined), false);
  assert.equal(hasNoPace(null), false);
  assert.equal(hasNoPace(''), false);
});

test('NP4 常量是冻结数组，包含且仅包含这两种', () => {
  assert.ok(Object.isFrozen(NO_PACE_TYPES), '要被冻结：调用点只读，改不动单一来源');
  assert.deepEqual([...NO_PACE_TYPES], ['swimming', 'cycling']);
});

test('NP5 源码守卫：三处不再内联硬编码清单，且都改走 hasNoPace', () => {
  for (const rel of GUARDED_FILES) {
    const raw = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    const code = stripComments(raw);
    assert.ok(!INLINE_LIST.test(code), `${rel} 仍内联了 ['swimming', 'cycling']，应改用 utils/pace-types.js 的 hasNoPace`);
    assert.match(code, /hasNoPace\(/, `${rel} 要真的调用 hasNoPace（不能只是删掉判据）`);
  }
});

test('NP6 守卫不误伤注释：注释里出现过旧写法不算违规', () => {
  const sample = [
    '// 旧写法 ![\'swimming\', \'cycling\'].includes(type) 已收敛到 utils/pace-types.js',
    '/* [\'swimming\', \'cycling\'] 两个类型都走 hasNoPace */',
    'const ok = hasNoPace(type);',
  ].join('\n');
  assert.ok(!INLINE_LIST.test(stripComments(sample)), '注释里提到字面量不应触发守卫');
  assert.ok(INLINE_LIST.test("const bad = !['swimming', 'cycling'].includes(type);"), '真代码里的字面量仍要被抓到');
});
