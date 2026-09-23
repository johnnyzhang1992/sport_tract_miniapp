/**
 * components/share-card 海报绘制回归：五段式版面（顶部右列昵称/时间、运动数据、单段明细、底部品牌+码）。
 * 桩：Component() 捕获定义 + 一个记账用 canvas 2d context（与 footprint-filter-sheet.test.js 同一套路），
 *     只验「画了什么、画在哪一区」，像素级效果靠模拟器截图。
 * 运行：npm test（node --test 自动发现）；依赖：仅 node 内置模块。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

global.Component = (def) => { global.__def = def; };
global.getApp = () => ({ globalData: { userInfo: { nickname: '小张' } } });

const toasts = [];
global.wx = {
  showLoading() {},
  hideLoading() {},
  showToast: (o) => toasts.push(o.title),
  getWindowInfo: () => ({ windowHeight: 667, pixelRatio: 2 }),
  canvasToTempFilePath: ({ success }) => success({ tempFilePath: 'wxfile://poster.jpg' }),
  createSelectorQuery: () => ({
    in: () => ({
      select: () => ({
        // 组件用 .fields({node:true,size:true}).exec(cb) 链式取节点
        fields: () => ({ exec: (cb) => cb([{ node: CURRENT_CANVAS, width: 300, height: 400 }]) }),
      }),
    }),
  }),
};

let CURRENT_CANVAS = null;
require('../miniprogram/components/share-card/share-card.js');
const def = global.__def;
const { computePosterLayout, POSTER } = require('../miniprogram/utils/poster-layout.js');

assert.ok(def, 'share-card.js 应通过 Component() 交出组件对象');

/** 文本宽度粗模型：中日韩字符占 1em，其他 0.55em（够用来验截断与列序） */
function textWidth(s, font) {
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(font || '10px')[1]);
  return [...String(s)].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? px : px * 0.55), 0);
}

/** 只记账的 2d context：fillText / drawImage 落操作，其余画路径的调用空转 */
function makeCtx() {
  const st = { font: '10px sans-serif', fillStyle: '#000', textAlign: 'left', textBaseline: 'alphabetic' };
  const ops = [];
  let path = [];
  const ctx = {
    ops,
    texts: () => ops.filter((o) => o.op === 'text'),
    images: () => ops.filter((o) => o.op === 'image'),
    /** 已 stroke 的直线段（用于核表头下的分隔线位置） */
    lines: () => ops.filter((o) => o.op === 'stroke'),
    measureText: (t) => ({ width: textWidth(t, st.font) }),
    fillText: (text, x, y) =>
      ops.push({ op: 'text', text: String(text), x, y, font: st.font, fillStyle: st.fillStyle, align: st.textAlign }),
    drawImage: (img, x, y, w, h) => ops.push({ op: 'image', src: img && img.src, x, y, w, h }),
    beginPath: () => { path = []; },
    moveTo: (x, y) => { path = [{ x, y }]; },
    lineTo: (x, y) => { path.push({ x, y }); },
    stroke: () => {
      if (path.length >= 2) ops.push({ op: 'stroke', strokeStyle: st.strokeStyle, from: path[0], to: path[path.length - 1] });
      path = [];
    },
  };
  ['fillRect', 'closePath', 'arc', 'arcTo', 'clip', 'save', 'restore', 'fill', 'scale'].forEach(
    (m) => { ctx[m] = () => {}; }
  );
  ['font', 'fillStyle', 'textAlign', 'textBaseline', 'lineWidth', 'strokeStyle', 'lineJoin', 'lineCap'].forEach((k) => {
    Object.defineProperty(ctx, k, { get: () => st[k], set: (v) => { st[k] = v; } });
  });
  return ctx;
}

function makeCanvas(images) {
  return {
    width: 0,
    height: 0,
    getContext: () => CURRENT_CTX,
    createImage: () => {
      const im = {};
      Object.defineProperty(im, 'src', {
        configurable: true,
        set(v) {
          setTimeout(() => {
            if (images[v] === 'fail') {
              im.onerror({ message: 'mock load fail' });
              return;
            }
            // 加载成功：把 src 改回普通数据属性（否则回写又触发 setter，定时器会无限串下去）
            Object.defineProperty(im, 'src', { value: v, writable: true, configurable: true });
            im.w = 100;
            im.h = 100;
            im.onload();
          }, 0);
        },
      });
      return im;
    },
  };
}

