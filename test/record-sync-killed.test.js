/**
 * 「被踢下线」时录入端的行为：服务端已把这条活动收尾/结束，这台设备的下一次上传撞 409。
 *
 * 场景：另一台设备点「开始」→ 服务端把这台正在录的活动自动收尾 → 这台上传拿 409。
 * 改之前只有 sync.stop() + console.warn：页面照常计时计距，用户以为一切正常，
 * 最后那次 final 包又被 finish 的幂等早退静默吞掉（activity.ts finish「重复 finish 直接返回」）。
 * 桩：services/api 用 require.cache 注入假实现；Page() 就地捕获定义（同 record-vehicle-toast 写法）。
 * 跑法：node --test test/record-sync-killed.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const storage = {};
const wxCalls = [];
global.wx = {
  getStorageSync: (k) => storage[k] ?? '',
  setStorageSync: (k, v) => {
    storage[k] = v;
  },
  removeStorageSync: (k) => {
    delete storage[k];
    wxCalls.push(['removeStorageSync', k]);
  },
  showToast(o) {
    wxCalls.push(['showToast', o]);
  },
  showLoading() {},
  hideLoading() {},
  stopLocationUpdate() {
    wxCalls.push(['stopLocationUpdate']);
  },
  setKeepScreenOn() {},
  navigateTo(o) {
    wxCalls.push(['navigateTo', o]);
  },
  redirectTo(o) {
    wxCalls.push(['redirectTo', o]);
  },
  navigateBack() {},
  vibrateShort() {},
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667 }),
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }),
  createMapContext: () => ({}),
};
global.getApp = () => ({ globalData: {}, hasSession: () => false });
let page = null;
global.Page = (o) => {
  page = o;
};

/** 假 api：upload/finish 的行为由每个用例现挂 */
const apiStub = { post: null, put: null, get: null };
require.cache[require.resolve('../miniprogram/services/api.js')] = {
  id: require.resolve('../miniprogram/services/api.js'),
  filename: require.resolve('../miniprogram/services/api.js'),
  loaded: true,
  exports: {
    post: (url, body) => apiStub.post(url, body),
    put: (url, body) => apiStub.put(url, body),
    get: (url) => apiStub.get(url),
  },
  children: [],
  paths: [],
};

const { SyncService } = require('../miniprogram/services/sync.js');
require('../miniprogram/pages/record/record.js');

/** httpError：模拟 utils/api 抛出的错误形状（Error + statusCode + 服务端 message） */
const httpError = (statusCode, message) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

const makeCtx = (over = {}) => {
  const ctx = {
    data: { type: 'running', killed: false, error: '', errorHint: '', stats: { altitude: 0 } },
    patches: [],
    tracker: { paused: false, pauseCalls: 0, onKilometer: null, onVehicle: null, points: [], activityId: 'aid' },
    sync: { activityId: 'aid', stopCalls: 0, stop() { this.stopCalls += 1; } },
    statsTimer: 1234,
    _ending: false,
    _canceled: false,
  };
  ctx.tracker.pause = () => {
    ctx.tracker.pauseCalls += 1;
    ctx.tracker.paused = true;
  };
  ctx.setData = (patch) => {
    ctx.patches.push(patch);
    Object.assign(ctx.data, patch);
  };
  return Object.assign(ctx, over);
};

const lastPatch = (ctx) => ctx.patches[ctx.patches.length - 1] || {};

test('K1 上传撞 409：除了停轮询，还要把服务端原文交给页面回调', async () => {
  const notices = [];
  const s = new SyncService({ onSyncKilled: (m) => notices.push(m) });
  s.activityId = 'aid';
  s.tracker = { getNewPoints: () => [{ seq: 7, lat: 31.23, lng: 121.47, timestamp: Date.now() }] };
  s.timer = setInterval(() => {}, 1000);
  apiStub.post = async () => {
    throw httpError(409, '这条运动已于 10-01 19:12:50 结束，本次 1 个点不再入库');
  };

  await s.upload();

  assert.deepEqual(notices, ['这条运动已于 10-01 19:12:50 结束，本次 1 个点不再入库'], '409 要把整句原文给出去，不要自己拼');
  assert.equal(s.timer, null, '上传定时器应已停');
  assert.equal(s.pending.length, 0, '被踢之后暂存队列不该留着重试');
  clearInterval(s.timer);
});

test('K2 断网（statusCode 0）不算被踢：点进待同步队列，不通知页面', async () => {
  const notices = [];
  const s = new SyncService({ onSyncKilled: (m) => notices.push(m) });
  s.activityId = 'aid';
  s.tracker = { getNewPoints: () => [{ seq: 8, lat: 31.23, lng: 121.47, timestamp: Date.now() }] };
  apiStub.post = async () => {
    throw httpError(0, '网络不给力');
  };

  await s.upload();

  assert.deepEqual(notices, [], '网络错误不是被踢');
  assert.equal(s.pending.length, 1, '点应留在待同步队列等补传');
});

test('K3 页面收到被踢：立刻停表停定位、清掉「继续上次运动」现场、显示服务端原文', () => {
  storage.ongoingActivity = { activityId: 'aid', type: 'running' };
  wxCalls.length = 0;
  const ctx = makeCtx();

  page.onSyncKilled.call(ctx, '这条运动已于 10-01 19:12:50 结束，本次 1 个点不再入库');

  const patch = lastPatch(ctx);
  assert.equal(patch.error, '这条运动已于 10-01 19:12:50 结束，本次 1 个点不再入库', '整句由服务端下发，页面不自己拼');
  assert.equal(patch.killed, true, '要进"已停止"态，不能再让计时器跑');
  assert.equal(ctx.tracker.pauseCalls, 1, '采集要暂停，否则还在往已经不存在的活动攒点');
  assert.equal(ctx.statsTimer, null, '计时刷新要停');
  assert.ok(!storage.ongoingActivity, '现场清掉，首页不该再给一个假的「继续上次运动」入口');
});

test('K4 被踢后离开页面：不再把这条写回「继续上次运动」', () => {
  delete storage.ongoingActivity;
  const ctx = makeCtx({ _killed: true });

  page.onUnload.call(ctx);

  assert.ok(!storage.ongoingActivity, '已收尾的活动不能再当成"进行中"存现场');
});

test('K5 被踢态下的出路：跳详情页看已保存的部分', () => {
  wxCalls.length = 0;
  const ctx = makeCtx({ _killed: true });

  page.viewSaved.call(ctx);

  const nav = wxCalls.find((c) => c[0] === 'redirectTo');
  assert.ok(nav, '应有一次 redirectTo（返回键不该再落回一个已停机的录像页）');
  assert.match(nav[1].url, /track-detail/, `要去详情页，实际「${nav[1].url}」`);
  assert.match(nav[1].url, /id=aid/, `要带上活动 id，实际「${nav[1].url}」`);
});
