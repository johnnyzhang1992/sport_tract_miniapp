/** 点分版本按数值比较（'2.19.2' > '2.9.10'，字典序会算反）。缺段按 0 补。 */
function compareVersion(a, b) {
  const pa = String(a || '').split('.').map((n) => Number(n) || 0);
  const pb = String(b || '').split('.').map((n) => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** 虚拟支付要求的基础库版本（spec §2.1） */
const MIN_XPAY_SDK = '2.19.2';
/** iOS 端要求微信客户端版本（spec §2.1） */
const MIN_IOS_CLIENT = '8.0.68';

module.exports = { compareVersion, MIN_XPAY_SDK, MIN_IOS_CLIENT };
