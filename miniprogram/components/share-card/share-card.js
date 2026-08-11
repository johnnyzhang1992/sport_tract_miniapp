/**
 * share-card 分享海报组件（决策 F21/F22）
 * - Canvas 2D 绘制：背景 + 轨迹线（经纬度投影）+ 指标文字 + 小程序码
 * - 保存相册（wx.saveImageToPhotosAlbum，含权限引导）
 * props: activityId, activity(指标), mapPoints, miniCodeUrl
 * 方法: generate() —— 拉取小程序码 → 绘制 → 保存
 */
const api = require('../../services/api');

Component({
  properties: {
    activityId: { type: String, value: '' },
    /** {label, distanceKm, durationText, paceText, calories, startTimeText} */
    activity: { type: Object, value: null },
    mapPoints: { type: Array, value: [] },
    /** 小程序码 URL（可预先传入，避免重复请求） */
    miniCodeUrl: { type: String, value: '' },
  },

  methods: {
    /** 生成并保存海报 */
    async generate() {
      wx.showLoading({ title: '生成海报…' });
      try {
        let codeUrl = this.data.miniCodeUrl;
        // 没有小程序码则请求（失败不阻塞海报生成）
        if (!codeUrl && this.data.activityId) {
          try {
            const res = await api.post('/share/mini-code', { activityId: this.data.activityId });
            codeUrl = res.url || '';
          } catch {
            codeUrl = '';
          }
        }

        await this.drawPoster(codeUrl);
        wx.hideLoading();
        await this.saveToAlbum();
      } catch (e) {
        wx.hideLoading();
        wx.showToast({ title: '海报生成失败', icon: 'none' });
        console.error('[share-card]', e);
      }
    },

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
            this._canvasNode = canvas; // Canvas 2D 需节点引用
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

            // 轨迹线（投影到画布中部的白卡区域）
            this.drawTrack(ctx, width, height);

            // 指标
            this.drawMetrics(ctx, width, height, act);

            // 小程序码（右下角）
            if (codeUrl) {
              this.drawCode(ctx, codeUrl, width, height)
                .then(resolve)
                .catch(resolve); // 码加载失败不阻塞
            } else {
              resolve();
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

      // 白卡
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      const card = { x: pad / 2, y: top, w: width - pad, h: bottom - top };
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(card.x, card.y, card.w, card.h, 16) : ctx.rect(card.x, card.y, card.w, card.h);
      ctx.fill();

      // 轨迹线
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

      // 起点终点
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

    /** 保存到相册（含权限引导） */
    saveToAlbum() {
      return new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({
          canvas: this._canvasNode,
          success: (res) => {
            wx.saveImageToPhotosAlbum({
              filePath: res.tempFilePath,
              success: () => {
                wx.showToast({ title: '已保存到相册', icon: 'success' });
                resolve();
              },
              fail: (e) => this.handleAlbumFail(e, resolve, reject),
            });
          },
          fail: reject,
        });
      });
    },

    handleAlbumFail(e, resolve, reject) {
      if (String(e.errMsg || '').includes('auth deny') || String(e.errMsg || '').includes('authorize')) {
        wx.showModal({
          title: '需要相册权限',
          content: '请允许保存图片到相册',
          confirmText: '去设置',
          success: (r) => {
            if (r.confirm) wx.openSetting();
            reject(e);
          },
        });
      } else {
        wx.showToast({ title: '保存失败', icon: 'none' });
        reject(e);
      }
    },
  },
});
