/**
 * 网络层（决策：统一请求封装 + JWT 注入 + 401 静默刷新重试）
 * 后端响应约定：{ success, code, message, data }（与 sport_track_api 一致）
 */
const config = require('../config/index');
const storage = require('./storage');

let refreshing = false;
let refreshWaiters = [];

/** 原生请求（不含鉴权逻辑） */
function rawRequest({ url, method = 'GET', data, header = {} }) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.API_BASE_URL + url,
      method,
      data,
      header: Object.assign({ 'Content-Type': 'application/json' }, header),
      timeout: 15000,
      success: (res) => {
        const body = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300 && body.success) {
          resolve(body.data);
        } else {
          const err = new Error(body.message || `请求失败(${res.statusCode})`);
          err.statusCode = res.statusCode;
          err.code = body.code;
          reject(err);
        }
      },
      fail: () => {
        const err = new Error('网络请求失败，请检查后端服务是否启动');
        err.statusCode = 0;
        reject(err);
      },
    });
  });
}

function authHeader(extra = {}) {
  const token = storage.getToken();
  return Object.assign(
    {},
    token && token.accessToken ? { Authorization: `Bearer ${token.accessToken}` } : {},
    extra,
  );
}

/** 静默刷新：并发请求只刷新一次，其余等待同一结果 */
function refreshToken() {
  const token = storage.getToken();
  if (!token || !token.refreshToken) {
    return Promise.reject(new Error('未登录'));
  }
  if (!refreshing) {
    refreshing = true;
    rawRequest({
      url: '/auth/refresh',
      method: 'POST',
      data: { refreshToken: token.refreshToken },
    })
      .then((data) => {
        storage.setToken(data.accessToken, data.refreshToken);
        refreshWaiters.forEach((w) => w.resolve());
      })
      .catch((e) => {
        storage.clearToken();
        refreshWaiters.forEach((w) => w.reject(e));
      })
      .finally(() => {
        refreshing = false;
        refreshWaiters = [];
      });
  }
  return new Promise((resolve, reject) => {
    refreshWaiters.push({ resolve, reject });
  });
}

/**
 * 统一请求入口
 * @param {object} opts
 * @param {string} opts.url        相对路径（如 '/activities'）
 * @param {string} [opts.method]   GET/POST/PUT/DELETE
 * @param {object} [opts.data]     请求体
 * @param {boolean} [opts.skipAuth] 跳过鉴权头（登录/刷新接口）
 */
async function request(opts) {
  try {
    return await rawRequest({
      url: opts.url,
      method: opts.method,
      data: opts.data,
      header: opts.skipAuth ? {} : authHeader(),
    });
  } catch (err) {
    // 401 → 刷新 token 后重试一次
    if (!opts.skipAuth && err.statusCode === 401) {
      try {
        await refreshToken();
        return await rawRequest({
          url: opts.url,
          method: opts.method,
          data: opts.data,
          header: authHeader(),
        });
      } catch (refreshErr) {
        // 刷新失败 → 全局登出
        const app = getApp();
        if (app && typeof app.logout === 'function') app.logout();
        throw refreshErr;
      }
    }
    throw err;
  }
}

function get(url, data) {
  return request({ url, method: 'GET', data });
}

function post(url, data) {
  return request({ url, method: 'POST', data });
}

function put(url, data) {
  return request({ url, method: 'PUT', data });
}

function del(url, data) {
  return request({ url, method: 'DELETE', data });
}

/**
 * 图片合规检测（微信 imgSecCheck，服务端调用）
 * 直传 OSS 前调用：检测通过再上传
 * @returns {Promise<{risky: boolean, skipped?: boolean, errcode?: number}>}
 */
function checkImage(filePath) {
  return new Promise((resolve, reject) => {
    const token = storage.getToken();
    wx.uploadFile({
      url: config.API_BASE_URL + '/users/check-image',
      filePath,
      name: 'file',
      header: token && token.accessToken ? { Authorization: `Bearer ${token.accessToken}` } : {},
      success: (res) => {
        try {
          const body = JSON.parse(res.data || '{}');
          if (res.statusCode === 200 && body.success) {
            resolve(body.data);
          } else {
            reject(new Error(body.message || '检测失败'));
          }
        } catch {
          reject(new Error('检测服务响应异常'));
        }
      },
      fail: () => reject(new Error('检测请求失败')),
    });
  });
}

module.exports = { request, get, post, put, del, checkImage };
