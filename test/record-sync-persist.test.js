/**
 * 未上传轨迹点的落盘与捡回（决策 D13 的缺角）。
 *
 * 改之前的现状：
 * - sync.pending 是内存级，且每轮失败都把「seq > 水位」的同一批点再 concat 一遍（水位只在成功时前进），
 *   队列按失败轮次平方级增长；单点 JSON 实测约 112B，连续失败 ~45 分钟包体就顶穿后端 4MB bodyLimit
 *   （app.ts bodyLimit），而 413 不是 409 → 客户端继续排队继续变大，服务恢复了也永远传不上去。
 * - 录制页销毁/杀进程时 onUnload 只存 ongoingActivity 元数据，没传的整段尾巴随内存一起消失；
 *   恢复时 tracker 用服务端点重建、水位直接取 tracker.seq（record.js resume），等于宣布"都传完了"。
 *   更硬的一刀：finish 是「以客户端 final 包为准，全量替换 trackPoints」（api activity.ts），
 *   所以哪怕把点传到服务端过，只要 final 包里缺，结束时照样被抹掉。
 * 改之后：唯一真源是 tracker 里 seq > lastUploadedSeq 的未传尾部，落盘它、恢复时按 seq 归并回轨迹。
 * 跑法：node --test test/record-sync-persist.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const storage = {};
const wxCalls = [];
global.wx = {
  getStorageSync: (k) => storage[k] ?? '',
  setStorageSync: (k, v) => {
    storage[k] = v;
    wxCalls.push(['setStorageSync', k]);
  },
  removeStorageSync: (k) => {
    delete storage[k];
    wxCalls.push(['removeStorageSync', k]);
  },
  showToast() {},
  showLoading() {},
  hideLoading() {},
  stopLocationUpdate() {},
  setKeepScreenOn() {},
  navigateTo() {},
  redirectTo() {},
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

const apiStub = { get: null, post: null, put: null };
require.cache[require.resolve('../miniprogram/services/api.js')] = {
  id: require.resolve('../miniprogram/services/api.js'),
  filename: require.resolve('../miniprogram/services/api.js'),
  loaded: true,
  exports: {
    get: (url) => apiStub.get(url),
    post: (url, body) => apiStub.post(url, body),
    put: (url, body) => apiStub.put(url, body),
  },
  children: [],
  paths: [],
};

const config = require('../miniprogram/config/index');
const { SyncService } = require('../miniprogram/services/sync.js');
const { Tracker } = require('../miniprogram/services/tracker.js');
require('../miniprogram/pages/record/record.js');

const httpError = (statusCode, message) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

const BASE = 1700000000000;
const pt = (seq) => ({
  seq,
  lat: 31.2 + seq / 10000,
  lng: 121.4 + seq / 10000,
  altitude: 5,
  speed: 3,
  timestamp: BASE + seq * 3000,
});
/** sync 只看 tracker 的 getNewPoints（取 seq > 水位的点） */
const fakeTracker = (seqs) => ({ getNewPoints: (from) => seqs.filter((s) => s > (from || 0)).map(pt) });
const seqsOf = (arr) => (arr || []).map((p) => p.seq);

const reset = () => {
  for (const k of Object.keys(storage)) delete storage[k];
  wxCalls.length = 0;
};

// ---------- SyncService：落盘/清盘 ----------

test('P1 上传失败（断网或后端 5xx）：未传尾部落进 storage，杀进程后捡得回', async () => {
  reset();
  const s = new SyncService();
  s.activityId = 'aid';
  s.tracker = fakeTracker([1, 2, 3]);
  s.lastUploadedSeq = 0;
  apiStub.post = async () => {
    throw httpError(0, '网络不给力');
  };

  await s.upload();

  const raw = storage.syncPending;
  assert.ok(raw, '失败后要把未传点落盘，否则进程一没就找不回来');
  assert.equal(raw.activityId, 'aid', '要带活动 id：换场次时得认得出这不是这一场的队列');
  assert.equal(raw.lastUploadedSeq, 0, '水位要一起存，恢复后才知道从哪继续补');
  assert.deepEqual(seqsOf(raw.points), [1, 2, 3]);
});

test('P2 连续失败 3 轮：请求体与落盘队列都是"当前未传尾部"，旧点不重复入队', async () => {
  reset();
  const bodies = [];
  const seqs = [1, 2];
  const s = new SyncService();
  s.activityId = 'aid';
  s.lastUploadedSeq = 0;
  s.tracker = fakeTracker(seqs);
  apiStub.post = async (url, body) => {
    bodies.push(seqsOf(body.points));
    throw httpError(0, '网络不给力');
  };

  await s.upload();
  seqs.push(3);
  await s.upload();
  seqs.push(4);
  await s.upload();

  assert.deepEqual(bodies, [[1, 2], [1, 2, 3], [1, 2, 3, 4]], '每轮就是当时的尾部');
  for (const b of bodies) {
    assert.equal(new Set(b).size, b.length, `包体里不能出现重复 seq，实际「${b.join(',')}」`);
  }
  assert.deepEqual(seqsOf(storage.syncPending.points), [1, 2, 3, 4], '落盘的也该是去重后的尾部');
});

