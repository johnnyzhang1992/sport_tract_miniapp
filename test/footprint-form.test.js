/**
 * components/footprint-form 回归：新增/编辑半屏表单（打开初始化、提交走 POST/PUT、保存事件、超限/编辑拦截）
 * 桩：全局 wx（showToast/chooseLocation/chooseMedia…）；Page/Component 捕获定义；services/api 与
 *     services/oss-upload 均用 require.cache 注入假实现（oss-upload 另有自己的用例锁内部链路）。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MB = 1024 * 1024;

/* ---------------------------------- 环境桩 ---------------------------------- */

let toasts; // showToast 文案
let apiCalls; // { method, url, body }
let uploadCalls; // uploadPhoto 入参
let uploadResult; // uploadPhoto 返回值（用例控制）
let chooseLocationResult; // wx.chooseLocation success 参数
let editImageCalls; // editImage 调用次数
let pageScrolls = []; // pageScrollTo 入参（键盘开合各复位一次）

const fakeApi = {
  put(url, body) {
    apiCalls.push({ method: 'PUT', url, body });
    return Promise.resolve({});
  },
  post(url, body) {
    apiCalls.push({ method: 'POST', url, body });
    return Promise.resolve({});
  },
};
const fakeOss = {
  uploadPhoto(filePath, opts) {
    uploadCalls.push({ filePath, opts });
    return Promise.resolve(uploadResult);
  },
  editImage(src) {
    editImageCalls.push(src);
    return Promise.resolve(null);
  },
};
for (const [p, exports] of [
  [require.resolve('../miniprogram/services/api.js'), fakeApi],
  [require.resolve('../miniprogram/services/oss-upload.js'), fakeOss],
]) {
  require.cache[p] = { id: p, filename: p, loaded: true, exports, children: [], paths: [] };
}

let compDef = null;
global.Component = (def) => { compDef = def; };
global.wx = {
  showToast(o) { toasts.push(o && o.title); },
  chooseLocation({ success }) { success(chooseLocationResult); },
  chooseMedia() {},
  editImage() {},
  previewImage() {},
  // iOS 键盘修复会强制复位滚动位置；真机返回 Promise，桩同形态才不掩盖 .catch 链
  pageScrollTo(o) { pageScrolls.push(o); return Promise.resolve(); },
};
require('../miniprogram/components/footprint-form/footprint-form.js');
assert.ok(compDef, 'footprint-form.js 应通过 Component() 交出组件对象');

/* --------------------------------- 组件装配 --------------------------------- */

