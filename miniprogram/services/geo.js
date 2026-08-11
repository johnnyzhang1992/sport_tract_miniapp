/**
 * 地理编码封装（QQMapWX，决策：仅用于逆地理编码/POI 数据服务）
 * TENCENT_MAP_KEY 未配置时优雅降级（返回空字符串）
 */
const config = require('../config/index');

let geo = null;
let loaded = false;

function getGeo() {
  if (!loaded) {
    loaded = true;
    if (config.TENCENT_MAP_KEY) {
      try {
        const QQMapWX = require('qqmap-wx-jssdk');
        geo = new QQMapWX({ key: config.TENCENT_MAP_KEY });
      } catch {
        geo = null;
      }
    }
  }
  return geo;
}

/**
 * 逆地理编码：经纬度 → 地址
 * @returns {Promise<string>} 地址文本（未配置/失败返回 ''）
 */
function reverseGeocode(latitude, longitude) {
  return new Promise((resolve) => {
    const q = getGeo();
    if (!q) return resolve('');
    q.reverseGeocoder({
      location: { latitude, longitude },
      success: (res) => resolve((res && res.result && res.result.address) || ''),
      fail: () => resolve(''),
    });
  });
}

module.exports = { reverseGeocode };
