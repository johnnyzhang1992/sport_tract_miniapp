/**
 * 分享海报版面纯函数（utils/poster-layout.js）单测：
 * 海报高度随「运动数据行数 / 单段行数」增长、五个区域自上而下连续不重叠、
 * 导出位图缩放夹在 [2,3]、弹窗显示按自然尺寸（宽恒 1:1）+ 视口封顶交给滚动。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  computePosterLayout, posterViewHeight,
  POSTER,
  POSTER_WIDTH,
  METRIC_COLS,
} = require('../miniprogram/utils/poster-layout.js');

/** 常见机型：屏高 667、dpr 2 */
const base = (over) => computePosterLayout({ screenHeight: 667, pixelRatio: 2, ...over });

test('PL1 常量口径：宽 300、指标 3 列、五区固定高度写死在一处', () => {
  assert.equal(POSTER_WIDTH, 300);
  assert.equal(METRIC_COLS, 3);
  assert.equal(POSTER.HEADER_H, 72);
  assert.equal(POSTER.TRACK_H, 200);
  assert.equal(POSTER.FOOTER_H, 56);
});

test('PL2 区域连续：header→track→metrics→segs→footer 首尾相接，footer 底边留底部内边距', () => {
  const L = base({ metricsCount: 6, segCount: 5 });
  const { header, track, metrics, segs, footer } = L.regions;
  assert.equal(header.top, 0);
  assert.equal(track.top, header.bottom);
  assert.equal(metrics.top, track.bottom);
  assert.equal(segs.top, metrics.bottom);
  assert.equal(footer.top, segs.bottom);
  assert.equal(footer.bottom + POSTER.BOTTOM_PAD, L.height);
});

test('PL3 高度随指标行数增长：6 项 2 行 → 7 项 3 行，多一行指标多一行高', () => {
  const two = base({ metricsCount: 6, segCount: 5 });
  const three = base({ metricsCount: 7, segCount: 5 });
  assert.equal(two.regions.metrics.rows, 2);
  assert.equal(three.regions.metrics.rows, 3);
  assert.equal(three.height - two.height, POSTER.METRIC_ROW_H);
});

test('PL4 高度随单段行数增长：半马 22 段比 5 段高 17×17', () => {
  const short = base({ metricsCount: 6, segCount: 5 });
  const long = base({ metricsCount: 6, segCount: 22 });
  assert.equal(long.height - short.height, POSTER.SEG_ROW_H * 17);
});

test('PL5 空数据兜底：无指标无分段时两区不占高，高度只剩 标题+轨迹+底部', () => {
  const L = base({ metricsCount: 0, segCount: 0 });
  assert.equal(L.regions.metrics.rows, 0);
  assert.equal(L.regions.metrics.bottom, L.regions.metrics.top, '0 行不该撑出高度');
  assert.equal(L.regions.segs.bottom, L.regions.segs.top);
  assert.equal(
    L.height,
    POSTER.HEADER_H + POSTER.TRACK_H + POSTER.FOOTER_H + POSTER.BOTTOM_PAD
  );
  // 脏输入（undefined/NaN）不得把整张海报算成 NaN
  assert.ok(Number.isFinite(base({}).height), '缺参数仍是有限数');
});

test('PL6 导出缩放：dpr 1 抬到 2、2 保持 2、3 保持 3、4 压到 3', () => {
  const s = (dpr) => computePosterLayout({ metricsCount: 3, segCount: 1, screenHeight: 667, pixelRatio: dpr }).exportScale;
  assert.deepEqual([1, 2, 3, 4].map(s), [2, 2, 3, 3]);
});

test('PL7 弹窗显示：宽度恒 1:1 不缩，放不下交给滚动而不是缩图', () => {
  const bare = base({ metricsCount: 0, segCount: 0 }); // 只有标题 + 轨迹 + 底部，344 高，667 屏放得下
  assert.equal(bare.cssWidth, POSTER_WIDTH, '矮海报：宽 1:1');
  assert.equal(bare.cssHeight, bare.height, 'canvas 高就是海报自然高（导出与显示同源）');
  assert.equal(bare.viewHeight, bare.height, '本来就放得下 → 视口 = 自然高，不留一段能滚的空隙');

  const tall = base({ metricsCount: 7, segCount: 22 });
  assert.ok(tall.height > tall.viewHeight, '用例前提：半马海报在 667 屏上放不下');
  assert.equal(tall.cssWidth, POSTER_WIDTH, '再高也不缩宽 —— 旧口径会缩到 171px 宽，字糊成一片');
  assert.equal(tall.cssHeight, tall.height, 'canvas 仍按自然高绘制，超出部分由 scroll-view 滚出');
});

test('PL8 视口封顶 = 屏高 × RATIO 取整，小屏有 MIN_VIEW_H 兜底', () => {
  const cap = (screen) =>
    Math.max(POSTER.PREVIEW_MIN_VIEW_H, Math.floor(screen * POSTER.PREVIEW_VIEW_RATIO));
  for (const screen of [667, 812, 932]) {
    const L = base({ metricsCount: 7, segCount: 22, screenHeight: screen });
    assert.equal(L.viewHeight, cap(screen), `${screen} 屏应封顶在 ${cap(screen)}，弹窗才不会顶满`);
    assert.ok(L.viewHeight <= L.cssHeight, '视口不该比海报还高');
  }
  assert.equal(cap(320), POSTER.PREVIEW_MIN_VIEW_H, '小屏兜底：320×0.55=176 会被抬到下限');
});

test('PL9 轨迹区不受内容影响：指标/分段多少都占 200 高（轨迹保持不变）', () => {
  const a = base({ metricsCount: 0, segCount: 0 });
  const b = base({ metricsCount: 9, segCount: 30 });
  assert.equal(a.regions.track.bottom - a.regions.track.top, POSTER.TRACK_H);
  assert.equal(b.regions.track.bottom - b.regions.track.top, POSTER.TRACK_H);
});

test('PL10 posterViewHeight 与 computePosterLayout.viewHeight 同一个函数：三处弹窗共用一条封顶规则', () => {
  const screen = 667;
  for (const n of [200, 344, 473, 852]) {
    const L = base({ metricsCount: 7, segCount: n });
    assert.equal(posterViewHeight(n, screen), Math.min(n, L.viewCap), `${n} 高`);
    assert.equal(L.viewHeight, posterViewHeight(L.height, screen), '版面函数必须走同一个口径');
  }
  assert.equal(posterViewHeight(500, 320), POSTER.PREVIEW_MIN_VIEW_H, '小屏兜底');
  assert.equal(posterViewHeight(500, undefined), Math.min(500, Math.floor(667 * POSTER.PREVIEW_VIEW_RATIO)), '缺屏高按 667 兜底');
  assert.ok(Number.isFinite(posterViewHeight(NaN, 667)), '脏输入不出 NaN');
});