test('P3 上传成功：水位前进后只留真没传上去的，传完就清盘', async () => {
  reset();
  storage.syncPending = { activityId: 'aid', lastUploadedSeq: 0, points: [pt(1), pt(2), pt(3)] };
  const s = new SyncService();
  s.activityId = 'aid';
  s.tracker = fakeTracker([1, 2, 3]);
  s.lastUploadedSeq = 0;
  apiStub.post = async () => ({ lastPointSeq: 2 });

  await s.upload();

  assert.equal(s.lastUploadedSeq, 2);
  assert.deepEqual(seqsOf(storage.syncPending.points), [3], '服务端只收到 1、2，残尾 3 还得留着');
  assert.equal(storage.syncPending.lastUploadedSeq, 2);

  apiStub.post = async () => ({ lastPointSeq: 3 });
  await s.upload();

  assert.ok(!storage.syncPending, '全传上去了就该清盘，别占着 storage');
});

test('P4 409（这场已被服务端收尾）：停轮询并把落盘队列一起清掉', async () => {
  reset();
  storage.syncPending = { activityId: 'aid', lastUploadedSeq: 0, points: [pt(1)] };
  const s = new SyncService({ onSyncKilled() {} });
  s.activityId = 'aid';
  s.tracker = fakeTracker([1]);
  s.lastUploadedSeq = 0;
  s.timer = setInterval(() => {}, 1000);
  apiStub.post = async () => {
    throw httpError(409, '这条运动已结束，本次 1 个点不再入库');
  };

  try {
    await s.upload();
    assert.equal(s.timer, null, '上传定时器应已停');
    assert.ok(!storage.syncPending, '被踢之后这场没有出路，留着队列只会写进去又没人读');
  } finally {
    if (s.timer) clearInterval(s.timer);
  }
});

test('P5 finish 成功（点已随 final 包整包对账）：清掉落盘队列', async () => {
  reset();
  storage.syncPending = { activityId: 'aid', lastUploadedSeq: 0, points: [pt(1)] };
  const s = new SyncService();
  s.activityId = 'aid';
  apiStub.put = async () => ({ status: 'finished' });

  await s.finish({ trackPoints: [pt(1)] });

  assert.ok(!storage.syncPending, 'final 包已含全量点，增量队列不再有意义');
});

test('P6 cancel（放弃/重新开始）：同样清盘', async () => {
  reset();
  storage.syncPending = { activityId: 'aid', lastUploadedSeq: 0, points: [pt(1)] };
  const s = new SyncService();
  s.activityId = 'aid';
  apiStub.put = async () => ({});

  await s.cancel();

  assert.ok(!storage.syncPending);
});

test('P7 cancel 失败（接口还挂着）：不清盘，现场留给下一轮', async () => {
  reset();
  storage.syncPending = { activityId: 'aid', lastUploadedSeq: 0, points: [pt(1)] };
  const s = new SyncService();
  s.activityId = 'aid';
  apiStub.put = async () => {
    throw httpError(0, '网络不给力');
  };

  await s.cancel().catch(() => {});

  assert.deepEqual(seqsOf(storage.syncPending && storage.syncPending.points), [pt(1).seq], '取消没成功就别把队列删了');
});

test('P8 未传尾部超上限：只落最近 PERSIST_MAX_POINTS 个', async () => {
  reset();
  const cap = config.SYNC.PERSIST_MAX_POINTS;
  const seqs = Array.from({ length: cap + 2 }, (_, i) => i + 1);
  const s = new SyncService();
  s.activityId = 'aid';
  s.tracker = fakeTracker(seqs);
  s.lastUploadedSeq = 0;
  apiStub.post = async () => {
    throw httpError(0, '网络不给力');
  };

  await s.upload();

  const raw = storage.syncPending;
  assert.equal(raw.points.length, cap, `单个 key 超 1MB 会直接写失败（单点约 112B，上限就是为这个卡的）`);
  assert.equal(raw.points[raw.points.length - 1].seq, cap + 2, '留最近的：丢最老几个点总好过整包写不进去');
});

test('P14 storage 写失败（配额满）：只少一份备份，不能把重试链打断', async () => {
  reset();
  const origSet = wx.setStorageSync;
  wx.setStorageSync = () => {
    throw new Error('exceed storage limit');
  };
  const sent = [];
  const s = new SyncService();
  s.activityId = 'aid';
  s.tracker = fakeTracker([1]);
  s.lastUploadedSeq = 0;
  apiStub.post = async (url, body) => {
    sent.push(seqsOf(body.points));
    if (sent.length === 1) throw httpError(0, '网络不给力');
    return { lastPointSeq: 1 };
  };

  try {
    await s.upload();
    await s.upload();
  } finally {
    wx.setStorageSync = origSet;
  }

  assert.deepEqual(sent, [[1], [1]], '第一轮失败后定时器还得照常跑，第二轮要把点传上去');
  assert.equal(s.lastUploadedSeq, 1);
});

// ---------- record.resume：捡回 ----------

