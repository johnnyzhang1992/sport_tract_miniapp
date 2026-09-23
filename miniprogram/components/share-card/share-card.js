/**
 * share-card 分享海报组件（决策 F21/F22）
 * - 点击「分享海报」→ 预览弹窗内 Canvas 绘制海报 → 保存到相册 / 分享给朋友
 * - canvas 放在预览弹窗内（可见区域），canvasToTempFilePath 转换可靠
 * - 五段式版面：顶部（左 类型+距离 / 右 昵称+开始时间）→ 运动轨迹 → 运动数据 → 单段明细 → 底部（左 logo+小程序名 / 右 小程序码）
 *   高度随指标行数、单段行数自适应，尺寸算法集中在 utils/poster-layout
 * props: activity(指标), mapPoints(轨迹点), metrics(与详情页同一份), kmSegs(与详情页同一份)
 * 方法: preview()；事件: posterready({ path }) 海报临时路径
 */
const loading = require('../../utils/loading');
const { computePosterLayout, POSTER } = require('../../utils/poster-layout.js');

const BRAND_NAME = '小迹一下';
const LOGO_SRC = '/assets/logo.png';
const APP_CODE_SRC = '/assets/app_code.jpg';
const LOGO_SIZE = 36; // 底部三件套：logo 与文案以 44 的码为基准撑住左侧
const BRAND_FONT = 14; // 与 36 的 logo 比着走：15 偏重，12 又压不住右侧 44 的码
const APP_CODE_SIZE = 44;
const INK = '#1f2329'; // 与页面主文字色一致
const LABEL = '#8a93a6'; // 与详情页 md-label 同色
const MARGIN = 16;

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

