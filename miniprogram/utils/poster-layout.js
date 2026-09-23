/**
 * 分享海报版面计算（决策 F21 改版：海报从「标题+轨迹+三指标」扩成五段式）
 * 纯函数：只吃「几项指标 / 几段单段明细」，吐设计坐标系里五个区域的上下边界，
 * 以及导出位图缩放和弹窗内显示缩放。share-card 只管照着区域画，尺寸算法集中在这里。
 *
 * 设计坐标系宽固定 300（与旧海报一致，字号沿用），高度按内容自适应：
 * 半马 22 段会比 5 段高出一截，靠弹窗等比缩小显示。
 */

const POSTER_WIDTH = 300;
const METRIC_COLS = 3;

const POSTER = {
  HEADER_H: 72, // 左：类型 + 距离；右：昵称 + 开始时间
  TRACK_H: 200, // 轨迹区固定，不随数据量伸缩
  SECTION_TITLE_H: 26, // 小标题 + 与上一区的间距
  METRIC_ROW_H: 40, // 指标格：label 上 + 数值下
  SEG_HEAD_H: 20, // 单段表头（含分隔线上下留白：灰线不贴表头字，也不贴首行字）
  SEG_ROW_H: 17, // 单段行
  FOOTER_H: 56, // 左 logo+小程序名 / 右 小程序码
  BOTTOM_PAD: 16,
  PREVIEW_CHROME_H: 180, // 弹窗里标题栏、开关、按钮、提示占掉的屏高（按 share-card.wxss 量出来约 162，留点余量）
  PREVIEW_MIN_H: 260, // 小屏兜底：可用高度不低于此值
};

const toCount = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/**
 * @param {number} metricsCount 运动数据项数（详情页 metrics 长度）
 * @param {number} segCount     单段明细行数（详情页 kmSegs 长度，含余段）
 * @param {number} screenHeight 机型屏高，用于算弹窗可用高度
 * @param {number} pixelRatio   机型 dpr，用于算导出位图缩放
 */
function computePosterLayout({ metricsCount, segCount, screenHeight, pixelRatio } = {}) {
  const mRows = Math.ceil(toCount(metricsCount) / METRIC_COLS);
  const sRows = toCount(segCount);

  const header = { top: 0, bottom: POSTER.HEADER_H };
  const track = { top: header.bottom, bottom: header.bottom + POSTER.TRACK_H };
  const metrics = {
    top: track.bottom,
    bottom: track.bottom + (mRows ? POSTER.SECTION_TITLE_H + mRows * POSTER.METRIC_ROW_H : 0),
    rows: mRows,
    cols: METRIC_COLS,
    rowHeight: POSTER.METRIC_ROW_H,
  };
  const segs = {
    top: metrics.bottom,
    bottom:
      metrics.bottom +
      (sRows ? POSTER.SECTION_TITLE_H + POSTER.SEG_HEAD_H + sRows * POSTER.SEG_ROW_H : 0),
    rows: sRows,
    rowHeight: POSTER.SEG_ROW_H,
  };
  const footer = { top: segs.bottom, bottom: segs.bottom + POSTER.FOOTER_H };
  const height = footer.bottom + POSTER.BOTTOM_PAD;

  const screen = Number.isFinite(screenHeight) && screenHeight > 0 ? screenHeight : 667;
  const availHeight = Math.max(POSTER.PREVIEW_MIN_H, screen - POSTER.PREVIEW_CHROME_H);
  const cssHeight = Math.min(height, availHeight);
  const dpr = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 2;

  return {
    width: POSTER_WIDTH,
    height,
    regions: { header, track, metrics, segs, footer },
    availHeight,
    exportScale: Math.min(3, Math.max(2, Math.round(dpr))),
    cssHeight,
    cssWidth: POSTER_WIDTH * (cssHeight / height),
  };
}

module.exports = { computePosterLayout, POSTER, POSTER_WIDTH, METRIC_COLS };