let CURRENT_CTX = null;

const ACTIVITY = { label: '户外跑步', distanceKm: '5.21', startTimeText: '2026/9/21 07:32' };
const METRICS = [
  { label: '运动时长', value: '28:41' },
  { label: '平均配速', value: "5'30\"", unit: '/公里' },
  { label: '运动消耗', value: '312', unit: '千卡' },
  { label: '总时长', value: '31:02' },
  { label: '爬升高度', value: '18', unit: '米' },
];
const SEGS = [
  { idx: 1, distText: '1.00', durationText: '5:40', paceText: "5'40\"" },
  { idx: 2, distText: '1.00', durationText: '5:12', paceText: "5'12\"", fastest: true },
  { distText: '0.21', durationText: '1:15', paceText: "5'57\"", partial: true },
];
const POINTS = [
  { lat: 30.2, lng: 120.1, timestamp: 1 },
  { lat: 30.21, lng: 120.11, timestamp: 2 },
  { lat: 30.22, lng: 120.12, timestamp: 3 },
];

async function mount(over = {}, images = {}) {
  CURRENT_CTX = makeCtx();
  CURRENT_CANVAS = makeCanvas(images);
  const c = Object.assign({}, def.methods);
  c.data = Object.assign({}, def.data, { activity: ACTIVITY, mapPoints: POINTS, metrics: METRICS, kmSegs: SEGS }, over);
  c.events = [];
  c.setData = (patch) => Object.assign(c.data, patch);
  c.triggerEvent = (name, detail) => c.events.push({ name, detail });
  toasts.length = 0;
  await c.preview();
  return { c, ctx: CURRENT_CTX, canvas: CURRENT_CANVAS };
}

const layoutOf = (c) =>
  computePosterLayout({
    metricsCount: c.data.metrics.length,
    segCount: c.data.kmSegs.length,
    screenHeight: 667,
    pixelRatio: 2,
  });

test('SC1 海报尺寸自适应：位图 = 版面 × 导出缩放，弹窗样式与版面同比，且没有报错 toast', async () => {
  const { c, ctx, canvas } = await mount();
  assert.deepEqual(toasts, [], `绘制过程不该弹错：${toasts}`);
  const L = layoutOf(c);
  assert.equal(canvas.width, L.width * L.exportScale);
  assert.equal(canvas.height, L.height * L.exportScale);
  // 5 项指标 2 行 + 3 段单段：钉一个绝对值，改常量时这里要一起想清楚
  // （单段表头 18→20：表头下灰线原来离字太近，两侧各放开约 2~4px）
  assert.equal(L.height, 72 + 200 + (26 + 80) + (26 + 20 + 51) + 56 + 16);
  assert.equal(c.data.posterStyle, `width: ${L.cssWidth}px; height: ${L.cssHeight}px;`);
  assert.equal(ctx.ops.length > 0, true);
  assert.deepEqual(c.events.map((e) => e.name), ['posterready']);
  assert.equal(c.data.previewPath, 'wxfile://poster.jpg');
});

test('SC2 运动数据：小标题 + 三项一行铺开，label 在上数值在下、单位跟数值同基线', async () => {
  const { c, ctx } = await mount();
  const r = layoutOf(c).regions.metrics;
  const texts = ctx.texts();
  const title = texts.find((t) => t.text === '运动数据');
  assert.ok(title && title.y > r.top && title.y < r.bottom, '小标题落在运动数据区内');
  const labels = ['运动时长', '平均配速', '运动消耗'];
  const cells = labels.map((l) => texts.find((t) => t.text === l));
  assert.ok(cells.every(Boolean) && cells.every((t) => t.y > r.top && t.y < r.bottom));
  assert.ok(cells[0].x < cells[1].x && cells[1].x < cells[2].x, '三列自左向右');
  const value = texts.find((t) => t.text === "5'30\"");
  assert.ok(value && value.y > cells[1].y, '数值在 label 下方');
  const unit = texts.find((t) => t.text === '/公里');
  assert.equal(unit.y, value.y, '单位与数值同基线');
  assert.ok(
    unit.x >= value.x + textWidth(value.text, value.font) - 1,
    `单位要让开数值宽度，否则叠字：value.x=${value.x} unit.x=${unit.x}`,
  );
  assert.equal(texts.find((t) => t.text === '312') && texts.some((t) => t.text === '千卡'), true);
});

