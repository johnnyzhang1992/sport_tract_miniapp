/**
 * 支付编排：wx.login 取新 code → 服务端建单 → wx.requestVirtualPayment → 轮询自家订单状态。
 *
 * 三条不可省：
 * 1) code 每次现取（session_key 用完即弃，复用登录时的旧会话会撞 -15007）；
 * 2) signData 原样透传给 requestVirtualPayment，绝不 JSON.parse 再 stringify（改了字节＝-15006）；
 * 3) success 回调不能当发货依据（杀进程/切后台会丢），以订单状态轮询为准（spec §2.4）。
 */
const api = require('../services/api');

const POLL_MAX = 12; // 最多 12 次
const POLL_BASE_MS = 1000; // 1s 起，退避到 4s 封顶
const POLL_CAP_MS = 4000;

function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (r) => resolve(r.code),
      fail: (e) => reject(new Error((e && e.errMsg) || '获取登录凭证失败')),
    });
  });
}

function requestVirtualPayment(payData) {
  return new Promise((resolve, reject) => {
    wx.requestVirtualPayment({
      signData: payData.signData,
      paySig: payData.paySig,
      signature: payData.signature,
      mode: 'short_series_goods',
      env: 0,
      success: (r) => resolve(r),
      fail: (e) => reject(e),
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 轮询自己的服务器；拿到 delivered 就带回刷新后的权益 */
async function pollOrder(outTradeNo, opts) {
  const max = (opts && opts.max) || POLL_MAX;
  let last = null;
  for (let i = 0; i < max; i++) {
    await sleep(Math.min(POLL_BASE_MS * Math.pow(2, Math.min(i, 2)), POLL_CAP_MS));
    last = await api.get(`/member/order/${outTradeNo}`);
    if (last && (last.status === 'delivered' || last.status === 'refunding' || last.status === 'refunded')) return last;
    if (last && last.status === 'closed') return last;
  }
  return last;
}

/** 错误码 → 具体提示（对象 + 实际值 + 建议动作，spec §9） */
function payFailCopy(e) {
  const code = Number(e && (e.errCode != null ? e.errCode : e.errcode));
  if (code === -15014) return '道具尚未生效，请几分钟后再试';
  if (code === -15007) return '登录已过期，请重新进入会员页后再购买';
  if (code === -15005 || code === -15006) return `支付校验失败（错误码 ${code}），请更新微信后重试`;
  return `支付未完成（${(e && (e.errMsg || e.message)) || '未知原因'}）`;
}

/**
 * 完整一次购买。返回形态供页面直接映射到 toast（不抛业务错，页面不用 try/catch 认文案）。
 * cancelled：用户主动取消（不算失败，不提示错误）
 * pending：支付动作成功但服务端还没确认发货（提示 MC-17，别重复扣款话术）
 */
async function payForMember(productKey, info) {
  const platform = (info && info.platform) || '';
  const code = await wxLogin();
  let order;
  try {
    order = await api.post('/member/order', { productKey, code, channel: platform === 'ios' ? 'ios' : 'android' });
  } catch (e) {
    return { status: 'failed', message: (e && e.message) || '下单失败，请稍后再试' };
  }

  try {
    await requestVirtualPayment(order.payData);
  } catch (e) {
    const errMsg = (e && (e.errMsg || e.message)) || '';
    if (/cancel|用户取消/i.test(errMsg)) return { status: 'cancelled' };
    return { status: 'failed', message: payFailCopy(e) };
  }

  const final = await pollOrder(order.outTradeNo).catch(() => null);
  if (final && final.status === 'delivered') {
    return { status: 'delivered', entitlements: final.entitlements, order: final };
  }
  return { status: 'pending', outTradeNo: order.outTradeNo };
}

module.exports = { payForMember, pollOrder, requestVirtualPayment, wxLogin, payFailCopy, POLL_MAX };
