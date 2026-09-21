/**
 * ec-canvas 地图 → 图片导出（足迹页「分享」与统计页「分享图片」共用）
 *
 * 两个坑（既有实现踩过，别改回去）：
 * 1. 不用 chart.getDataURL()：小程序环境 zrender 的 drawImage 类型校验会失败；
 * 2. canvasToTempFilePath 不传尺寸时各端默认不一致，真机可能按逻辑尺寸截取 → 地图被裁剪，故显式按整 buffer 导出。
 * 画布平时保持透明（不透明画布会盖住页面按钮）；导出时临时铺白底，截完恢复。
 */
const EXPORT_DELAY_MS = 250; // setOption 走 zrender 异步 rAF；不等一帧的话可能抓到旧帧

/** 统计标题：用原生 2d context 画在导出画布上（自定义 echarts 构建未打包 title/graphic 组件） */
function drawExportTitle(comp, text) {
  try {
    const node = comp.canvasNode;
    const ctx = node.getContext('2d');
    const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio) || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `bold ${Math.round(16 * dpr)}px sans-serif`;
    ctx.fillStyle = '#1f2329';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(text, node.width / 2, Math.round(14 * dpr));
  } catch (e) {
    console.error('绘制导出标题失败', e);
  }
}

/**
 * 导出地图图片
 * @param {object} comp ec-canvas 组件实例（需已 init：有 canvasNode / chart）
 * @param {object} [opts] { statsText, layoutCenter, layoutSize, restoreLayout }
 *        statsText：顶部统计行文案；layoutCenter/layoutSize：导出时地图下移留标题位；
 *        restoreLayout：截完恢复的布局（与页面平时一致）。不传 statsText 则纯地图导出（不动作布局）
 * @returns {Promise<string>} tempFilePath（组件未就绪时 reject Error('地图尚未就绪')）
 */
function exportChartImage(comp, opts = {}) {
  return new Promise((resolve, reject) => {
    if (!comp || !comp.canvasNode) {
      reject(new Error('地图尚未就绪'));
      return;
    }
    const chart = comp.chart || null;
    if (chart) {
      // animation:false：导出是快照，关掉布局切换（地图下移/缩放）的过渡动画，
      // 避免各端渲染快慢不同时抓到过渡中间帧
      const exportOpt = { backgroundColor: '#ffffff', animation: false };
      if (opts.statsText) exportOpt.series = [{ layoutCenter: opts.layoutCenter, layoutSize: opts.layoutSize }];
      chart.setOption(exportOpt);
      chart.getZr().flush();
      if (opts.statsText) drawExportTitle(comp, opts.statsText);
    }
    setTimeout(() => {
      const node = comp.canvasNode;
      wx.canvasToTempFilePath({
        canvas: node,
        x: 0,
        y: 0,
        width: node.width,
        height: node.height,
        destWidth: node.width,
        destHeight: node.height,
        fileType: 'png',
        success: (res) => resolve(res.tempFilePath),
        fail: (e) => reject(e),
        complete: () => {
          if (chart) {
            // 恢复背景透明 + 原布局，并把 animation 还原成 echarts 默认值（见上：导出期间被关掉）
            const restoreOpt = { backgroundColor: 'transparent', animation: true };
            if (opts.statsText) restoreOpt.series = [opts.restoreLayout];
            chart.setOption(restoreOpt);
            chart.getZr().flush();
          }
        },
      });
    }, EXPORT_DELAY_MS);
  });
}

module.exports = { exportChartImage };
