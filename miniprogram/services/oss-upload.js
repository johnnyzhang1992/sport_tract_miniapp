/**
 * 照片直传 OSS（决策 D12：STS 临时凭证直传，前端不持有长期密钥）
 * 流程：POST /api/oss/sts 拿临时凭证 → wx.uploadFile 直传
 * OSS 未配置（后端 503）时降级：返回 null（打点不带照片）
 */
const api = require('./api');

function extOf(path) {
  const m = /\.(\w+)$/.exec(path || '');
  return m ? m[1].toLowerCase() : 'jpg';
}

/**
 * 上传临时文件到 OSS
 * @param {string} tempFilePath wx.chooseMedia 返回的临时路径
 * @returns {Promise<string|null>} OSS URL（失败/未配置返回 null）
 */
async function uploadPhoto(tempFilePath) {
  try {
    const creds = await api.post('/oss/sts', { dir: 'markers' });
    const filename = `marker_${Date.now()}_${Math.floor(Math.random() * 10000)}.${extOf(tempFilePath)}`;
    const key = `${creds.dir}${filename}`;
    const url = `${creds.endpoint.replace(/\/$/, '')}/${key}`;

    const res = await new Promise((resolve, reject) => {
      wx.uploadFile({
        url: `${creds.endpoint.replace(/\/$/, '')}/${key}`,
        filePath: tempFilePath,
        name: 'file',
        formData: {
          key,
          OSSAccessKeyId: creds.accessKeyId,
          policy: '',
          signature: '',
          'x-oss-security-token': creds.securityToken,
          success_action_status: '200',
        },
        success: (r) => resolve(r),
        fail: (e) => reject(e),
      });
    });

    if (res.statusCode === 200) return url;
    console.warn('[oss] 直传失败', res.statusCode, res.data);
    return null;
  } catch (e) {
    console.warn('[oss] 上传跳过（OSS 未配置或失败）:', e.message);
    return null;
  }
}

module.exports = { uploadPhoto };
