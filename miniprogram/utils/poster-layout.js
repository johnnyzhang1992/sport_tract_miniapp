/**
 * 分享海报版面计算（决策 F21 改版：海报从「标题+轨迹+三指标」扩成五段式）
 * 纯函数：只吃「几项指标 / 几段单段明细」，吐设计坐标系里五个区域的上下边界，
 * 以及导出位图缩放和弹窗内显示缩放。share-card 只管照着区域画，尺寸算法集中在这里。
 *
 * 设计坐标系宽固定 300（与旧海报一致，字号沿用），高度按内容自适应：
 * 半马 22 段会比 5 段高出一截，弹窗按 1:1 宽显示，超出视口的部分交给滚动容器滚出。
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
  // 弹窗里标题栏、开关、按钮、提示占掉的屏高：按 share-card.wxss 逐项算出来
  // = 上下 padding 28 + 标题行 31 + 开关行 40 + 按钮 44 + 提示 22 ≈ 165
  PREVIEW_CHROME_H: 165,
  /**
   * 视口最多占屏高这么多：海报再长也只滚这段。
   * 旧口径是「等比缩小到放得下」，半马那条被压成 171×487 —— 弹窗顶到 98% 屏高，字还糊了。
   */
  PREVIEW_VIEW_RATIO: 0.55,
  PREVIEW_MIN_VIEW_H: 240, // 小屏兜底：视口不低于此值
};

/** 年度报告海报：现有总评+月度图之后，再按「运动类型汇总 / 最佳记录 / 今年新解锁」三段自适应加高。
 *  三段都全量展示（有多少行画多少行），段标题、行高、段间距与 year-report.js 的绘制逐项对齐。 */
const YEAR_POSTER = {
  BASE_H: 402, // 顶部品牌带+总距离+四格数据卡+月度柱状图（含月份标签）的固定高度
  SECTION_TITLE_H: 6,
  ROW_H: 18,
  SECTION_GAP: 20,
  BOTTOM_H: 34, // 最后一行到品牌行（H-14）之间的留白
};

const toCount = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

function yearPosterHeight({ typeCount, bestCount, milestoneCount } = {}) {
  const counts = [toCount(typeCount), toCount(bestCount), toCount(milestoneCount)];
  let height = YEAR_POSTER.BASE_H;
  let drawn = 0;
  counts.forEach((n) => {
    if (!n) return;
    if (drawn) height += YEAR_POSTER.SECTION_GAP;
    height += YEAR_POSTER.SECTION_TITLE_H + n * YEAR_POSTER.ROW_H;
    drawn += 1;
  });
  return height + YEAR_POSTER.BOTTOM_H;
}

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
  const viewCap = Math.max(POSTER.PREVIEW_MIN_VIEW_H, Math.floor(screen * POSTER.PREVIEW_VIEW_RATIO));
  // 显示尺寸 = 设计尺寸 1:1（宽恒 300，高就是自然高）；视口只决定「一次露出多少」，超出交给滚动
  const cssWidth = POSTER_WIDTH;
  const cssHeight = height;
  const viewHeight = posterViewHeight(height, screen);
  const dpr = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 2;

  return {
    width: POSTER_WIDTH,
    height,
    regions: { header, track, metrics, segs, footer },
    viewCap,
    viewHeight,
    exportScale: Math.min(3, Math.max(2, Math.round(dpr))),
    cssHeight,
    cssWidth,
  };
}

/**
 * 弹窗里海报的可视高度：自然高与「屏高 × RATIO 封顶」取小，超出部分交给 scroll-view 滚出。
 * 三处海报弹窗（轨迹详情 share-card、周期报告、年度报告）共用这一条规则，别各写一份。
 * @param {number} naturalHeight 海报自然高（= canvas 显示高）
 * @param {number} screenHeight 机型屏高
 */
function posterViewHeight(naturalHeight, screenHeight) {
  const screen = Number.isFinite(screenHeight) && screenHeight > 0 ? screenHeight : 667;
  const cap = Math.max(POSTER.PREVIEW_MIN_VIEW_H, Math.floor(screen * POSTER.PREVIEW_VIEW_RATIO));
  const h = Number.isFinite(naturalHeight) && naturalHeight > 0 ? naturalHeight : cap;
  return Math.min(h, cap);
}

module.exports = {
  computePosterLayout,
  posterViewHeight,
  yearPosterHeight,
  POSTER,
  YEAR_POSTER,
  POSTER_WIDTH,
  METRIC_COLS,
};