function applyPath(target, keyPath, value) {
  const keys = keyPath.split('.');
  let o = target;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

function makeComp() {
  const c = Object.assign({}, compDef.methods);
  c.data = JSON.parse(JSON.stringify(compDef.data));
  c.setData = (patch, cb) => {
    Object.keys(patch).forEach((k) => applyPath(c.data, k, patch[k]));
    if (cb) cb();
  };
  c.events = [];
  c.triggerEvent = (name, detail) => c.events.push({ name, detail: detail || {} });
  return c;
}

/** 模拟「父级设 visible+record → 框架触发 observers」的打开流程 */
function open(record) {
  const c = makeComp();
  c.setData({ visible: true, record: record || null });
  compDef.observers['visible, record'].call(c, c.data.visible);
  return c;
}

const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

test('新增态打开：日期为今天、其余清空、canSubmit 关闭；填标题+选点后开启', () => {
  toasts = [];
  const c = open(null);
  assert.equal(c.data.isEdit, false);
  assert.equal(c.data.visitDate, today());
  assert.equal(c.data.title, '');
  assert.equal(c.data.photos.length, 0);
  assert.equal(c.data.canSubmit, false);

  c.onTitle({ detail: { value: '  爬山  ' } });
  assert.equal(c.data.canSubmit, false, '只有标题不能提交');
  chooseLocationResult = { name: '西湖', address: '杭州市西湖区', latitude: 30.24, longitude: 120.14 };
  c.pickByWx();
  assert.equal(c.data.canSubmit, true);
  assert.equal(c.data.location.name, '西湖');
});

test('编辑态打开：完整 DTO 直接回填（含已存照片），isEdit 为真', () => {
  const c = open({
    id: 'rec1',
    visitDate: '2026-08-01',
    title: '古镇',
    people: ['小明'],
    description: '很好',
    location: { name: '乌镇', address: '嘉兴', latitude: 30.7, longitude: 120.5 },
    photos: ['https://oss.example.com/a.jpg?sig=1'],
  });
  assert.equal(c.data.isEdit, true);
  assert.equal(c.data.id, 'rec1');
  assert.equal(c.data.title, '古镇');
  assert.deepEqual(c.data.people, ['小明']);
  assert.equal(c.data.photos.length, 1);
  assert.equal(c.data.photos[0].localPath, null);
  assert.equal(c.data.canSubmit, true);
});

test('关闭后再以新增态打开：上一次的编辑残留被清空', () => {
  const c = open({ id: 'rec1', visitDate: '2026-08-01', title: '古镇', people: ['小明'], description: 'x', location: { name: '乌镇' }, photos: [] });
  c.setData({ visible: false, record: null });
  c.setData({ visible: true, record: null });
  compDef.observers['visible, record'].call(c, true);

  assert.equal(c.data.isEdit, false);
  assert.equal(c.data.title, '');
  assert.deepEqual(c.data.people, []);
  assert.equal(c.data.location, null);
  assert.equal(c.data.visitDate, today());
  assert.equal(c.data.submitting, false);
});

test('新增提交：新图先上传（q50/q80 链在 oss-upload 内部），再 POST；成功后发 saved 事件', async () => {
  toasts = [];
  apiCalls = [];
  uploadCalls = [];
  uploadResult = { url: 'https://oss.example.com/new.jpg?sig=2' };
  const c = open(null);
  c.onTitle({ detail: { value: '爬山' } });
  chooseLocationResult = { name: '黄山', address: '安徽', latitude: 30.1, longitude: 118.1 };
  c.pickByWx();
  c.setData({ photos: [{ url: '', localPath: 'tmp/a.jpg' }] });

  await c.submit();
  assert.equal(uploadCalls.length, 1);
  assert.deepEqual(uploadCalls[0].opts, { dir: 'footprints', prefix: 'fp_' });
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].method, 'POST');
  assert.equal(apiCalls[0].url, '/footprint-records');
  assert.deepEqual(apiCalls[0].body.photos, ['https://oss.example.com/new.jpg?sig=2']);
  assert.equal(apiCalls[0].body.title, '爬山');
  assert.equal(apiCalls[0].body.location.name, '黄山');
  assert.deepEqual(c.events.map((e) => e.name), ['saved']);
});

test('编辑提交：已存照片不重复上传（url 原样回填），走 PUT /:id', async () => {
  toasts = [];
  apiCalls = [];
  uploadCalls = [];
  const c = open({
    id: 'rec1',
    visitDate: '2026-08-01',
    title: '古镇',
    people: [],
    description: '',
    location: { name: '乌镇', address: '嘉兴', latitude: 30.7, longitude: 120.5 },
    photos: ['https://oss.example.com/a.jpg?sig=1'],
  });
  c.onTitle({ detail: { value: '古镇夜游' } });

  await c.submit();
  assert.equal(uploadCalls.length, 0, '已存图不应重新上传');
  assert.equal(apiCalls[0].method, 'PUT');
  assert.equal(apiCalls[0].url, '/footprint-records/rec1');
  assert.deepEqual(apiCalls[0].body.photos, ['https://oss.example.com/a.jpg?sig=1']);
  assert.deepEqual(c.events.map((e) => e.name), ['saved']);
});