/** 超宽截断加省略号（调用前需已设好目标字号，measureText 才准） */
function ellipsize(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

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
    activity: { type: Object, value: null },
    mapPoints: { type: Array, value: [] },
    metrics: { type: Array, value: [] },
    kmSegs: { type: Array, value: [] },
  },

  data: {
    previewVisible: false,
    previewPath: '', // 海报临时文件（保存/分享用）
    saving: false,
    showKmMarks: true, // 海报是否标注公里数（轨迹上的整公里圆点序号）
    posterStyle: 'width: 300px; height: 400px;', // 弹窗内显示尺寸（自适应海报高度后等比缩放到放得下）
  },

  methods: {
    /** 打开预览弹窗并绘制海报 */
    async preview() {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : {};
      this._layout = computePosterLayout({
        metricsCount: (this.data.metrics || []).length,
        segCount: (this.data.kmSegs || []).length,
        screenHeight: info.windowHeight,
        pixelRatio: info.pixelRatio,
      });
      const L = this._layout;
      this.setData({
        previewVisible: true,
        posterStyle: `width: ${L.cssWidth}px; height: ${L.cssHeight}px;`,
      });
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

    /** 取预览弹窗内的 canvas 节点 */
    queryCanvas() {
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
            resolve(res[0].node);
          });
      });
    },

    /** 按自适应版面重绘海报 */
    async drawPoster() {
      const L = this._layout;
      const canvas = await this.queryCanvas();
      this._canvasNode = canvas;
      const ctx = canvas.getContext('2d');
      // 位图尺寸按导出缩放（弹窗里只是等比显示，存下来的图要够清晰）
      canvas.width = L.width * L.exportScale;
      canvas.height = L.height * L.exportScale;
      ctx.scale(L.exportScale, L.exportScale);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, L.width, L.height);

      this._images = {
        logo: await this.loadImage(canvas, LOGO_SRC),
        appCode: await this.loadImage(canvas, APP_CODE_SRC),
      };

      this.drawHeader(ctx, L);
      this.drawTrack(ctx, L);
      this.drawMetrics(ctx, L);
      this.drawSegs(ctx, L);
      this.drawFooter(ctx, L);
    },

    /** 读包内图片；失败只记一条带路径的日志并返回 null（海报照出，缺哪个少哪个） */
    loadImage(canvas, src) {
      return new Promise((resolve) => {
        const im = canvas.createImage();
        im.onload = () => resolve(im);
        im.onerror = (e) => {
          console.warn(`[share-card] 图片加载失败：${src}`, (e && e.message) || '');
          resolve(null);
        };
        im.src = src;
      });
    },

    /** 顶部：左 类型 + 距离（大数字），右 昵称 + 开始时间；两列以墨迹中心同轴 */
    drawHeader(ctx, L) {
      const act = this.data.activity || {};
      const LABEL_PX = 13;
      const NUM_PX = 24;
      const LABEL_Y = 30;
      const NUM_Y = 58;
      const NICK_PX = 12;
      const LINE_GAP = 18; // 右列两行基线间距
      const CAP = 0.72; // 大写高/字号，估算墨迹上下沿用
      ctx.textAlign = 'left';
      ctx.fillStyle = LABEL;
      ctx.font = `${LABEL_PX}px sans-serif`;
      ctx.fillText(act.label || '运动', MARGIN, LABEL_Y);
      // 数字加大加粗，"公里"保持原样（小号灰）；先测宽再切字体（避免 13px 测量 24px 数字偏窄）
      const kmText = `${act.distanceKm || '0.00'}`;
      ctx.fillStyle = INK;
      ctx.font = `bold ${NUM_PX}px sans-serif`;
      const kmW = ctx.measureText(kmText).width;
      ctx.fillText(kmText, MARGIN, NUM_Y);
      ctx.fillStyle = LABEL;
      ctx.font = `${LABEL_PX}px sans-serif`;
      ctx.fillText('公里', MARGIN + kmW + 6, NUM_Y);

      const leftMid = (LABEL_Y - LABEL_PX * CAP + NUM_Y) / 2;
      const nickY = leftMid - (LINE_GAP - NICK_PX * CAP) / 2;
      const u = getApp().globalData.userInfo || {};
      ctx.textAlign = 'right';
      ctx.fillStyle = INK;
      ctx.font = `600 ${NICK_PX}px sans-serif`;
      // 左列最宽约到 MARGIN+100，右列限宽到它右侧，长昵称省略号截断
      const nick = ellipsize(ctx, u.nickname || '运动用户', L.width - MARGIN * 2 - 100);
      ctx.fillText(nick, L.width - MARGIN, nickY);
      if (act.startTimeText) {
        ctx.fillStyle = LABEL;
        ctx.font = '10px sans-serif';
        ctx.fillText(act.startTimeText, L.width - MARGIN, nickY + LINE_GAP);
      }
      ctx.textAlign = 'left';
    },

    /** 小标题（运动数据 / 单段明细） */
    drawSectionTitle(ctx, text, top) {
      ctx.textAlign = 'left';
      ctx.fillStyle = INK;
      ctx.font = '600 12px sans-serif';
      ctx.fillText(text, MARGIN, top + 17);
    },

    /** 运动数据：三列网格，label 上 + 数值下（与详情页 md-grid 同一形态） */
    drawMetrics(ctx, L) {
      const items = this.data.metrics || [];
      if (!items.length) return;
      const r = L.regions.metrics;
      this.drawSectionTitle(ctx, '运动数据', r.top);
      const colW = (L.width - MARGIN * 2) / r.cols;
      items.forEach((m, i) => {
        const x = MARGIN + (i % r.cols) * colW;
        const cellTop = r.top + POSTER.SECTION_TITLE_H + Math.floor(i / r.cols) * POSTER.METRIC_ROW_H;
        ctx.textAlign = 'left';
        ctx.fillStyle = LABEL;
        ctx.font = '9px sans-serif';
        ctx.fillText(m.label, x, cellTop + 12);
        ctx.fillStyle = INK;
        ctx.font = '600 15px sans-serif';
        const value = String(m.value == null ? '—' : m.value);
        ctx.fillText(value, x, cellTop + 30);
        if (m.unit) {
          // 单位宽度差一档，必须用数值字体测出落点后再切小字
          const valueW = ctx.measureText(value).width;
          ctx.fillStyle = LABEL;
          ctx.font = '9px sans-serif';
          ctx.fillText(m.unit, x + valueW + 2, cellTop + 30);
        }
      });
    },

    /** 单段明细：# / 公里 / 用时 / 配速 四列（与详情页 seg-thead 同口径，全部展开） */
    drawSegs(ctx, L) {
      const segs = this.data.kmSegs || [];
      if (!segs.length) return;
      const r = L.regions.segs;
      this.drawSectionTitle(ctx, '单段明细（每公里）', r.top);
      const colNo = MARGIN;
      const colDist = MARGIN + 34;
      const colTime = MARGIN + 96;
      const colPace = L.width - MARGIN;
      const headY = r.top + POSTER.SECTION_TITLE_H + 13;
      const lineY = r.top + POSTER.SECTION_TITLE_H + POSTER.SEG_HEAD_H - 2;
      ctx.font = '9px sans-serif';
      ctx.fillStyle = LABEL;
      ctx.textAlign = 'left';
      ['#', '公里', '用时'].forEach((t, i) => ctx.fillText(t, [colNo, colDist, colTime][i], headY));
      ctx.textAlign = 'right';
      ctx.fillText('配速', colPace, headY);
      ctx.textAlign = 'left';
      ctx.strokeStyle = '#eef0f3';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(MARGIN, lineY);
      ctx.lineTo(L.width - MARGIN, lineY);
      ctx.stroke();

      segs.forEach((s, i) => {
        const y = lineY + (i + 1) * POSTER.SEG_ROW_H - 5;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = s.partial ? '#ff9800' : INK;
        ctx.fillText(s.partial ? '余' : String(s.idx), colNo, y);
        ctx.fillStyle = INK;
        ctx.fillText(s.distText, colDist, y);
        ctx.fillText(s.durationText, colTime, y);
        // 配速右对齐；最快段在它左侧贴一个橙色小标签（同右对齐，直接按配速宽度让位）
        const pace = String(s.paceText || '—');
        ctx.textAlign = 'right';
        ctx.fillText(pace, colPace, y);
        const paceW = ctx.measureText(pace).width; // 10px 字体下测宽，切小字前拿好
        if (s.fastest) {
          ctx.font = '8px sans-serif';
          ctx.fillStyle = '#ff6b3d';
          ctx.fillText('最快', colPace - paceW - 4, y);
        }
        ctx.textAlign = 'left';
      });
    },

    /** 底部：左 logo + 小程序名，右 小程序码（包内静态图，不依赖接口）；三者以码高为基准垂直居中 */
    drawFooter(ctx, L) {
      const r = L.regions.footer;
      const midY = r.top + POSTER.FOOTER_H / 2;
      const { logo, appCode } = this._images || {};
      if (logo) {
        const y = midY - LOGO_SIZE / 2;
        ctx.save();
        roundRectPath(ctx, MARGIN, y, LOGO_SIZE, LOGO_SIZE, 8);
        ctx.clip();
        ctx.drawImage(logo, MARGIN, y, LOGO_SIZE, LOGO_SIZE);
        ctx.restore();
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = INK;
      ctx.font = `600 ${BRAND_FONT}px sans-serif`;
      ctx.fillText(BRAND_NAME, MARGIN + LOGO_SIZE + 10, midY + BRAND_FONT * 0.35);
      if (appCode) {
        const y = midY - APP_CODE_SIZE / 2;
        ctx.drawImage(appCode, L.width - MARGIN - APP_CODE_SIZE, y, APP_CODE_SIZE, APP_CODE_SIZE);
      }
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

    toTempFile() {
      return new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({
          canvas: this._canvasNode,
          success: (r) => resolve(r.tempFilePath),
          fail: reject,
        });
      });
    },

    /** 轨迹绘图参数：区域取 layout.track（固定 200 高，不随数据量变） */
    drawTrack(ctx, L) {
      const pts = this.data.mapPoints || [];
      if (pts.length < 2) return;
      const act = this.data.activity || {};
      const width = L.width;
      const top = L.regions.track.top;
      const bottom = L.regions.track.bottom;
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
      const plotLeft = MARGIN / 2 + innerPad;
      const plotRight = width - MARGIN / 2 - innerPad;
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
