/**
 * 位置权限引导（决策：首页预检 + 记录页兜底共用同一套引导逻辑）
 *
 * 微信机制（重要）：
 * - 首次调用定位相关接口时弹授权框；已授权 → 直接调用；已拒绝 → 不弹窗直接 fail（只能引导去设置页）
 * - iOS 后台定位授权（scope.userLocationBackground）：用 wx.authorize 弹窗不可靠（体验版实测不弹），
 *   但**首次调用 wx.startLocationUpdateBackground 会触发系统弹窗**（「使用小程序时 / 使用小程序时和离开后 / 不允许」）
 * - 因此：优先通过 startLocationUpdateBackground 触发弹窗，用户选「离开后允许」= 一次覆盖前后台；
 *   拒绝/不支持 → 降级请求前台 scope.userLocation
 * - 无权限 = 无法记录轨迹，必须做好引导，否则用户会卡住
 */

/** 请求前台定位授权（scope.userLocation，wx.authorize 可靠弹窗） */
function authorizeForeground(check, resolve) {
  wx.getSetting({
    success: (res) => {
      const fg = res.authSetting['scope.userLocation'];
      if (fg === undefined) {
        wx.authorize({
          scope: 'scope.userLocation',
          success: () => resolve(true),
          fail: () => guideToSetting(check, resolve),
        });
      } else if (fg) {
        resolve(true);
      } else {
        guideToSetting(check, resolve); // 已拒绝：引导去设置
      }
    },
    fail: () => resolve(false),
  });
}

/**
 * 确保已获得位置权限（前台 scope.userLocation）
 * 优先：调 startLocationUpdateBackground 触发后台授权弹窗（iOS 含「离开后允许」，一次覆盖前后台）
 * 拒绝/不支持 → 降级请求前台
 * @returns {Promise<boolean>} 前台定位是否可用
 */
function ensureLocationAuth() {
  return new Promise((resolve) => {
    // 运动开始前：用 wx.getAppAuthorizeSetting() 判断位置总授权状态（同步返回，比 getSetting 直接）
    // locationAuthorized: 'authorized' | 'denied' | 'not determined'
    if (wx.getAppAuthorizeSetting) {
      const auth = wx.getAppAuthorizeSetting();
      const st = auth.locationAuthorized;
      if (st === 'authorized') {
        resolve(true);
        return;
      }
      if (st === 'denied') {
        guideToSetting(null, resolve); // 系统设置已拒绝：引导去设置
        return;
      }
      // 'not determined'：未决定 → 先弹用途说明，再触发授权（后台弹窗，iOS 含「离开后允许」）
      wx.showModal({
        title: '定位权限说明',
        content: '运动记录需要前台和后台定位权限，用于记录轨迹',
        showCancel: false,
        confirmText: '知道了',
        success: () => triggerBackground(resolve),
        fail: () => triggerBackground(resolve),
      });
    } else {
      // 低版本基础库无 getAppAuthorizeSetting：退回 getSetting 判断
      const check = () => {
        wx.getSetting({
          success: (res) => {
            if (res.authSetting['scope.userLocation']) resolve(true);
            else guideToSetting(check, resolve);
          },
          fail: () => resolve(false),
        });
      };
      check();
    }
  });
}

/** 触发后台授权弹窗（iOS「使用期间/离开后/不允许」）；失败/不支持降级请求前台 */
function triggerBackground(resolve) {
  if (wx.startLocationUpdateBackground) {
    wx.startLocationUpdateBackground({
      type: 'gcj02',
      success: () => {
        wx.stopLocationUpdate(); // 预检只需授权，停掉定位
        resolve(true);
      },
      fail: () => {
        // 后台被拒 / 不支持：降级请求前台（wx.authorize 弹前台框）
        authorizeForeground(null, resolve);
      },
    });
  } else {
    authorizeForeground(null, resolve);
  }
}

/** 引导去设置：openSetting 返回后重查；仍未开启则再引导（用户可点「暂不」退出） */
function guideToSetting(check, resolve) {
  wx.showModal({
    title: '需要位置权限',
    content: '本小程序需要您的位置信息（经纬度、海拔）来记录运动轨迹、统计运动距离与配速，并展示运动所在地点。没有位置权限将无法记录运动轨迹，请在设置中开启「位置信息」',
    confirmText: '去设置',
    cancelText: '暂不',
    success: (res) => {
      if (res.confirm) {
        wx.openSetting({
          complete: () => {
            wx.getSetting({
              success: (r) => {
                if (r.authSetting['scope.userLocation']) {
                  resolve(true);
                } else {
                  guideToSetting(check, resolve); // 仍未开启：再引导（用户可点暂不退出）
                }
              },
              fail: () => resolve(false),
            });
          },
        });
      } else {
        resolve(false);
      }
    },
    fail: () => resolve(false),
  });
}

module.exports = { ensureLocationAuth };
