/**
 * services/oss-upload.js 回归：检测副本（q50 起逐档下探，≤1MB 才送检）→ 合规检测 → 存档副本 q80 直传 OSS
 * 桩：全局 wx（compressImage/getFileInfo/uploadFile/editImage）；services/api 用 require.cache 注入假实现。
 * 覆盖：送检/直传各用哪份副本、压不进 1MB 的逐档下探与 tooLarge 判定、压缩不可用时的短路与回退、
 *       违规与直传失败的返回形态、editImage 的取消/不可用降级。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const KB = 1024;
const MB = 1024 * 1024;

/* ---------------------------------- 环境桩 ---------------------------------- */

let compressCalls; // [{src, quality}]
let sizeMap; // 路径 → 字节（未配置视为 0 = 未知）
let checkCalls; // 送检路径
let uploadCalls; // 直传使用的本地路径
let credCalls; // /oss/credential 请求
let checkResult; // 合规检测返回
let compressBroken; // true = compressImage 恒失败（回退原路径）

const fakeApi = {
  checkImage(p) {
    checkCalls.push(p);
    return Promise.resolve(checkResult);
  },
  post(url, body) {
    credCalls.push({ url, body });
    return Promise.resolve({
      dir: `users/u1/${body.dir}/`,
      endpoint: 'https://oss.example.com',
      policy: 'p',
      OSSAccessKeyId: 'ak',
      signature: 'sig',
    });
  },
};
const apiPath = require.resolve(path.join(ROOT, 'miniprogram/services/api.js'));
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

const { uploadPhoto, editImage } = require(path.join(ROOT, 'miniprogram/services/oss-upload.js'));

function setup({ sizes = {}, check = { risky: false }, broken = false } = {}) {
  compressCalls = [];
  sizeMap = sizes;
  checkCalls = [];
  uploadCalls = [];
  credCalls = [];
  checkResult = check;
  compressBroken = broken;
  global.wx = {
    compressImage({ src, quality, success, fail }) {
      compressCalls.push({ src, quality });
      if (compressBroken) return fail({ errMsg: 'compressImage:fail' });
      success({ tempFilePath: `${src}#q${quality}` });
    },
    getFileInfo({ filePath, success }) {
      success({ size: sizeMap[filePath] || 0 });
    },
    uploadFile({ filePath, success }) {
      uploadCalls.push(filePath);
      success({ statusCode: 200, data: '' });
    },
  };
}

/* ---------------------------------- 用例 ---------------------------------- */

test('检测副本压到 q50 送检；通过后存档副本 q80 直传', async () => {
  setup({ sizes: { 'tmp/a.jpg': 3 * MB, 'tmp/a.jpg#q50': 600 * KB, 'tmp/a.jpg#q80': 2 * MB } });
  const r = await uploadPhoto('tmp/a.jpg', { dir: 'footprints', prefix: 'fp_' });

  assert.equal(checkCalls[0], 'tmp/a.jpg#q50'); // 送检的是检测副本
  assert.deepEqual(compressCalls.map((c) => c.quality), [50, 80]); // q50 检测 → q80 存档
  assert.equal(uploadCalls[0], 'tmp/a.jpg#q80'); // 直传的是存档副本
  assert.match(r.url, /^https:\/\/oss\.example\.com\/users\/u1\/footprints\/fp_\d+_\d+\.jpg$/);
  assert.deepEqual(credCalls[0], { url: '/oss/credential', body: { dir: 'footprints' } });
});

test('q50 压不进 1MB → 逐档下探，用最小副本送检', async () => {
  setup({
    sizes: {
      'tmp/a.jpg': 4 * MB,
      'tmp/a.jpg#q50': 2 * MB,
      'tmp/a.jpg#q35': 1.2 * MB,
      'tmp/a.jpg#q25': 0.8 * MB,
      'tmp/a.jpg#q80': 3 * MB,
    },
  });
  const r = await uploadPhoto('tmp/a.jpg');

  assert.deepEqual(
    compressCalls.filter((c) => c.quality !== 80).map((c) => c.quality),
    [50, 35, 25],
  );
  assert.equal(checkCalls[0], 'tmp/a.jpg#q25');
  assert.ok(r.url);
});

