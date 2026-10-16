/**
 * 增量上传同步（决策 D13：运动中每 30s 批量上传 + 崩溃/杀进程后从 storage 捡回未传的点）
 * 服务端按 seq 幂等去重（sport_track_api POST /activities/:id/points）
 */
const api = require('./api');
const config = require('../config/index');

/** 未传尾部的落盘位（单 key 覆盖式写：一场只有一份，读回来时靠里面的 activityId 认场） */
const PENDING_KEY = 'syncPending';

class SyncService {
  /** @param {object} [page] 宿主页面：被服务端判定"这场已在别处结束"时要把整句文案交给页面显示 */
  constructor(page) {
    this.page = page || null;
    this.activityId = null;
    this.tracker = null;
    this.lastUploadedSeq = 0;
    this.timer = null;
    this.uploading = false;
  }

  /** 落盘的未传尾部；不属于这一场（或没有）时返回 null */
  static readPersisted(activityId) {
    const raw = wx.getStorageSync(PENDING_KEY);
    if (!raw || raw.activityId !== activityId) return null;
    return raw;
  }

  static clearPersisted() {
    wx.removeStorageSync(PENDING_KEY);
  }

  /**
   * 待传集合的唯一真源：本地采到、服务端还没收到的点。
   * 不再另存一份内存队列 —— 水位只在成功时前进，队列每轮失败都会把这批点再抄一遍，
   * 包体按失败轮次平方级增长，约 45 分钟就顶穿后端 4MB bodyLimit，而 413 不是 409，
   * 于是"服务恢复了也永远传不上去"。
   */
  unsentPoints() {
    return this.tracker ? this.tracker.getNewPoints(this.lastUploadedSeq) : [];
  }

  /**
   * 未传尾部落盘：点在内存里，录制页销毁/进程被杀就没了；而 finish 是"以客户端 final 包为准
   * 全量替换 trackPoints"，没并进 final 包的那段恢复时整段蒸发，所以先自己留一份。
   * 超上限只留最近的：单个 key 写超 1MB 会直接失败，整包丢不如丢最老的几颗。
   */
  persist() {
    if (!this.activityId) return;
    const points = this.unsentPoints();
    if (points.length === 0) {
      SyncService.clearPersisted();
      return;
    }
    const cap = config.SYNC.PERSIST_MAX_POINTS;
    try {
      wx.setStorageSync(PENDING_KEY, {
        activityId: this.activityId,
        lastUploadedSeq: this.lastUploadedSeq,
        points: points.length > cap ? points.slice(-cap) : points,
      });
    } catch (e) {
      // 存储配额不足等：内存里的点照旧走定时器，结束时 final 包仍能兜底，不能把重试链打断
      console.warn('[sync] 未传尾部落盘失败', e && e.message);
    }
  }

  /** 创建进行中活动，返回 activityId */
  async createActivity(type, startTime) {
    const data = await api.post('/activities', { type, startTime });
    this.activityId = data.activityId;
    return this.activityId;
  }

  /** 绑定记录器并启动定时上传 */
  start(tracker) {
    this.tracker = tracker;
    this.timer = setInterval(() => this.upload(), config.SYNC.UPLOAD_INTERVAL);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 增量上传：未传尾部 → 服务端幂等去重 */
  async upload() {
    if (!this.activityId || !this.tracker || this.uploading) return;
    this.uploading = true;
    try {
      const points = this.unsentPoints();
      if (points.length === 0) return;

      const res = await api.post(`/activities/${this.activityId}/points`, {
        fromSeq: this.lastUploadedSeq,
        points,
      });
      this.lastUploadedSeq = res.lastPointSeq;
      this.persist(); // 水位前进了：落盘只剩真没传上去的，传完就清盘
    } catch (e) {
      // 409：活动已结束/被服务端作废（如 24h 惰性清理）→ 永久性错误，停止上传，避免无限重试
      if (e.statusCode === 409) {
        this.stop();
        SyncService.clearPersisted();
        console.warn('[sync] 活动已结束/作废，停止同步', e.message);
        // 只 console 的话页面还在计时计距，用户完全看不出已经停了
        if (this.page && typeof this.page.onSyncKilled === 'function') {
          this.page.onSyncKilled(e.message || '');
        }
        return;
      }
      // 断网/服务异常（5xx、超时都算）：落盘当前未传尾部，下一轮定时器照原样重试
      this.persist();
      console.warn('[sync] 增量上传失败，未传尾部已落盘', e.message);
    } finally {
      this.uploading = false;
    }
  }

  /** 运动中打点（实时上报；失败进待同步？打点少，直接重试提示） */
  async addMarker(marker) {
    await api.post(`/activities/${this.activityId}/markers`, marker);
  }

  /** 结束：提交 final 包对账（决策 D13：以 final 包为准）
   *  返回 { status, lastPointSeq, activity, reason? }；距离过短时 status='cancelled'、reason='DISTANCE_TOO_SHORT' */
  async finish(finalPack) {
    const res = await api.put(`/activities/${this.activityId}/finish`, finalPack);
    // final 包已带全量 trackPoints（服务端整包替换），增量队列到这儿没有下一步
    SyncService.clearPersisted();
    return res;
  }

  /** 放弃：取消活动 */
  async cancel() {
    if (this.activityId) {
      await api.put(`/activities/${this.activityId}/cancel`, {});
      SyncService.clearPersisted();
    }
  }
}

module.exports = { SyncService };