test('照片压不进 1MB：提交中止、不上传记录、toast 带具体大小、submitting 复位', async () => {
  toasts = [];
  apiCalls = [];
  uploadResult = { tooLarge: true, sizeBytes: 1.5 * MB };
  const c = open(null);
  c.onTitle({ detail: { value: '爬山' } });
  chooseLocationResult = { name: '黄山', address: '安徽', latitude: 30.1, longitude: 118.1 };
  c.pickByWx();
  c.setData({ photos: [{ url: '', localPath: 'tmp/big.jpg' }] });

  await c.submit();
  assert.equal(apiCalls.length, 0, '超限不得写库');
  assert.equal(c.events.length, 0, '不触发 saved');
  assert.equal(c.data.submitting, false);
  assert.match(toasts[toasts.length - 1], /第 1 张.*1\.5MB.*1MB 上限/);
});

test('点已存 OSS 的照片：toast 拦截、不调编辑', async () => {
  toasts = [];
  editImageCalls = [];
  const c = open({
    id: 'rec1',
    visitDate: '2026-08-01',
    title: '古镇',
    people: [],
    description: '',
    location: { name: '乌镇' },
    photos: ['https://oss.example.com/a.jpg?sig=1'],
  });
  await c.editPhoto({ currentTarget: { dataset: { idx: 0 } } });
  assert.equal(editImageCalls.length, 0);
  assert.equal(toasts[toasts.length - 1], '已保存的照片暂不支持编辑');
});

test('键盘高度变化：弹层抬升并缩高，收键盘后还原默认样式', () => {
  pageScrolls = [];
  const c = open(null);
  c.onKeyboardHeight({ detail: { height: 300 } });
  assert.match(c.data.sheetStyle, /bottom:300px/);
  assert.match(c.data.sheetStyle, /calc\(100vh - 348px\)/);
  c.onKeyboardHeight({ detail: { height: 0 } });
  assert.equal(c.data.sheetStyle, 'bottom:0;height:78vh;');
  assert.equal(pageScrolls.length, 2, '键盘开合都要复位滚动位置（iOS fixed 弹层错位的标准解法）');
});

/* ---------------- 分类（2026-09-22 足迹分类上线） ---------------- */

const CAT_KEYS = ['scenic', 'mountain', 'park', 'heritage', 'museum', 'street', 'food', 'camp', 'other'];

test('分类：新增态未选，chips 用 config 的 9 类；点选与再点取消', () => {
  const c = open(null);
  assert.equal(c.data.category, '');
  assert.deepEqual(c.data.categories.map((x) => x.key), CAT_KEYS);
  assert.equal(c.data.categories[0].label, '景区');
  assert.equal(c.data.categories[0].icon, '/assets/icons/fp-cat-scenic.png', '表单用透明底字形，底色交给 CSS');
  c.onCategory({ currentTarget: { dataset: { key: 'museum' } } });
  assert.equal(c.data.category, 'museum');
  assert.equal(c.data.categories.find((x) => x.key === 'museum').active, true);
  c.onCategory({ currentTarget: { dataset: { key: 'museum' } } });
  assert.equal(c.data.category, '', '再点一次等于取消分类');
  assert.equal(c.data.categories.find((x) => x.key === 'museum').active, false);
});

test('分类：编辑态回填，POST/PUT 两条提交路径都带上 category', async () => {
  toasts = [];
  apiCalls = [];
  uploadCalls = [];
  const full = {
    id: 'rec1',
    visitDate: '2026-08-01',
    title: '古镇',
    people: [],
    description: '',
    location: { name: '乌镇', address: '嘉兴', latitude: 30.7, longitude: 120.5 },
    photos: [],
    category: 'heritage',
  };
  const edit = open(full);
  assert.equal(edit.data.category, 'heritage');
  await edit.submit();
  assert.equal(apiCalls[0].method, 'PUT');
  assert.equal(apiCalls[0].body.category, 'heritage');

  apiCalls = [];
  uploadCalls = [];
  const add = open(null);
  add.onTitle({ detail: { value: '营地' } });
  chooseLocationResult = { name: '西湖边营地', address: '杭州', latitude: 30.2, longitude: 120.1 };
  add.pickByWx();
  add.onCategory({ currentTarget: { dataset: { key: 'camp' } } });
  await add.submit();
  assert.equal(apiCalls[0].method, 'POST');
  assert.equal(apiCalls[0].body.category, 'camp');
});