test('压到下探底线仍超 1MB → tooLarge（带具体大小），不送检、不取凭证、不直传', async () => {
  setup({
    sizes: { 'tmp/a.jpg': 5 * MB, 'tmp/a.jpg#q50': 3 * MB, 'tmp/a.jpg#q35': 2.4 * MB, 'tmp/a.jpg#q25': 1.5 * MB },
  });
  const r = await uploadPhoto('tmp/a.jpg');

  assert.equal(r.tooLarge, true);
  assert.equal(r.sizeBytes, 1.5 * MB);
  assert.equal(checkCalls.length, 0);
  assert.equal(credCalls.length, 0);
  assert.equal(uploadCalls.length, 0);
});

test('本图已 ≤1MB → 原图直接送检，不做无谓压缩', async () => {
  setup({ sizes: { 'tmp/a.jpg': 500 * KB, 'tmp/a.jpg#q80': 400 * KB } });
  const r = await uploadPhoto('tmp/a.jpg');

  assert.equal(checkCalls[0], 'tmp/a.jpg');
  assert.deepEqual(compressCalls.map((c) => c.quality), [80]); // 检测阶段零压缩，只剩存档压
  assert.equal(uploadCalls[0], 'tmp/a.jpg#q80');
  assert.ok(r.url);
});

test('压缩不可用（如部分格式）：原图 ≤1MB 照常检测+直传，不重复降档', async () => {
  setup({ sizes: { 'tmp/raw.png': 500 * KB }, broken: true });
  const r = await uploadPhoto('tmp/raw.png');

  assert.deepEqual(compressCalls.map((c) => c.quality), [80]); // 检测阶段短路（0 次）→ 存档失败回退原图
  assert.equal(checkCalls[0], 'tmp/raw.png');
  assert.equal(uploadCalls[0], 'tmp/raw.png');
  assert.ok(r.url);
});

test('压缩不可用且原图超 1MB → 只试一档即判 tooLarge，不空转', async () => {
  setup({ sizes: { 'tmp/raw.png': 3 * MB }, broken: true });
  const r = await uploadPhoto('tmp/raw.png');

  assert.equal(r.tooLarge, true);
  assert.equal(r.sizeBytes, 3 * MB);
  assert.deepEqual(compressCalls.map((c) => c.quality), [50]);
});

test('检测违规 → blocked，不发生凭证请求与直传', async () => {
  setup({ sizes: { 'tmp/a.jpg': 2 * MB, 'tmp/a.jpg#q50': 900 * KB }, check: { risky: true } });
  const r = await uploadPhoto('tmp/a.jpg');

  assert.equal(r.blocked, true);
  assert.equal(credCalls.length, 0);
  assert.equal(uploadCalls.length, 0);
});

test('OSS 直传非 200 → null（调用方按上传失败处理）', async () => {
  setup({ sizes: { 'tmp/a.jpg': 2 * MB, 'tmp/a.jpg#q50': 800 * KB } });
  global.wx.uploadFile = ({ success }) => success({ statusCode: 400, data: 'EntityTooLarge' });
  const r = await uploadPhoto('tmp/a.jpg');

  assert.equal(r, null);
});

test('editImage：成功返回编辑产物；取消与 API 缺失都返回 null', async () => {
  setup();
  global.wx.editImage = ({ src, success }) => success({ tempFilePath: `${src}#edited` });
  assert.equal(await editImage('tmp/a.jpg'), 'tmp/a.jpg#edited');

  global.wx.editImage = ({ fail }) => fail({ errMsg: 'editImage:fail cancel' });
  assert.equal(await editImage('tmp/a.jpg'), null);

  delete global.wx.editImage;
  assert.equal(await editImage('tmp/a.jpg'), null);
});
