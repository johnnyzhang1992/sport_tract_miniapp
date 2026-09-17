/**
 * share-card 分享海报组件（决策 F21/F22）
 * - 点击「分享海报」→ 预览弹窗内 Canvas 绘制海报 → 保存到相册 / 分享给朋友
 * - canvas 放在预览弹窗内（可见区域），canvasToTempFilePath 转换可靠
 * props: activityId, activity(指标), mapPoints, miniCodeUrl
 * 方法: preview()；事件: posterready({ path }) 海报临时路径
 */
const api = require('../../services/api');
const loading = require('../../utils/loading');

/** 圆角矩形路径（arcTo 手写，真机基础库无 ctx.roundRect 时兜底为直角） */
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 海拔色带（与 track-map 一致）：蓝 → 绿 → 黄 → 红 12 档 */
const ALTITUDE_COLORS = [
  '#2979ff', '#1e8dd2', '#14a2a6', '#09b679', '#0ac850', '#4ccb3a',
  '#8ecf25', '#d1d20f', '#fec805', '#fb9b15', '#f76f26', '#f44336',
];

/** 两点间大圆距离（米），公里标定位用 */
function distM(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

Component({
  lifetimes: {
    detached() {
      loading.reset(); // 兜底：组件销毁时若有 Loading 残留则清理
    },
  },
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
    showMiniCode: false, // 海报是否带小程序码（功能暂时下线：开关已注释，保持 false）
    showKmMarks: true, // 海报是否标注公里数（轨迹上的整公里圆点序号）
  },

  methods: {
    /** 打开预览弹窗并绘制海报 */
    async preview() {
      this.setData({ previewVisible: true });
      loading.show('生成海报…');
      try {
        // 等弹窗渲染出 canvas
        await new Promise((r) => setTimeout(r, 150));

        await this.drawPoster();
        // 转临时文件（保存/分享用）
        const path = await this.toTempFile();
        this.setData({ previewPath: path });
        this.triggerEvent('posterready', { path });
        loading.hide();
      } catch (e) {
        loading.hide();
        this.setData({ previewVisible: false });
        wx.showToast({ title: '海报生成失败', icon: 'none' });
        console.error('[share-card]', e);
      }
    },

    /** 绘制海报到预览弹窗内的 canvas（无小程序码） */
    drawPoster() {
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

            // 背景（浅色：白底黑字）
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);

            // 标题（两行，居左）：第一行运动类型，第二行 公里数（加大加粗）
            const act = this.data.activity || {};
            ctx.textAlign = 'left';
            ctx.fillStyle = 'rgba(31,35,41,0.7)';
            ctx.font = '13px sans-serif';
            ctx.fillText(act.label || '运动', 16, 30);
            // 数字加大加粗，"公里"保持原样（小号灰）；先测宽再切字体（避免 13px 测量 24px 数字偏窄）
            const kmText = `${act.distanceKm || '0.00'}`;
            ctx.fillStyle = '#1f2329';
            ctx.font = 'bold 24px sans-serif';
            const kmW = ctx.measureText(kmText).width;
            ctx.fillText(kmText, 16, 58);
            ctx.fillStyle = 'rgba(31,35,41,0.7)';
            ctx.font = '13px sans-serif';
            ctx.fillText('公里', 16 + kmW + 6, 58);

            // 轨迹（大块完整展示）
            this.drawTrack(ctx, width, height);

            // 底部布局由小程序码是否绘出决定：带码 → 指标卡上移，底部左侧两行文字；
            // 无码（未开启/取码失败）→ 原布局（指标卡 + 品牌行）
            this.drawMiniCode(ctx, canvas, width, height)
              .catch((e) => {
                console.warn('[share-card] 小程序码绘制跳过', e);
                return false;
              })
              .then((drew) => {
                if (drew) {
                  this.drawStatsCards(ctx, width, height, act, 292);
                  this.drawBottomWithCode(ctx, width, height, act);
                } else {
                  this.drawStatsCards(ctx, width, height, act, 304);
                  this.drawBrandRow(ctx, width, height, act);
                }
                resolve();
              });
          });
      });
    },

    /** 切换公里数标注（重绘海报 + 刷新临时文件） */
    async toggleKmMarks(e) {
      this.setData({ showKmMarks: e.detail.value });
      if (!this.data.previewVisible) return;
      try {
        await this.drawPoster();
        this.setData({ previewPath: await this.toTempFile() });
      } catch (err) {
        console.error('[share-card] 重绘失败', err);
      }
    },

    /** 切换小程序码展示（重绘海报 + 刷新临时文件） */
    async toggleMiniCode(e) {
      this.setData({ showMiniCode: e.detail.value });
      if (!this.data.previewVisible) return;
      if (e.detail.value) this._miniCodeSrc = undefined; // 重新尝试取码
      try {
        await this.drawPoster();
        this.setData({ previewPath: await this.toTempFile() });
        if (e.detail.value && this._miniCodeSrc === null) {
          wx.showToast({ title: '小程序码获取失败', icon: 'none' });
        }
      } catch (err) {
        console.error('[share-card] 重绘失败', err);
      }
    },

    /** 取小程序码图片源（url 为签名 OSS 地址；失败降级 base64；整体失败缓存 null） */
    async ensureMiniCodeSrc() {
      if (this._miniCodeSrc !== undefined) return this._miniCodeSrc;
      try {
        const res = await api.post('/share/mini-code', { activityId: this.data.activityId });
        this._miniCodeSrc = res.url || res.base64 || null;
      } catch (e) {
        console.warn('[share-card] mini-code 接口失败', e);
        this._miniCodeSrc = null;
      }
      return this._miniCodeSrc;
    },

    /** 画小程序码（底部右侧）+ 原引导文案；返回是否绘出（决定底部布局，失败降级无码） */
    async drawMiniCode(ctx, canvas, width, height) {
      if (!this.data.showMiniCode || !this.data.activityId) return false;
      const src = await this.ensureMiniCodeSrc();
      if (!src) return false;
      let img;
      try {
        img = await new Promise((resolve, reject) => {
          const im = canvas.createImage();
          im.onload = () => resolve(im);
          im.onerror = reject;
          im.src = src;
        });
      } catch (e) {
        return false;
      }
      const size = 44;
      const x = width - 14 - size;
      const y = height - 56;
      ctx.drawImage(img, x, y, size, size);
      ctx.fillStyle = 'rgba(31,35,41,0.7)';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('微信扫码', x - 8, y + 18);
      ctx.fillText('查看轨迹', x - 8, y + 32);
      ctx.textAlign = 'left';
      return true;
    },

    /** 带码底部左侧：第一行时间，第二行 昵称（居左，超长省略） */
    drawBottomWithCode(ctx, width, height, act) {
      ctx.fillStyle = 'rgba(31,35,41,0.7)';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'left';
      if (act.startTimeText) ctx.fillText(act.startTimeText, 24, height - 40);
      const u = getApp().globalData.userInfo;
      const nick = (u && u.nickname) || '';
      let line2 = nick;
      if (line2) {
        // 限宽到「微信扫码」文案左缘之前，避免与码区重叠
        const maxW = width - 14 - 44 - 8 - ctx.measureText('微信扫码').width - 12 - 24;
        if (ctx.measureText(line2).width > maxW) {
          while (line2.length > 0 && ctx.measureText(line2 + '…').width > maxW) {
            line2 = line2.slice(0, -1);
          }
          line2 += '…';
        }
        ctx.fillText(line2, 24, height - 20);
      }
    },

    /** 无码底部品牌行（原样保留）：左时间 + 右 @小迹一下 */
    drawBrandRow(ctx, width, height, act) {
      const brandY = height - 20;
      if (act.startTimeText) {
        ctx.fillStyle = 'rgba(31,35,41,0.7)';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(act.startTimeText, 24, brandY);
      }
      ctx.fillStyle = 'rgba(31,35,41,0.7)'; // 与左侧日期一致
      ctx.font = '11px sans-serif'; // 与左侧日期一致
      ctx.textAlign = 'right';
      ctx.fillText('@小迹一下', width - 14, brandY);
      ctx.textAlign = 'left';
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

    /** 轨迹绘图参数：带码时指标卡在 292，无码在 304，下边界随之前留 20 间距 */
    drawTrack(ctx, width, height) {
      const pts = this.data.mapPoints || [];
      if (pts.length < 2) return;
      const act = this.data.activity || {};
      // 轨迹区域：标题下到指标卡上方，尽量占满（压缩死区）
      const pad = 24;
      const top = 82; // 两行标题下
      const bottom = this.data.showMiniCode ? 272 : 284;
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

      // 轨迹区域（白底无卡底背景，直接画轨迹线）
      const innerPad = 12;
      const plotLeft = pad / 2 + innerPad;
      const plotRight = width - pad / 2 - innerPad;
      const plotTop = top + innerPad;
      const plotBottom = bottom - innerPad;

      // 轨迹线：单色实线（与轨迹卡片缩略图一致：#808080 中灰），无起终点、无海拔着色
      // 等比例缩放（与真实地图一致）：纬度 1°≈111km，经度 1°≈111×cos(纬度)km，避免各轴独立拉伸变形
      const midLat2 = (minLat + maxLat) / 2;
      const kmPerDegLng2 = 111 * Math.cos((midLat2 * Math.PI) / 180);
      const lngKm2 = sLng * kmPerDegLng2;
      const latKm2 = sLat * 111;
      const plotW = plotRight - plotLeft;
      const plotH = plotBottom - plotTop;
      const scale2 = Math.min(plotW / lngKm2, plotH / latKm2);
      const offX = plotLeft + (plotW - lngKm2 * scale2) / 2; // 水平居中
      const offY = plotBottom - (plotH - latKm2 * scale2) / 2; // 垂直居中（y 轴翻转）
      const px = (p) => offX + (p.lng - minLng) * kmPerDegLng2 * scale2;
      const py = (p) => offY - (p.lat - minLat) * 111 * scale2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#808080';
      ctx.lineWidth = 1.5;
      // 按 pauseGap 分段绘制，暂停间隙断开连线；沿途累计真实移动距离用于公里标定位
      const segs = this.splitByPauseGaps(pts);
      for (const seg of segs) {
        if (seg.length < 2) continue;
        ctx.beginPath();
        seg.forEach((p, i) => {
          if (i === 0) ctx.moveTo(px(p), py(p));
          else ctx.lineTo(px(p), py(p));
        });
        ctx.stroke();
      }

      // 公里标：按官方总距离比例在整公里处画白底圆点+序号（简化点位累计有截弯误差，用比例定位）
      if (this.data.showKmMarks) {
        const totalKm = Number(act.distanceKm || 0);
        const totalAcc = segs.reduce(
          (sum, seg) => sum + seg.slice(1).reduce((a, p, i) => a + distM(seg[i], p), 0),
          0,
        );
        if (totalKm >= 1 && totalAcc > 0) {
          const step = Math.max(1, Math.ceil(totalKm / 12)); // 长轨迹隔段标注，最多约 12 个
          const kmMarks = [];
          for (let k = step; k < totalKm; k += step) kmMarks.push(k); // 终点距离已在标题展示，不画
          const targetAcc = (k) => (k / totalKm) * totalAcc;
          const markers = [];
          let acc = 0;
          let placed = 0;
          outer: for (const seg of segs) {
            for (let i = 1; i < seg.length; i++) {
              acc += distM(seg[i - 1], seg[i]);
              if (acc >= targetAcc(kmMarks[placed])) {
                markers.push({ x: px(seg[i]), y: py(seg[i]), km: kmMarks[placed] });
                placed += 1;
                if (placed >= kmMarks.length) break outer;
              }
            }
          }
          markers.forEach((m) => {
            ctx.beginPath();
            ctx.arc(m.x, m.y, 6.5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#b9c2cf';
            ctx.stroke();
            ctx.fillStyle = '#4e5969';
            ctx.font = 'bold 7px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(m.km, m.x, m.y + 0.5);
            ctx.textBaseline = 'alphabetic';
          });
        }

        // 起终点标注：绿点=起点、红点=终点（白字，与公里标同风格）
        const first = segs[0][0];
        const lastSeg = segs[segs.length - 1];
        const last = lastSeg[lastSeg.length - 1];
        [
          ['起', '#00b578', px(first), py(first)],
          ['终', '#f53f3f', px(last), py(last)],
        ].forEach(([ch, color, x, y]) => {
          ctx.beginPath();
          ctx.arc(x, y, 7, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 7px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(ch, x, y + 0.5);
          ctx.textBaseline = 'alphabetic';
        });
      }
    },

    /** 按 pauseGap 标记将点集切分为多段 */
    splitByPauseGaps(pts) {
      const segs = [];
      let start = 0;
      for (let i = 0; i < pts.length; i++) {
        if (pts[i].pauseGap && i > start) {
          segs.push(pts.slice(start, i));
          start = i;
        }
      }
      if (start < pts.length) segs.push(pts.slice(start));
      // 过滤掉只有1个点的段（无法绘制线段）
      return segs.filter(s => s.length >= 2);
    },

    /** 指标独立卡片：时长 / 配速 / 消耗（左贴左、中居中、右贴右；top 可调：带码时上移让出底部空间） */
    drawStatsCards(ctx, width, height, act, top = 304) {
      // 配速：去掉 /公里 单位（只显示数值，如 5'30"）；消耗单位移到 label
      const paceFull = act.paceText || (act.paceValue ? `${act.paceValue}${act.paceUnit || ''}` : '—');
      const paceText = String(paceFull).replace(/\s*\/公里.*$/, '');
      const cards = [
        { label: '时长', value: act.durationText || '—' },
        { label: '配速', value: paceText },
        { label: '消耗/千卡', value: `${act.calories || 0}` },
      ];
      // 锚点：左项贴左边距，中间绝对居中，右项贴右边距
      const margin = 24;
      const anchors = [
        { x: margin, align: 'left' },
        { x: width / 2, align: 'center' },
        { x: width - margin, align: 'right' },
      ];
      cards.forEach((c, i) => {
        const { x, align } = anchors[i];
        // 配速：数值大字 + /公里 单位小字（组合按锚点整体对齐）
        const match = c.label === '配速' ? /^(.*?)(\/.*)$/.exec(String(c.value)) : null;
        if (match) {
          const num = match[1];
          const unit = match[2];
          ctx.font = 'bold 15px sans-serif';
          const numW = ctx.measureText(num).width;
          ctx.font = '11px sans-serif';
          const unitW = ctx.measureText(unit).width;
          const totalW = numW + unitW;
          const startX = align === 'left' ? x : align === 'right' ? x - totalW : x - totalW / 2;
          ctx.fillStyle = 'rgba(31,35,41,0.7)';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.font = '15px sans-serif';
          ctx.fillText(num, startX, top + 22);
          ctx.font = '11px sans-serif';
          ctx.fillText(unit, startX + numW, top + 22);
        } else {
          // 值
          ctx.fillStyle = 'rgba(31,35,41,0.7)';
          ctx.font = '15px sans-serif';
          ctx.textAlign = align;
          ctx.textBaseline = 'middle';
          ctx.fillText(c.value, x, top + 22);
        }
        // 标签（颜色与数值/底部一致，对齐方式随锚点）
        ctx.fillStyle = 'rgba(31,35,41,0.7)';
        ctx.font = '11px sans-serif';
        ctx.textAlign = align;
        ctx.fillText(c.label, x, top + 40);
        ctx.textBaseline = 'alphabetic';
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
