/**
 * 增量上传同步（决策 D13：运动中每 30s 批量上传 + 断网本地暂存补传）
 * 服务端按 seq 幂等去重（sport_track_api POST /activities/:id/points）
 */
const api = require('./api');
const config = require('../config/index');

class SyncService {
  constructor() {
    this.activityId = null;
    this.tracker = null;
    this.lastUploadedSeq = 0;
    this.timer = null;
    /** 断网时暂存的待上传点（内存级；更严格可持久化到 storage） */
    this.pending = [];
    this.uploading = false;
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

  /** 立即补传一次（网络恢复/手动触发） */
  async flush() {
    return this.upload();
  }

  /** 增量上传：新点 + 待同步队列 → 服务端幂等去重 */
  async upload() {
    if (!this.activityId || !this.tracker || this.uploading) return;
    this.uploading = true;
    try {
      const newPoints = this.tracker.getNewPoints(this.lastUploadedSeq);
      const points = this.pending.concat(newPoints);
      if (points.length === 0) return;

      const res = await api.post(`/activities/${this.activityId}/points`, {
        fromSeq: this.lastUploadedSeq,
        points,
      });
      this.lastUploadedSeq = res.lastPointSeq;
      this.pending = [];
    } catch (e) {
      // 409：活动已结束/被服务端作废（如 24h 惰性清理）→ 永久性错误，停止上传，避免无限重试
      if (e.statusCode === 409) {
        this.stop();
        this.pending = [];
        console.warn('[sync] 活动已结束/作废，停止同步', e.message);
        return;
      }
      // 断网/服务异常：新点入待同步队列，下次补传
      const newPoints = this.tracker.getNewPoints(this.lastUploadedSeq);
      this.pending = this.pending.concat(newPoints);
      console.warn('[sync] 增量上传失败，已入待同步队列', e.message);
    } finally {
      this.uploading = false;
    }
  }

  /** 运动中打点（实时上报；失败进待同步？打点少，直接重试提示） */
  async addMarker(marker) {
    await api.post(`/activities/${this.activityId}/markers`, marker);
  }

  /** 结束：提交 final 包对账（决策 D13：以 final 包为准） */
  async finish(finalPack) {
    const res = await api.put(`/activities/${this.activityId}/finish`, finalPack);
    return res.activity;
  }

  /** 放弃：取消活动 */
  async cancel() {
    if (this.activityId) {
      await api.put(`/activities/${this.activityId}/cancel`, {});
    }
  }
}

module.exports = { SyncService };
