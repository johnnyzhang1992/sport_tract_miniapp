const api = require('../../services/api');
const config = require('../../config/index');
const { formatDuration, compact, formatDurationStat } = require('../../utils/format');

const RANGES = [
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
  { value: 'year', label: '本年' },
  { value: 'all', label: '全部' },
];

/** 分享海报最多展示轨迹条数（防 canvas 绘制过多导致性能问题） */
const MAX_SHARE_TRACKS = 72; // 8 列 × 9 行（高度更高，贴合 3:4）

/** canvas 圆角矩形路径 */
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

Page({
  data: {
    ranges: RANGES,
    activeRange: 'week',
    data: { count: 0, totalDistanceKm: 0, durationNum: '—', durationUnit: '分钟' },
    tracks: [],
    heat: [],
    recentTracks: [],
    visibleRecent: [], // 分批展示（触底加载更多，避免一次性画太多轨迹）
    recentStep: 10,
    mapType: 'standard',
    loading: false,
    fullscreen: false,
    shareVisible: false,
    shareTracks: [], // 分享网格：[{ id, points:[{lat,lng}], timeText }]
    shareShowTime: false, // 默认不展示时间
    shareCanvasH: 200, // 海报高度（按轨迹数量动态）
    shareTitle: '', // 弹窗头标题：我的{范围}轨迹分享
  },

  onLoad() {
    this.fetch();
  },

  async fetch() {
    const app = getApp();
    // 已注册用户（本地有 token）静默恢复登录；游客不自动登录
    if (app.hasSession() && !app.globalData.loggedIn) {
      try {
        await app.login();
      } catch (e) {
        console.warn('静默登录失败', e);
      }
    }
    if (!app.globalData.loggedIn) return;
    this.setData({ loading: true });
    try {
      const res = await api.get(`/overview?range=${this.data.activeRange}`);
      console.log('[overview] res tracks=', (res.tracks || []).length, 'heat=', (res.heat || []).length);
      const dur = formatDurationStat(res.totalDurationSec);
      this.setData({
        data: {
          count: res.count,
          totalDistanceKm: compact(res.totalDistanceKm),
          durationNum: dur.num,
          durationUnit: dur.unit,
        },
        tracks: this.decorateTracks(res.tracks),
        _allTracks: res.tracks || [], // 原始数据（含 startTime，分享弹窗用）
        heat: res.heat || [],
        recentTracks: this.decorateRecent(res.tracks),
        visibleRecent: this.decorateRecent(res.tracks).slice(0, this.data.recentStep),
      });
    } catch (e) {
      console.error('加载轨迹合集失败', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
      // 只兜底视野定位（不重复 buildOverview，避免覆盖竞态）
      setTimeout(() => {
        const map = this.selectComponent('#overviewMap');
        if (map && typeof map.fitOverviewView === 'function') {
          map.fitOverviewView();
        }
      }, 300);
    }
  },

  onRangeChange(e) {
    const value = e.currentTarget.dataset.value;
    if (value === this.data.activeRange) return;
    this.setData({ activeRange: value, tracks: [], heat: [], recentTracks: [], visibleRecent: [] });
    this.fetch();
  },

  /** 轨迹 → 地图 polyline 数据（类型配色） */
  decorateTracks(tracks) {
    return (tracks || []).map((t) => {
      const meta = config.ACTIVITY_TYPES.find((x) => x.type === t.type) || {};
      return {
        id: t.id,
        type: t.type,
        color: '#4A5568', // 轨迹颜色统一深灰蓝（白底地图清晰；原 #808080 中灰偏淡看不清）
        points: t.points || [],
      };
    });
  },

  /** 最近轨迹列表（取前 20 条） */
  decorateRecent(tracks) {
    return (tracks || []).map((t) => {
      const meta = config.ACTIVITY_TYPES.find((x) => x.type === t.type) || {};
      const start = new Date(t.startTime);
      const timeText =
        Math.floor((Date.now() - start.getTime()) / 86400000) < 7
          ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][start.getDay()]
          : `${start.getFullYear()}/${start.getMonth() + 1}/${start.getDate()}`;
      return {
        id: t.id,
        icon: meta.icon || '🏃',
        iconImg: meta.iconImg || '',
        label: meta.label || t.type,
        color: '#808080', // 轨迹颜色（与我的轨迹一致）
        previewPoints: t.points || [], // 轨迹缩略图点
        timeText,
        distanceKm: (t.distance / 1000).toFixed(2).replace(/\.?0+$/, ''),
        durationText: formatDuration(t.duration),
      };
    });
  },

  /** 触底加载更多最近轨迹（分批渲染防性能问题） */
  onReachBottom() {
    const { recentTracks, visibleRecent, recentStep } = this.data;
    if (visibleRecent.length >= recentTracks.length) return;
    this.setData({
      visibleRecent: recentTracks.slice(0, visibleRecent.length + recentStep),
    });
  },

  /** 分享弹窗：当前 TAB 下所有轨迹 → 网格（列数按数量自动） */
  openShare() {
    const tracks = this.data._allTracks || this.data.tracks || [];
    if (!tracks.length) {
      wx.showToast({ title: '该时间段暂无轨迹', icon: 'none' });
      return;
    }
    const rangeLabel = { week: '本周', month: '本月', year: '本年', all: '全部' }[this.data.activeRange] || '当前';
    const showCount = Math.min(tracks.length, MAX_SHARE_TRACKS);
    this.setData({ shareTitle: `我的${rangeLabel}轨迹 · ${showCount} 条${tracks.length > MAX_SHARE_TRACKS ? '（部分）' : ''}` });
    const shareTracks = tracks.map((t) => {
      const ts = t.startTime || t.startTimeText || Date.now();
      const d = new Date(ts);
      const valid = !isNaN(d.getTime());
      const timeText = valid
        ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        : '';
      return { id: t.id, points: t.points || [], timeText, distance: t.distance || 0 };
    });
    this.setData({ shareVisible: true, shareTracks }, () => this.drawSharePoster());
  },

  closeShare() {
    this.setData({ shareVisible: false });
  },

  noop() {},

  /** 保存分享图到相册 */
  saveShare() {
    if (this._shareSaving) return;
    this._shareSaving = true;
    wx.createSelectorQuery()
      .in(this)
      .select('#sharePoster')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          this._shareSaving = false;
          return;
        }
        wx.canvasToTempFilePath({
          canvas: res[0].node,
          success: (r) => {
            wx.saveImageToPhotosAlbum({
              filePath: r.tempFilePath,
              success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
              fail: () => wx.showToast({ title: '保存失败', icon: 'none' }),
              complete: () => { this._shareSaving = false; },
            });
          },
          fail: () => {
            this._shareSaving = false;
            wx.showToast({ title: '生成图片失败', icon: 'none' });
          },
        });
      });
  },

  /** 时间显示开关：重新绘制海报 */
  toggleShareTime() {
    this.setData({ shareShowTime: !this.data.shareShowTime }, () => this.drawSharePoster());
  },

  /** 列数规则：自适应公式 cols = ceil((sqrt(1+4n)-1)/2)（k²+k ≥ n 的最小 k），不限制列数上限
   *   n: 1→1列；2-6→2列；7-12→3列；13-20→4列；21-30→5列…行数随数量自然增长 */
  colsFor(n) {
    if (n <= 1) return 1;
    const k = Math.ceil((Math.sqrt(1 + 4 * n) - 1) / 2);
    return Math.max(2, k);
  },

  /** 绘制分享海报：轨迹网格（轨迹线 + 时间，时间可开关）；高度按行数动态 */
  drawSharePoster() {
    const all = this.data.shareTracks || [];
    if (!all.length) return;
    // 最多展示 MAX_SHARE_TRACKS 条（超出截断，避免绘制过多影响性能）
    const truncated = all.length > MAX_SHARE_TRACKS;
    const tracks = truncated ? all.slice(0, MAX_SHARE_TRACKS) : all;
    const cols = this.colsFor(tracks.length);
    const rows = Math.ceil(tracks.length / cols);
    const cellW = 96; // 每格宽（px）
    const cellH = 76; // 每格高（轨迹区）
    const timeH = 18; // 时间区固定占位（切换只控制文字显隐，高度不变避免重绘时序问题）
    const gap = 12;
    const pad = 16;
    // 海报高度：初始 3:4（宽300 高400），轨迹多行数多时再动态增高
    // 顶部预留 100 与 contentTop 匹配（标题区 + 间距），底部预留 30 给品牌行
    const contentH = 100 + rows * (cellH + timeH + gap) + 30;
    const H = Math.max(400, contentH);

    wx.createSelectorQuery()
      .in(this)
      .select('#sharePoster')
      .fields({ node: true, size: true })
      .exec((res) => {
        const info = res && res[0];
        if (!info || !info.node) return;
        const { node, width } = info;
        if (!width) return;
        // 动态高度：先 setData 高度再绘制
        if (Math.abs(H - this.data.shareCanvasH) > 1) {
          this.setData({ shareCanvasH: Math.ceil(H) }, () => this.drawSharePoster());
          return;
        }
        const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2;
        node.width = width * dpr;
        node.height = H * dpr;
        const ctx = node.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, H);
        // 背景白色
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, H);

        // 标题（两行，居左）：已累计运动了 / {累计公里数} 公里（加大加粗）
        const totalKm = (all.reduce((s, t) => s + (t.distance || 0), 0) / 1000).toFixed(2);
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(31,35,41,0.7)';
        ctx.font = '13px sans-serif';
        ctx.fillText('已累计运动了', 16, 30);
        // 数字加大加粗，"公里"保持原样（小号灰）；先测宽再切字体（避免 13px 测量 24px 数字偏窄）
        ctx.fillStyle = '#1f2329';
        ctx.font = 'bold 24px sans-serif';
        const kmW = ctx.measureText(totalKm).width;
        ctx.fillText(totalKm, 16, 58);
        ctx.fillStyle = 'rgba(31,35,41,0.7)';
        ctx.font = '13px sans-serif';
        ctx.fillText('公里', 16 + kmW + 6, 58);
        // 截断提示（在品牌行上方）
        if (truncated) {
          ctx.fillStyle = '#bbb';
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`仅展示前 ${MAX_SHARE_TRACKS} 条`, width / 2, H - 30);
        }

        // 网格：动态格子宽（占满宽度），高度方向垂直居中（3:4 固定高度下空白均匀分布）
        const gridW = width - pad * 2;
        const cell = gridW / cols;
        const innerPad = 4;
        // 网格上边界：标题两行底部（数字基线 58 + 24px 字号）之后留 32px 间距，避免与轨迹重叠
        const contentTop = 90;
        const contentBottom = H - 36; // 品牌行上方
        const gridH = rows * (cellH + timeH + gap);
        const startY = contentTop + Math.max(0, (contentBottom - contentTop - gridH) / 2);
        tracks.forEach((t, i) => {
          const row = Math.floor(i / cols);
          const col = i % cols;
          const cx = pad + col * cell;
          const cy = startY + row * (cellH + timeH + gap);
          // 轨迹线（bbox 归一化，不加格子背景色）
          this.drawMiniTrack(ctx, t.points, cx + innerPad + 2, cy + 4, cell - 2 * innerPad - 4, cellH - 8);
          // 时间（可开关）
          if (this.data.shareShowTime) {
            ctx.fillStyle = '#8a93a6';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(t.timeText, cx + cell / 2, cy + cellH + 12);
          }
        });

        // 底部品牌行：左侧昵称 + 右侧 @小迹一下
        const app = getApp();
        const nickname = (app.globalData.userInfo && app.globalData.userInfo.nickname) || '运动爱好者';
        ctx.fillStyle = 'rgba(31,35,41,0.7)';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(nickname, pad, H - 14);
        ctx.textAlign = 'right';
        ctx.fillText('@小迹一下', width - pad, H - 14);
      });
  },

  /** 迷你轨迹线（单格内画） */
  drawMiniTrack(ctx, pts, x, y, w, h) {
    if (!pts || pts.length < 2) return;
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    pts.forEach((p) => {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    });
    const sLat = maxLat - minLat || 1e-9;
    const sLng = maxLng - minLng || 1e-9;
    // 等比例缩放（与真实地图一致）：纬度 1°≈111km，经度 1°≈111×cos(纬度)km，避免独立拉伸变形
    const midLat = (minLat + maxLat) / 2;
    const kmPerDegLng = 111 * Math.cos((midLat * Math.PI) / 180);
    const lngKm = sLng * kmPerDegLng;
    const latKm = sLat * 111;
    const scale = Math.min(w / lngKm, h / latKm); // px/km
    const offX = x + (w - lngKm * scale) / 2; // 格内水平居中
    const offY = y + h - (h - latKm * scale) / 2; // 格内垂直居中（y 轴翻转）
    const px = (p) => offX + (p.lng - minLng) * kmPerDegLng * scale;
    const py = (p) => offY - (p.lat - minLat) * 111 * scale;
    ctx.strokeStyle = '#808080';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => {
      if (i === 0) ctx.moveTo(px(p), py(p));
      else ctx.lineTo(px(p), py(p));
    });
    ctx.stroke();
  },

  switchLayer() {
    this.setData({
      mapType: this.data.mapType === 'standard' ? 'satellite' : 'standard',
    });
  },

  /** 全屏展示合集地图 */
  openFullscreen() {
    this.setData({ fullscreen: true });
    // 全屏组件刚创建（wx:if），ready 已画线；这里只兜底视野
    setTimeout(() => {
      const map = this.selectComponent('#fsOverviewMap');
      if (map && typeof map.fitOverviewView === 'function') {
        map.fitOverviewView();
      }
    }, 300);
  },

  closeFullscreen() {
    this.setData({ fullscreen: false });
  },

  /** 全屏内图层切换 */
  fsSwitchLayer() {
    this.switchLayer();
  },

  onTapTrack(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/track-detail/track-detail?id=${id}` });
  },

  /** 分享给朋友 */
  onShareAppMessage() {
    return { title: '我的轨迹合集 · 一起来运动', path: '/pages/overview/overview' };
  },

  /** 分享到朋友圈 */
  onShareTimeline() {
    return { title: '我的轨迹合集 · 一起来运动' };
  },
});
