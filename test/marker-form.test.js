/**
 * components/marker-form 回归：编辑态已有照片的「缩略图渲染 + 原图预览」两串数组对齐
 * 背景：格子只有 140rpx，改为渲染 photoThumbs；提交比对与 previewImage 仍用原图 photos。
 * 桩：全局 wx（previewImage/showToast）；Component() 捕获定义后手工装配 data/setData。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let previews = []; // wx.previewImage 入参
let toasts = [];
global.wx = {
  previewImage(o) { previews.push(o); },
  showToast(o) { toasts.push(o && o.title); },
  chooseMedia() {},
  getImageInfo() {},
};
let compDef = null;
global.Component = (def) => { compDef = def; };
require('../miniprogram/components/marker-form/marker-form.js');
assert.ok(compDef, 'marker-form.js 应通过 Component() 交出组件对象');

function makeComp() {
  const c = Object.assign({}, compDef.methods);
  c.data = JSON.parse(JSON.stringify(compDef.data));
  c.setData = (patch) => Object.assign(c.data, patch);
  return c;
}

/** 模拟「编辑态打开某个打点」 */
function openEdit(marker) {
  const c = makeComp();
  c.setData({ editMode: true, marker });
  compDef.observers['visible, marker'].call(c, true, marker);
  return c;
}

const SIGNED = (name) => `https://oss.example.com/p/${name}?OSSAccessKeyId=k&Signature=${name}`;

test('编辑态打开：格子数组用缩略图档，原图数组留给提交与预览，两者同长同序', () => {
  const c = openEdit({
    id: 'm1',
    type: 'photo',
    photos: [SIGNED('a'), SIGNED('b')],
    photoUrl: SIGNED('a'), // 首图双份记录，不该多出一张
    photoThumbs: ['https://oss.example.com/p/a?thumb=1', 'https://oss.example.com/p/b?thumb=1'],
  });
  assert.equal(c.data.existingPhotos.length, 2, 'photoUrl 与 photos[0] 同图去重');
  assert.deepEqual(c.data.existingThumbs, ['https://oss.example.com/p/a?thumb=1', 'https://oss.example.com/p/b?thumb=1']);
  assert.equal(c.data.existingThumbs.length, c.data.existingPhotos.length, '两串按下标一一对应');
});

test('老数据只有 photoUrl：照样一条原图 + 一条缩略图', () => {
  const c = openEdit({ id: 'm2', type: 'photo', photos: [], photoUrl: SIGNED('c'), photoThumbs: ['https://oss.example.com/p/c?thumb=1'] });
  assert.deepEqual(c.data.existingPhotos, [SIGNED('c')]);
  assert.deepEqual(c.data.existingThumbs, ['https://oss.example.com/p/c?thumb=1']);
});

test('删一张：两串同时剔除同一下标，不会把缩略图串到别的照片上', () => {
  const c = openEdit({
    id: 'm3',
    type: 'photo',
    photos: [SIGNED('a'), SIGNED('b'), SIGNED('d')],
    photoUrl: '',
    photoThumbs: ['ta', 'tb', 'td'],
  });
  c.removeExistingPhoto({ currentTarget: { dataset: { idx: 1 } } });
  assert.deepEqual(c.data.existingPhotos, [SIGNED('a'), SIGNED('d')]);
  assert.deepEqual(c.data.existingThumbs, ['ta', 'td']);
});

test('点格子看大图：previewImage 收到的是原图串，current 为对应那张', () => {
  previews = [];
  const c = openEdit({ id: 'm4', type: 'photo', photos: [SIGNED('a'), SIGNED('b')], photoUrl: '', photoThumbs: ['ta', 'tb'] });
  c.previewExisting({ currentTarget: { dataset: { idx: 1 } } });
  assert.equal(previews.length, 1);
  assert.deepEqual(previews[0].urls, [SIGNED('a'), SIGNED('b')], '大图不能是缩略图档');
  assert.equal(previews[0].current, SIGNED('b'));
});

test('没有照片时点开预览：给具体文案，不静默', () => {
  previews = [];
  toasts = [];
  const c = openEdit({ id: 'm5', type: 'photo', photos: [], photoUrl: '', photoThumbs: [] });
  c.previewExisting({ currentTarget: { dataset: { idx: 0 } } });
  assert.equal(previews.length, 0, '没图不该拉起预览');
  assert.deepEqual(toasts, ['这条打点没有可预览的照片']);
});
