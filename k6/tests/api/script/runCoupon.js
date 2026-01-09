import { AdminLogin, adminTag } from '../login/adminlogin.test.js';
import { hanlderThresholds } from '../../../config/thresholds.js';
import { loadConfigFromFile } from '../../../config/load.js';
import { createCoupons as couponFunc, couponTag, startCoupons as startCouponsFunc } from '../activity/coupon.test.js';
import { handleSummary as requestHandleSummary } from '../common/request.js';
import { couponIds } from '../activity/coupon.test.js';

//优惠券的创建和启用
const loader = loadConfigFromFile();

// ==================== setup：全局登录一次 ====================
export function setup() {
  try {
    const token = AdminLogin();

    if (!token) {
      console.error('AdminLogin 返回空值，登录失败');
      throw new Error('AdminLogin 返回空 token');
    }
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
  couponFunc(data); // 调用导入的真实逻辑，data 会自动注入 token
}

export function startCoupons(data) {
  startCouponsFunc(data);
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
      startTime: '3s'
    },
    // 启动优惠券的场景
    startCoupons: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      exec: 'startCoupons', // 注意：这里用函数名字符串
      startTime: '8s'
    }

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

export function handleSummary(data) {
  // 调试：打印couponIds数组信息
  console.log('=== 开始生成CSV文件 ===');
  console.log('couponIds数组长度:', couponIds.length);
  console.log('couponIds内容:', couponIds);

  // 将优惠券ID数组转换为CSV格式的字符串，添加标题行
  const csvContent = 'CouponID\n' + couponIds.join('\n');
  console.log('CSV内容长度:', csvContent.length);
  console.log('CSV内容预览:', csvContent.substring(0, 200));

  // 合并优惠券CSV和request.js的handleSummary返回值
  const requestSummary = requestHandleSummary(data);
  console.log('requestSummary键值:', Object.keys(requestSummary));

  const result = {
    'coupon_ids.csv': csvContent,
    ...requestSummary,
  };

  console.log('=== handleSummary返回的文件列表 ===');
  console.log('文件列表:', Object.keys(result));

  return result;
}