/** 走真实 resume()：服务端点集 + 可选的落盘队列 */
const resumeFrom = async ({ serverSeqs, persisted }) => {
  reset();
  if (persisted) storage.syncPending = persisted;
  const startTime = BASE;
  storage.ongoingActivity = {
    activityId: 'aid',
    type: 'running',
    startTime,
    pausedAt: BASE + serverSeqs[serverSeqs.length - 1] * 3000,
    pausedMs: 0,
  };
  apiStub.get = () =>
    Promise.resolve({
      _id: 'aid',
      status: 'in_progress',
      startTime,
      pausedMs: 0,
      trackPoints: serverSeqs.map(pt),
      markers: [],
    });
  const ctx = Object.create(page);
  Object.assign(ctx, {
    data: { type: 'running', paused: false, starting: true, stats: { altitude: 0 } },
    statsTimer: null,
    setData(patch) {
      Object.assign(this.data, patch);
    },
    startLocation() {},
    maybeShowCapsuleGuide() {},
  });
  await page.resume.call(ctx, 'aid', 'running');
  return ctx;
};

/** resume() 会起两个真定时器，断言失败也必须收掉，否则 node --test 不退出 */
const withResume = async (opts, fn) => {
  const ctx = await resumeFrom(opts);
  try {
    await fn(ctx);
  } finally {
    if (ctx.statsTimer) clearInterval(ctx.statsTimer);
    if (ctx.sync) ctx.sync.stop();
  }
};

test('P9 恢复现场：落盘里服务端没有的点按 seq 归并回轨迹，水位取落盘值以便真补传', async () => {
  await withResume(
    {
      serverSeqs: [1, 2, 5],
      persisted: { activityId: 'aid', lastUploadedSeq: 2, points: [pt(3), pt(4)] },
    },
    (ctx) => {
      assert.deepEqual(seqsOf(ctx.tracker.points), [1, 2, 3, 4, 5], '要按 seq 归并排序，不能直接接在已有尾巴后面');
      assert.equal(
        ctx.sync.lastUploadedSeq,
        2,
        '取落盘水位而不是 tracker 最大 seq：这批点服务端没有，下一轮定时器要真把它补传上去，而不是等结束那次 final 包',
      );
      // mapPoints 只带渲染字段（lat/lng/pauseGap），用 pt() 的 lat 编码反推 seq 顺序
      assert.deepEqual(
        ctx.data.mapPoints.map((p) => Math.round((p.lat - 31.2) * 10000)),
        [1, 2, 3, 4, 5],
        '地图上也得有，不然捡回数据了线还是断的',
      );
    },
  );
});

test('P10 没有落盘队列：恢复行为与从前一致（水位=服务端最大 seq，不重发）', async () => {
  await withResume({ serverSeqs: [1, 2, 3] }, (ctx) => {
    assert.deepEqual(seqsOf(ctx.tracker.points), [1, 2, 3]);
    assert.equal(ctx.sync.lastUploadedSeq, 3, '钉住现状：没落盘就照旧认服务端为准');
  });
});

test('P11 落盘属于别的活动：不采纳（否则会把上一场没传的点接进这一场）', async () => {
  await withResume(
    {
      serverSeqs: [1, 2, 3],
      persisted: { activityId: 'other-aid', lastUploadedSeq: 0, points: [pt(9), pt(10)] },
    },
    (ctx) => {
      assert.deepEqual(seqsOf(ctx.tracker.points), [1, 2, 3], '别的活动的点一颗都不能进');
      assert.equal(ctx.sync.lastUploadedSeq, 3);
    },
  );
});

test('P12 落盘点里有 seq 已在服务端（响应丢了但服务端已入库）：不重复插进轨迹', async () => {
  await withResume(
    {
      serverSeqs: [1, 2, 3],
      persisted: { activityId: 'aid', lastUploadedSeq: 1, points: [pt(2), pt(3), pt(4)] },
    },
    (ctx) => {
      assert.deepEqual(seqsOf(ctx.tracker.points), [1, 2, 3, 4], '2、3 服务端已有，不能再插一遍（距离会翻倍）');
      assert.equal(ctx.sync.lastUploadedSeq, 1, '水位仍取落盘值：重发的 2、3 由服务端按库里已有 seq 去重');
    },
  );
});

// ---------- 退出录制页 ----------

test('P13 退出录制页：最后一次上传之后采的点也落盘，不然杀进程照样丢', () => {
  reset();
  const tracker = new Tracker('running', 60);
  tracker.restoreFromPoints([pt(1), pt(2), pt(3)], [], BASE, 0, 0);
  const sync = new SyncService();
  sync.activityId = 'aid';
  sync.tracker = tracker;
  sync.lastUploadedSeq = 1; // 只有 seq 1 真传上去了
  const ctx = {
    data: { type: 'running' },
    tracker,
    sync,
    statsTimer: null,
    _ending: false,
    _canceled: false,
    _killed: false,
    setData() {},
  };

  page.onUnload.call(ctx);

  assert.deepEqual(seqsOf(storage.syncPending.points), [2, 3], '2、3 从没上传成功过，退出前必须落盘');
  assert.ok(storage.ongoingActivity, '原有的进行中现场照旧要存');
});
