import { AdminLogin, adminTag } from '../login/adminlogin.test.js';
import { hanlderThresholds } from '../../../config/thresholds.js';
import { loadConfigFromFile } from '../../../config/load.js';
import { createCoupons as couponLogic, couponTag } from '../activity/coupon.test.js';

// 以后加新用例只需在这里 import 即可

const loader = loadConfigFromFile();

// ==================== setup：全局登录一次 ====================
export function setup() {
  try {
    const token = AdminLogin();

    if (!token) {
      console.error('AdminLogin 返回空值，登录失败');
      throw new Error('AdminLogin 返回空 token');
    }

    console.log('AdminLogin 成功获取 token');
    return { token };
  } catch (error) {
    console.error('AdminLogin 发生异常:', error.message);
    throw new Error(`登录失败: ${error.message}`);
  }
}

const thresholds = {
  // 合并所有场景的阈值
  ...hanlderThresholds(adminTag),
  ...hanlderThresholds(couponTag)
};

// 优惠券场景函数（必须 export，且名字和 exec 一致）
export function createCoupons(data) {
  couponLogic(data); // 调用导入的真实逻辑，data 会自动注入 token
}

// ==================== scenarios 定义 ====================
export const options = {
  scenarios: {
    // 场景1：后台登录
    login: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1, // 只运行一次
      maxDuration: '10s'
    },
    // 优惠券的场景
    coupons: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      exec: 'createCoupons', // 注意：这里用函数名字符串
      startTime: '5s'
    }

    // giftpacks: {
    //   executor: 'shared-iterations',
    //   vus: 1,
    //   iterations: 1,
    //   exec: 'createGiftPacks',
    //   startTime: '20s'
    // }
    // 新用例直接加新场景即可
  },

  thresholds: thresholds, // 或按 tag 分开

  tags: {
    environment: loader.local.env,
    test_type: 'adminapi'
  }
};

// ==================== 必须的 default（多场景脚本要求） ====================
export default function () {
  // 不执行任何逻辑
  console.log('此脚本通过 scenarios 运行');
}

export function teardown(data) {
  // console.log('所有测试完成，返回数据:', data);
  if (data && data.error) {
    console.error('测试过程中发生错误:', data.error);
  }
}
