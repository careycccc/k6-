import { sendRequest } from '../common/request.js';
// 优惠券的创建
const api = '/api/Coupon/Add';
export const couponTag = 'coupon';

export function createCoupons(data) {
  // 必须接收 data 参数来拿 token
  const token = data.token;

  const couponList = [
    ['充值奖励优惠券004', 1, 0, '1'],
    ['奖励优惠004', 2, 1, '1,2']
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
    sendRequest(api, payload, couponTag, false, token);
  });
}
