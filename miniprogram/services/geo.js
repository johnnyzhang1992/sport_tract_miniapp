/**
 * 逆地理编码（决策：后端持 key 调用腾讯 WebService，前端不再暴露 key）
 * 统一走后端 GET /api/geo/reverse，失败/未配置时返回空字符串
 */
const api = require('./api');

/**
 * 逆地理编码：经纬度 → 地址
 * @returns {Promise<string>} 地址文本（失败/后端未配置返回 ''）
 */
async function reverseGeocode(latitude, longitude) {
  try {
    const res = await api.get('/geo/reverse', {
      lat: latitude,
      lng: longitude,
    });
    return (res && res.address) || '';
  } catch {
    return '';
  }
}

module.exports = { reverseGeocode };
