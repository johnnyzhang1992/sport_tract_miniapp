/**
 * 默认头像预设盘（config.DEFAULT_AVATARS）回归。
 * 为什么要测：图片是手删的（2026-09-23 删了 3 张），配置盘里留着死 key 就是资料页网格上的破图，
 * 而 `avatarPreset` 在后端是自由字符串（zod 只限长度、不校验 key），端上直接拼路径 → 没有任何环节会报错。
 * 运行：npm test；依赖：node:fs + node:path（读真实资源目录，不 mock）。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../miniprogram/config/index.js');

const AVATAR_DIR = path.join(__dirname, '..', 'miniprogram', 'assets', 'avatars');

test('A1 预设盘每个 key 都有同名 PNG（删图必须同步删 key）', () => {
  const missing = config.DEFAULT_AVATARS.map((a) => a.key).filter((k) => !fs.existsSync(path.join(AVATAR_DIR, `${k}.png`)));
  assert.deepEqual(missing, [], `配置盘引用了不存在的头像资源：${missing.join('、')}`);
});

test('A2 盘不能空、key 不能重复（空盘会让资料页头像区整块消失）', () => {
  const keys = config.DEFAULT_AVATARS.map((a) => a.key);
  assert.ok(keys.length > 0, 'DEFAULT_AVATARS 为空时资料页不渲染预设网格');
  assert.equal(new Set(keys).size, keys.length, '重复 key 会让网格里两格同时高亮');
  keys.forEach((k) => assert.ok(/^[a-z0-9-]+$/.test(k), `key ${k} 拼不进 /assets/avatars/<key>.png`));
});