test('SC3 单段明细：每段一行、余段写「余」、最快段带「最快」，全部落在本区内', async () => {
  const { c, ctx } = await mount();
  const r = layoutOf(c).regions.segs;
  const texts = ctx.texts();
  assert.ok(texts.some((t) => t.text === '单段明细（每公里）'));
  ['#', '公里', '用时', '配速'].forEach((h) => assert.ok(texts.some((t) => t.text === h), `缺表头 ${h}`));
  const rows = ['5:40', "5'12\"", '1:15'];
  rows.forEach((t) => {
    const hit = texts.find((x) => x.text === t);
    assert.ok(hit, `缺行 ${t}`);
    assert.ok(hit.y > r.top && hit.y < r.bottom, `${t} 画到区外了`);
  });
  assert.ok(texts.some((t) => t.text === '余' && t.fillStyle === '#ff9800'), '余段用橙色');
  assert.ok(texts.some((t) => t.text === '最快'), '最快段带标签');
});

test('SC4 顶部右列：昵称与开始时间右对齐、与左列同一条水平中心线，昵称过长时省略号截断且不压到左侧距离数字', async () => {
  const long = '一二三四五六七八九十一二三四五六七八九十';
  const { c, ctx } = await mount({});
  const texts = ctx.texts();
  const nick = texts.find((t) => t.text === '小张');
  assert.equal(nick.align, 'right');
  assert.equal(nick.x, 300 - 16);
  const time = texts.find((t) => t.text === '2026/9/21 07:32');
  assert.ok(time && time.align === 'right');

  // 左右两列同轴：各取「首行墨迹顶 — 末行基线」的中点，模型与组件里一致（cap-height ≈ 0.72 字高）
  const pxOf = (t) => Number(/(\d+(?:\.\d+)?)px/.exec(t.font)[1]);
  const label = texts.find((t) => t.text === '户外跑步');
  const num = texts.find((t) => t.text === '5.21');
  const leftMid = (label.y - pxOf(label) * 0.72 + num.y) / 2;
  const rightMid = (nick.y - pxOf(nick) * 0.72 + time.y) / 2;
  assert.ok(
    Math.abs(leftMid - rightMid) < 1.5,
    `左右列中心没对齐：左 ${leftMid.toFixed(1)} vs 右 ${rightMid.toFixed(1)}`,
  );

  global.getApp = () => ({ globalData: { userInfo: { nickname: long } } });
  const again = await mount({});
  const drawn = again.ctx.texts().find((t) => t.text.startsWith('一二三四'));
  assert.ok(drawn.text.endsWith('…'), `超长昵称应截断，实际「${drawn.text}」`);
  const maxW = 300 - 16 * 2 - 100;
  assert.ok(textWidth(drawn.text, drawn.font) <= maxW, `截断后仍占 ${textWidth(drawn.text, drawn.font)}px > ${maxW}px`);
  global.getApp = () => ({ globalData: { userInfo: { nickname: '小张' } } });
  assert.ok(c.data.previewVisible);
});

