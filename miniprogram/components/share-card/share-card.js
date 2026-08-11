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
            ctx.fillText(`${act.label || '运动'} · ${act.distanceKm || '0.00'} 公里`, width / 2, 42);

            // 轨迹（大块完整展示）
            this.drawTrack(ctx, width, height);
            // 指标卡片（时长/配速/消耗 独立卡）
            this.drawStatsCards(ctx, width, height, act);

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
      // 轨迹区域：标题下到指标卡上方，尽量占满
      const pad = 24;
      const top = 62;
      const bottom = 232;
      const lats = pts.map((p) => p.lat);
      const lngs = pts.map((p) => p.lng);
      let minLat = Math.min(...lats);
      let maxLat = Math.max(...lats);
      let minLng = Math.min(...lngs);
      let maxLng = Math.max(...lngs);
      // 最小跨度保障：极短轨迹也铺满可视
      const spanLat = maxLat - minLat;
      const spanLng = maxLng - minLng;
      if (spanLat < 0.0005 && spanLng < 0.0005) {
        const c = 0.0015;
        minLat -= c; maxLat += c; minLng -= c; maxLng += c;
      }
      const sLat = maxLat - minLat || 0.001;
      const sLng = maxLng - minLng || 0.001;

      // 轨迹卡底
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      const card = { x: pad / 2, y: top, w: width - pad, h: bottom - top };
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(card.x, card.y, card.w, card.h, 16) : ctx.rect(card.x, card.y, card.w, card.h);
      ctx.fill();

      // 轨迹投影区：在卡片内部再内缩，保证线/端点/标签不溢出卡片
      const innerPad = 14;
      const plotLeft = card.x + innerPad;
      const plotRight = card.x + card.w - innerPad;
      const plotTop = card.y + innerPad;
      const plotBottom = card.y + card.h - innerPad;

      // 轨迹线：双层描边（白色底层 + 黄色主体），与蓝色背景对比强烈
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      // 白色底层
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 8;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const x = plotLeft + ((p.lng - minLng) / sLng) * (plotRight - plotLeft);
        const y = plotBottom - ((p.lat - minLat) / sLat) * (plotBottom - plotTop);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      // 黄色主体
      ctx.strokeStyle = '#FFE066';
      ctx.lineWidth = 4;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const x = plotLeft + ((p.lng - minLng) / sLng) * (plotRight - plotLeft);
        const y = plotBottom - ((p.lat - minLat) / sLat) * (plotBottom - plotTop);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // 起终点圆点 + 标签
      const first = pts[0];
      const last = pts[pts.length - 1];
      const fX = plotLeft + ((first.lng - minLng) / sLng) * (plotRight - plotLeft);
      const fY = plotBottom - ((first.lat - minLat) / sLat) * (plotBottom - plotTop);
      const lX = plotLeft + ((last.lng - minLng) / sLng) * (plotRight - plotLeft);
      const lY = plotBottom - ((last.lat - minLat) / sLat) * (plotBottom - plotTop);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(fX, fY, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(lX, lY, 7, 0, Math.PI * 2);
      ctx.fill();
      // 起/终标签：深蓝底白字（对比强）
      ctx.fillStyle = '#0d2b7a';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('起', fX, fY + 4);
      ctx.fillText('终', lX, lY + 4);
    },

    /** 指标独立卡片：时长 / 配速 / 消耗 */
    drawStatsCards(ctx, width, height, act) {
      const cards = [
        { label: '时长', value: act.durationText || '—' },
        { label: '配速', value: act.paceText || '—' },
        { label: '消耗', value: `${act.calories || 0} kcal` },
      ];
      const top = 248;
      const cardH = 66;
      const gap = 8;
      const cardW = (width - 24 * 2 - gap * 2) / 3;
      cards.forEach((c, i) => {
        const x = 24 + i * (cardW + gap);
        // 白底圆角卡
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x, top, cardW, cardH, 12) : ctx.rect(x, top, cardW, cardH);
        ctx.fill();
        // 值
        ctx.fillStyle = '#1a4fd0';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.value, x + cardW / 2, top + 24);
        // 标签
        ctx.fillStyle = '#8a93a6';
        ctx.font = '11px sans-serif';
        ctx.fillText(c.label, x + cardW / 2, top + 48);
        ctx.textBaseline = 'alphabetic';
      });

      // 底部时间
      if (act.startTimeText) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(act.startTimeText, 24, height - 20);
      }
    },

    drawCode(ctx, codeUrl, width, height) {
      return new Promise((resolve) => {
        wx.getImageInfo({
          src: codeUrl,
          success: (img) => {
            const size = 84;
            const x = width - size - 20;
            const y = height - size - 12; // 右下角（时间在左下，不冲突）
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

    /** 弹窗内触摸穿透拦截 */
    noop() {},

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
