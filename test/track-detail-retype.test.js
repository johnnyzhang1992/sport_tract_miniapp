/**
 * 轨迹详情页「换类型引导纠偏」页级回归（docs/19 §4.3 补遗配套）。
 *
 * 服务端 PUT /meta 换类型会重算 fastestKm/表现分/漂移分，但非运动段标记属纠偏语义
 * 不自动重判——页面必须：① 整页重拉（服务端口径变了，局部 setData 会展示旧指标）；
 * ② 弹窗引导「去纠偏」，确认后跳过纠偏的二次确认直接执行；③ 仅改备注不走引导。
 *
 * 运行：node --test test/track-detail-retype.test.js
 * 桩：wx / Page / getApp 就地 stub；services/api 用 require.cache 注入假实现。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

/* ---------------------------------- 环境桩 ---------------------------------- */

const modals = []; // wx.showModal 调用记录 { title, content, confirmText }
let modalScript = []; // 每次弹窗按序弹出的 resolve 结果
const toasts = [];
const wxShim = {
  showModal(opts) {
    modals.push({ title: opts.title, content: opts.content, confirmText: opts.confirmText });
    const next = modalScript.length ? modalScript.shift() : { confirm: false };
    setTimeout(() => opts.success && opts.success(next), 0);
  },
  showToast(opts) {
    toasts.push(opts.title);
  },
  showLoading() {},
  hideLoading() {},
  getStorageSync: () => '',
  setStorageSync() {},
  removeStorageSync() {},
};
global.wx = wxShim;

let reprocessPosts = [];
const fakeApi = {
  put(p, body) {
    if (p.includes('/meta')) {
      return Promise.resolve({ type: body.type, note: body.note || '' });
    }
    return Promise.resolve({});
  },
  post(p) {
    if (p.includes('/reprocess')) {
      reprocessPosts.push(p);
      return Promise.resolve({ suspiciousPoints: 3 });
    }
    return Promise.resolve({});
  },
  get() {
    return Promise.resolve({});
  },
};
const apiPath = require.resolve('../miniprogram/services/api.js');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeApi, children: [], paths: [] };

global.getApp = () => ({ globalData: { userInfo: { id: 'u1' } } });

let pageOpts = null;
global.Page = (o) => {
  pageOpts = o;
};

require('../miniprogram/pages/track-detail/track-detail.js');

/** 用页面 options 拼一个可调用方法的实例（Page 方法在顶层；setData 直接写 data） */
function makeInstance() {
  const data = JSON.parse(JSON.stringify(pageOpts.data || {}));
  const inst = {
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  Object.assign(inst, pageOpts);
  inst.data = data;
  return inst;
}

function freshInstance() {
  reprocessPosts = [];
  modals.length = 0;
  modalScript = [];
  toasts.length = 0;
  const inst = makeInstance();
  inst.data.id = 'act1';
  inst.data.activity = { type: 'walking', label: '徒步', note: '', corrected: true };
  inst.data.editType = 'walking';
  inst.data.editNote = '';
  inst.data.editSaving = false;
  inst.loadDetailCalls = 0;
  inst.loadDetail = function () {
    this.loadDetailCalls += 1;
    return Promise.resolve();
  };
  return inst;
}

test('RT1 换类型：整页重拉 + 弹引导窗，确认后跳过二次确认直接纠偏', async () => {
  const inst = freshInstance();
  inst.data.editType = 'cycling'; // walking → cycling
  modalScript = [{ confirm: true }]; // 引导弹窗点「去纠偏」
  await inst.saveEdit();
  await new Promise((r) => setTimeout(r, 0)); // reprocessTrack 异步收尾

  assert.equal(reprocessPosts.length, 1, '确认后应直接执行纠偏（一次）');
  assert.ok(reprocessPosts[0].includes('/reprocess'));
  assert.equal(modals.length, 1, '只应有引导弹窗（纠偏自身的二次确认被跳过）');
  assert.equal(modals[0].title, '类型已变更');
  assert.match(modals[0].content, /骑行/);
  assert.equal(inst.loadDetailCalls >= 1, true, '换类型后应整页重拉');
  assert.equal(inst.data.editVisible, false);
});

test('RT2 换类型但引导窗点「暂不」：不纠偏', async () => {
  const inst = freshInstance();
  inst.data.editType = 'cycling';
  modalScript = [{ confirm: false }];
  await inst.saveEdit();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(reprocessPosts.length, 0, '暂不应不执行纠偏');
  assert.equal(modals.length, 1);
});

test('RT3 仅改备注：不弹引导、不重拉，toast 已保存', async () => {
  const inst = freshInstance();
  inst.data.editNote = '新备注';
  await inst.saveEdit();
  assert.equal(modals.length, 0, '备注改动不该弹引导');
  assert.equal(reprocessPosts.length, 0);
  assert.equal(inst.loadDetailCalls, 0, '备注不改口径，无需重拉');
  assert.deepEqual(toasts, ['已保存']);
});

test('RT4 纠偏按钮 bindtap 直调：事件对象不等于 skipConfirm（回归）', async () => {
  const inst = freshInstance();
  const fakeEvent = { type: 'tap' }; // bindtap 会把事件对象当首参传入
  modalScript = [{ confirm: true }];
  const p = inst.reprocessTrack(fakeEvent);
  await new Promise((r) => setTimeout(r, 0));
  await p;
  // 事件对象是真值但不能跳过确认：弹了确认窗（用户点了确认）→ 执行一次纠偏
  assert.equal(reprocessPosts.length, 1, '事件对象不能被当成 skipConfirm');
});
