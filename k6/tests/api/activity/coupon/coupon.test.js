import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { sleep } from 'k6';
// 用于收集 优惠券ID
export const couponIds = [];
// 优惠券的创建
export const couponTag = 'coupon';

// 创建优惠券
export function createCoupons(data) {
  const api = '/api/Coupon/Add';
  // 必须接收 data 参数来拿 token
  const token = data.token;

  const couponList = [
    ['充值奖励优惠券011', 1, 0, '1'],
    ['奖励优惠券011', 2, 1, '1,2']
  ];

  couponList.forEach(([couponName, couponType, rechargeCount, useConditionType]) => {
    const payload = {
      backstageDisplayName: couponName,
      translations: [
        { language: 'hi', name: couponName, description: couponName },
        { language: 'en', name: couponName, description: couponName },
        { language: 'zh', name: couponName, description: couponName }
      ],
      couponType,
      rewardConfig: {
        isFixedAmount: true,
        amountOrRatio: 100,
        amountLimit: 0,
        amountCodingMultiple: 2,
        spinType: null,
        freeSpinCount: 0,
        giftCouponIds: []
      },
      rechargeAmount: 100,
      rechargeCount,
      validBetAmount: 0,
      validBetConfig: null,
      validDays: 7,
      useConditionType,
      giftSelfLoop: false
    };
    sendRequest(payload, api, couponTag, false, token);
  });
}

// 查询优惠券ID列表（不启用）
export function queryCouponIds(data) {
  // 必须接收 data 参数来拿 token
  const token = data.token;
  // 优惠券的查询
  const api = '/api/Coupon/GetPageList';
  const payload = {};
  let result = sendQueryRequest(payload, api, couponTag, false, token);
  if (typeof result !== 'object') {
    result = JSON.parse(result);
  }
  const idList = [];
  if (result && result.list && result.list.length > 0) {
    // 处理获取到的优惠券列表
    result.list.forEach((item) => {
      idList.push(item.id);
      // 收集优惠券ID
      couponIds.push(item.id);
    });
  }
  return idList;
}

// 优惠券的启用
export function startCoupons(data) {
  // 必须接收 data 参数来拿 token
  const token = data.token;
  // 查询优惠券ID列表
  const idList = queryCouponIds(data);
  // 启动优惠券
  idList.forEach((id) => {
    //logger.info(`启用优惠券 ID: ${id}`);
    //睡眠1s
    sleep(1);
    startCouponsById(id, token);
  });
}

// 优惠券的启用
export function startCouponsById(id, token) {
  const api = '/api/Coupon/UpdateState';
  const payload = {
    state: 1,
    id: id
  };
  sendRequest(payload, api, couponTag, false, token);
}