test('SC5 底部：左 logo + 小程序名，右小程序码，三者同一条垂直中线且左侧够醒目', async () => {
  const { c, ctx } = await mount();
  const r = layoutOf(c).regions.footer;
  const mid = (r.top + r.bottom) / 2;
  const imgs = ctx.images();
  const logo = imgs.find((i) => i.src === '/assets/logo.png');
  const code = imgs.find((i) => i.src === '/assets/app_code.jpg');
  assert.ok(logo && code, `底部两张图都要画，实际 ${imgs.map((i) => i.src)}`);
  [logo, code].forEach((i) => assert.ok(i.y >= r.top && i.y + i.h <= r.bottom + 1));
  assert.equal(logo.w, logo.h, 'logo 画成正方形');
  assert.ok(logo.w >= 32, `logo 要和右侧 44 的码撑得住，实际 ${logo.w}`);
  assert.ok(Math.abs(logo.y + logo.h / 2 - mid) < 1, `logo 没垂直居中：${logo.y + logo.h / 2} ≠ ${mid}`);
  assert.ok(Math.abs(code.y + code.h / 2 - mid) < 1, `小程序码没垂直居中：${code.y + code.h / 2} ≠ ${mid}`);
  assert.ok(code.x + code.w <= 300 - 16 + 1 && code.x > 300 / 2, '小程序码贴右侧');
  const brand = ctx.texts().find((t) => t.text === '小迹一下');
  assert.ok(brand && brand.x > logo.x + logo.w, '小程序名在 logo 右侧');
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(brand.font)[1]);
  assert.ok(px >= 13, `小程序名字号偏小（12 压不住右侧 44 的码），实际 ${px}px`);
  // 基线 = 中线 + 0.35 字高（cap-height 近似），才算视觉居中
  assert.ok(Math.abs(brand.y - (mid + px * 0.35)) < 1.5, `文案没和码居中：基线 ${brand.y}，期望 ≈ ${mid + px * 0.35}`);
});

test('SC6 图片读不到只少画一张：日志留痕、海报照常生成并回传临时路径', async () => {
  const { c, ctx } = await mount({}, { '/assets/app_code.jpg': 'fail' });
  assert.ok(!ctx.images().some((i) => i.src === '/assets/app_code.jpg'));
  assert.ok(ctx.images().some((i) => i.src === '/assets/logo.png'), '另一张照常画');
  assert.deepEqual(toasts, [], '取图失败不该让整个海报生成失败');
  assert.equal(c.events[0].name, 'posterready');
});

test('SC7 无指标无分段（旧数据/游泳未算段）：两区标题不画，海报只剩标题+轨迹+底部', async () => {
  const { c, ctx } = await mount({ metrics: [], kmSegs: [] });
  const texts = ctx.texts();
  assert.ok(!texts.some((t) => t.text === '运动数据'));
  assert.ok(!texts.some((t) => t.text.startsWith('单段明细')));
  const L = layoutOf(c);
  assert.equal(L.height, POSTER.HEADER_H + POSTER.TRACK_H + POSTER.FOOTER_H + POSTER.BOTTOM_PAD);
  assert.equal(CURRENT_CANVAS.height, L.height * L.exportScale);
  assert.deepEqual(toasts, []);
});

test('SC8 轨迹区保持不变：公里标开关只影响画不画圆点，不动版面高度', async () => {
  const on = await mount({});
  const h1 = layoutOf(on.c).height;
  await on.c.toggleKmMarks({ detail: { value: false } });
  assert.equal(on.c.data.showKmMarks, false);
  assert.equal(layoutOf(on.c).height, h1, '关掉公里标不该改海报高度');
  assert.equal(on.canvas.height, h1 * layoutOf(on.c).exportScale, '重绘后仍是同一张版面');
});

test('SC9 单段明细：表头文字与首行文字到分隔线都要留白（灰线不贴字）', async () => {
  const { c, ctx } = await mount();
  const r = layoutOf(c).regions.segs;
  const texts = ctx.texts();

  const head = texts.find((t) => t.text === '#' && t.y < r.top + 60);
  assert.ok(head, '缺表头「#」');
  // 表头下的横向灰线：segs 区内、水平、颜色为分隔线色
  const divider = ctx.lines().find(
    (l) => l.strokeStyle === '#eef0f3' && l.from.y === l.to.y && l.from.y > r.top && l.from.y < r.bottom
  );
  assert.ok(divider, '缺表头下的分隔线');
  const row = texts.find((t) => t.text === '1' && t.x === head.x && t.y > divider.from.y);
  assert.ok(row, '缺第一段数据行');

  // 字宽模型：9px 表头墨迹下沿 ≈ 基线 + 0.21em；10px 行首墨迹上沿 ≈ 基线 − 0.72em(cap)
  const headInkBottom = head.y + 9 * 0.21;
  const rowInkTouTop = row.y - 10 * 0.72;
  const above = divider.from.y - headInkBottom;
  const below = rowInkTouTop - divider.from.y;
  assert.ok(above >= 3, `表头文字下沿到灰线的留白太小：${above.toFixed(2)}px`);
  assert.ok(below >= 6, `灰线到首行文字上沿的留白太小：${below.toFixed(2)}px`);
});
