/**
 * share-card 分享海报组件（决策 F21/F22）
 * - 点击「分享海报」→ 生成海报 → 预览弹窗展示 → 用户选择「保存到相册」或「取消」
 * - 不再点击立即导出
 * props: activityId, activity(指标), mapPoints, miniCodeUrl
 * 方法: preview() —— 拉小程序码 → 绘制 → 预览弹窗
 */
const api = require('../../services/api');

Component({
  properties: {
    activityId: { type: String, value: '' },
    activity: { type: Object, value: null },
    mapPoints: { type: Array, value: [] },
    miniCodeUrl: { type: String, value: '' },
  },

  data: {
    previewVisible: false,
    previewPath: '',
    saving: false,
  },

  methods: {
    /** 生成海报并展示预览弹窗 */
    async preview() {
      wx.showLoading({ title: '生成海报…' });
      try {
        let codeUrl = this.data.miniCodeUrl;
        if (!codeUrl && this.data.activityId) {
          try {
            const res = await api.post('/share/mini-code', { activityId: this.data.activityId });
            codeUrl = res.url || '';
          } catch {
            codeUrl = '';
          }
        }

        const tempPath = await this.drawPoster(codeUrl);
        wx.hideLoading();
        if (tempPath) {
          this.setData({ previewPath: tempPath, previewVisible: true });
          // 海报路径交给页面（分享卡片/朋友圈封面用）
          this.triggerEvent('posterready', { path: tempPath });
        } else {
          wx.showToast({ title: '海报生成失败', icon: 'none' });
        }
      } catch (e) {
        wx.hideLoading();
        wx.showToast({ title: '海报生成失败', icon: 'none' });
        console.error('[share-card]', e);
      }
    },

    /** 绘制海报 → 返回临时文件路径 */
    drawPoster(codeUrl) {
      return new Promise((resolve, reject) => {
        wx.createSelectorQuery()
          .in(this)
          .select('#posterCanvas')
          .fields({ node: true, size: true })
          .exec((res) => {
            if (!res || !res[0] || !res[0].node) {
              reject(new Error('canvas 不存在'));
              return;
            }
            const canvas = res[0].node;
            this._canvasNode = canvas;
            const { width, height } = res[0];
            const ctx = canvas.getContext('2d');
            const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2) || 2;
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, width, height);

            // 背景
            const bg = ctx.createLinearGradient(0, 0, 0, height);
            bg.addColorStop(0, '#2b6cf6');
            bg.addColorStop(1, '#1a4fd0');
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, width, height);

            // 标题
            const act = this.data.activity || {};
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 26px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`${act.label || '运动'} · ${act.distanceKm || '0.00'} 公里`, width / 2, 56);

            // 轨迹线
            this.drawTrack(ctx, width, height);
            // 指标
            this.drawMetrics(ctx, width, height, act);

            // 小程序码
            const finish = () => {
              // canvas → 临时文件
              wx.canvasToTempFilePath({
                canvas: this._canvasNode,
                success: (r) => resolve(r.tempFilePath),
                fail: reject,
              });
            };
            if (codeUrl) {
              this.drawCode(ctx, codeUrl, width, height).then(finish).catch(finish);
            } else {
              finish();
            }
          });
      });
    },

    drawTrack(ctx, width, height) {
      const pts = this.data.mapPoints || [];
      if (pts.length < 2) return;
      const pad = 40;
      const top = 90;
      const bottom = height - 130;
      const lats = pts.map((p) => p.lat);
      const lngs = pts.map((p) => p.lng);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      const spanLat = maxLat - minLat || 0.001;
      const spanLng = maxLng - minLng || 0.001;

      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      const card = { x: pad / 2, y: top, w: width - pad, h: bottom - top };
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(card.x, card.y, card.w, card.h, 16) : ctx.rect(card.x, card.y, card.w, card.h);
      ctx.fill();

      ctx.strokeStyle = '#ffd24d';
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach((p, i) => {
        const x = pad / 2 + ((p.lng - minLng) / spanLng) * (width - pad);
        const y = bottom - ((p.lat - minLat) / spanLat) * (bottom - top);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      const first = pts[0];
      const last = pts[pts.length - 1];
      const fX = pad / 2 + ((first.lng - minLng) / spanLng) * (width - pad);
      const fY = bottom - ((first.lat - minLat) / spanLat) * (bottom - top);
      const lX = pad / 2 + ((last.lng - minLng) / spanLng) * (width - pad);
      const lY = bottom - ((last.lat - minLat) / spanLat) * (bottom - top);
      ctx.fillStyle = '#fff';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('起', fX, fY - 8);
      ctx.fillText('终', lX, lY - 8);
    },

    drawMetrics(ctx, width, height, act) {
      const y = height - 90;
      ctx.fillStyle = '#fff';
      ctx.font = '15px sans-serif';
      ctx.textAlign = 'center';
      const items = [
        `时长 ${act.durationText || '—'}`,
        `配速 ${act.paceText || '—'}`,
        `消耗 ${act.calories || 0} kcal`,
      ];
      items.forEach((t, i) => {
        ctx.fillText(t, (width / items.length) * i + width / items.length / 2, y);
      });
      if (act.startTimeText) {
        ctx.font = '12px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillText(act.startTimeText, width / 2, height - 24);
      }
    },

    drawCode(ctx, codeUrl, width, height) {
      return new Promise((resolve) => {
        wx.getImageInfo({
          src: codeUrl,
          success: (img) => {
            const size = 110;
            const x = width - size - 24;
            const y = height - size - 40;
            ctx.fillStyle = '#fff';
            ctx.fillRect(x - 6, y - 6, size + 12, size + 12);
            ctx.drawImage(img.path, x, y, size, size);
            ctx.fillStyle = 'rgba(255,255,255,0.75)';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText('长按识别小程序', width - 20, y + size + 18);
            resolve();
          },
          fail: resolve,
        });
      });
    },

    /** 保存到相册（预览弹窗内操作） */
    save() {
      if (this.data.saving || !this.data.previewPath) return;
      this.setData({ saving: true });
      wx.saveImageToPhotosAlbum({
        filePath: this.data.previewPath,
        success: () => {
          this.setData({ previewVisible: false, saving: false });
          wx.showToast({ title: '已保存到相册', icon: 'success' });
        },
        fail: (e) => {
          this.setData({ saving: false });
          this.handleAlbumFail(e);
        },
      });
    },

    closePreview() {
      this.setData({ previewVisible: false });
    },

    handleAlbumFail(e) {
      if (String(e.errMsg || '').includes('auth deny') || String(e.errMsg || '').includes('authorize')) {
        wx.showModal({
          title: '需要相册权限',
          content: '请允许保存图片到相册',
          confirmText: '去设置',
          success: (r) => {
            if (r.confirm) wx.openSetting();
          },
        });
      } else {
        wx.showToast({ title: '保存失败', icon: 'none' });
      }
    },
  },
});
