/**
 * share-card 分享海报组件（决策 F21/F22）
 * - 点击「分享海报」→ 预览弹窗内 Canvas 绘制海报 → 保存到相册 / 分享给朋友
 * - canvas 放在预览弹窗内（可见区域），canvasToTempFilePath 转换可靠
 * props: activityId, activity(指标), mapPoints, miniCodeUrl
 * 方法: preview()；事件: posterready({ path }) 海报临时路径
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
    previewPath: '', // 海报临时文件（保存/分享用）
    saving: false,
  },

  methods: {
    /** 打开预览弹窗并绘制海报 */
    async preview() {
      this.setData({ previewVisible: true });
      wx.showLoading({ title: '生成海报…' });
      try {
        // 等弹窗渲染出 canvas
        await new Promise((r) => setTimeout(r, 150));

        let codeUrl = this.data.miniCodeUrl;
        if (!codeUrl && this.data.activityId) {
          try {
            const res = await api.post('/share/mini-code', { activityId: this.data.activityId });
            codeUrl = res.url || '';
          } catch {
            codeUrl = '';
          }
        }

        await this.drawPoster(codeUrl);
        // 转临时文件（保存/分享用）
        const path = await this.toTempFile();
        this.setData({ previewPath: path });
        this.triggerEvent('posterready', { path });
        wx.hideLoading();
      } catch (e) {
        wx.hideLoading();
        this.setData({ previewVisible: false });
        wx.showToast({ title: '海报生成失败', icon: 'none' });
        console.error('[share-card]', e);
      }
    },

    /** 绘制海报到预览弹窗内的 canvas */
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
            ctx.font = 'bold 24px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`${act.label || '运动'} · ${act.distanceKm || '0.00'} 公里`, width / 2, 44);

            // 轨迹线
            this.drawTrack(ctx, width, height);
            // 指标
            this.drawMetrics(ctx, width, height, act);

            const finish = () => resolve();
            if (codeUrl) {
              this.drawCode(ctx, codeUrl, width, height).then(finish).catch(finish);
            } else {
              finish();
            }
          });
      });
    },

    toTempFile() {
      return new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({
          canvas: this._canvasNode,
          success: (r) => resolve(r.tempFilePath),
          fail: reject,
        });
      });
    },

    drawTrack(ctx, width, height) {
      const pts = this.data.mapPoints || [];
      if (pts.length < 2) return;
      const pad = 30;
      const top = 70;
      const bottom = height - 120;
      const lats = pts.map((p) => p.lat);
      const lngs = pts.map((p) => p.lng);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      const spanLat = maxLat - minLat || 0.001;
      const spanLng = maxLng - minLng || 0.001;

      ctx.fillStyle = 'rgba(255,255,255,0.15)';
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
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('起', fX, fY - 6);
      ctx.fillText('终', lX, lY - 6);
    },

    drawMetrics(ctx, width, height, act) {
      const y = height - 82;
      ctx.fillStyle = '#fff';
      ctx.font = '14px sans-serif';
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
        ctx.font = '11px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillText(act.startTimeText, width / 2, height - 22);
      }
    },

    drawCode(ctx, codeUrl, width, height) {
      return new Promise((resolve) => {
        wx.getImageInfo({
          src: codeUrl,
          success: (img) => {
            const size = 90;
            const x = width - size - 20;
            const y = height - size - 36;
            ctx.fillStyle = '#fff';
            ctx.fillRect(x - 5, y - 5, size + 10, size + 10);
            ctx.drawImage(img.path, x, y, size, size);
            ctx.fillStyle = 'rgba(255,255,255,0.75)';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText('长按识别小程序', width - 16, y + size + 16);
            resolve();
          },
          fail: resolve,
        });
      });
    },

    /** 保存到相册 */
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
