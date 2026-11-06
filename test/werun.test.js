/**
 * 微信运动步数同步链路（utils/werun.js）单测。
 * wx 全部走桩：隐私/授权/取数三道闸门的放行与拦截、409 重试、并发去重都在这里钉住。
 * 运行：npm test；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const api = require('../miniprogram/services/api');
const { syncWeRunSteps } = require('../miniprogram/utils/werun.js');

/* ---------------------------------- 环境桩 ---------------------------------- */

/** 每个用例重建一份 wx 桩与计数器；默认全链路放行（已同意隐私、已授权） */
function scenario(overrides = {}, extra = {}) {
  const calls = { login: 0, getWeRunData: 0, authorize: 0, requirePrivacy: 0, post: 0 };
  const wx = {
    getPrivacySetting: (o) => o.success({ needAuthorization: false }),
    requirePrivacyAuthorize: (o) => {
      calls.requirePrivacy++;
      (overrides.privacyDenied ? o.fail : o.success)({});
    },
    getSetting: (o) =>
      o.success({ authSetting: overrides.scopeState === undefined ? {} : { 'scope.werun': overrides.scopeState } }),
    authorize: (o) => {
      calls.authorize++;
      (overrides.authorizeDenied ? o.fail : o.success)({});
    },
    login: (o) => {
      calls.login++;
      o.success({ code: `code-${calls.login}` });
    },
    getWeRunData: (o) => {
      calls.getWeRunData++;
      if (overrides.werunDisabled) return o.fail({ errMsg: 'getWeRunData:fail no data' });
      o.success({ encryptedData: 'ENC', iv: 'IV' });
    },
  };
  global.wx = wx;
  current = { calls, ...extra };
  return current;
}

let current;
const posted = [];

// 默认上报桩：记录请求并成功返回；各用例可覆写
api.post = async (url, data) => {
  current.calls.post++;
  posted.push({ url, data });
  if (current.failFirstPost && current.calls.post === 1) {
    const err = new Error('步数解密失败，登录态已过期，请重试');
    err.statusCode = 409;
    throw err;
  }
  return { syncedDays: 2, days: [] };
};

test('WR-F1 静默模式（默认）：未授权直接返回 scope，不碰 login/取数/上报', async () => {
  scenario({ scopeState: undefined });
  const r = await syncWeRunSteps();
  assert.deepEqual(r, { ok: false, reason: 'scope' });
  assert.equal(current.calls.login, 0);
  assert.equal(current.calls.getWeRunData, 0);
  assert.equal(current.calls.post, 0);
});

test('WR-F2 已授权：全链路走通，code/encryptedData/iv 原样上报', async () => {
  scenario({ scopeState: true });
  posted.length = 0;
  const r = await syncWeRunSteps();
  assert.equal(r.ok, true);
  assert.equal(r.syncedDays, 2);
  assert.equal(current.calls.post, 1);
  assert.deepEqual(posted.at(-1), {
    url: '/werun/sync',
    data: { code: 'code-1', encryptedData: 'ENC', iv: 'IV' },
  });
});

test('WR-F3 requestAuth=true：没问过授权 → authorize 放行后继续；拒绝 → denied', async () => {
  scenario({ scopeState: undefined });
  const ok = await syncWeRunSteps({ requestAuth: true });
  assert.equal(ok.ok, true, 'authorize 成功应继续走完');
  assert.equal(current.calls.authorize, 1);

  scenario({ scopeState: undefined, authorizeDenied: true });
  const denied = await syncWeRunSteps({ requestAuth: true });
  assert.deepEqual(denied, { ok: false, reason: 'denied' });
  assert.equal(current.calls.login, 0, '授权被拒不应取数');
});

test('WR-F4 隐私闸门：need 且不允许弹窗 → privacy；同意后继续；拒绝 → privacy-denied', async () => {
  scenario();
  global.wx.getPrivacySetting = (o) => o.success({ needAuthorization: true });
  const r1 = await syncWeRunSteps();
  assert.deepEqual(r1, { ok: false, reason: 'privacy' });

  scenario();
  global.wx.getPrivacySetting = (o) => o.success({ needAuthorization: true });
  const r2 = await syncWeRunSteps({ requestAuth: true });
  assert.equal(r2.ok, true, '同意隐私后应继续走完');
  assert.equal(current.calls.requirePrivacy, 1);

  scenario({ privacyDenied: true });
  global.wx.getPrivacySetting = (o) => o.success({ needAuthorization: true });
  const r3 = await syncWeRunSteps({ requestAuth: true });
  assert.deepEqual(r3, { ok: false, reason: 'privacy-denied' });
});

test('WR-F5 解密失败（409）：自动换新 code 重试一趟，两次 login', async () => {
  scenario({ scopeState: true }, { failFirstPost: true });
  posted.length = 0;
  const r = await syncWeRunSteps();
  assert.equal(r.ok, true, '重试应成功');
  assert.equal(current.calls.login, 2, '重试必须重新 wx.login 拿新 code');
  assert.equal(current.calls.post, 2);
  assert.notEqual(posted[0].data.code, posted[1].data.code, '两趟 code 必须不同');
});

test('WR-F6 重试仍失败：failed 收口，不无限重试', async () => {
  scenario({ scopeState: true });
  api.post = async () => {
    current.calls.post++;
    const err = new Error('步数解密失败');
    err.statusCode = 409;
    throw err;
  };
  const r = await syncWeRunSteps();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'failed');
  assert.equal(current.calls.post, 2, '最多两趟');
});

test('WR-F7 微信运动未开启：disabled 收口，不重试不上报', async () => {
  scenario({ scopeState: true, werunDisabled: true });
  const r = await syncWeRunSteps();
  assert.deepEqual(r, { ok: false, reason: 'disabled' });
  assert.equal(current.calls.post, 0);
});

test('WR-F8 并发去重：in-flight 时第二趟 busy，释放后恢复', async () => {
  scenario({ scopeState: true });
  let release;
  api.post = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const first = syncWeRunSteps();
  // 等第一趟真正走到上报桩（异步链有多跳，轮询到 release 被赋值为止）
  while (!release) await new Promise((r) => setImmediate(r));
  const second = await syncWeRunSteps();
  assert.deepEqual(second, { ok: false, reason: 'busy' });
  release({ syncedDays: 0, days: [] });
  const r1 = await first;
  assert.equal(r1.ok, true);

  api.post = async () => ({ syncedDays: 0, days: [] });
  const third = await syncWeRunSteps();
  assert.equal(third.ok, true, '释放后可再次同步');
});
