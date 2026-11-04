/**
 * USDT删除工单（半自动类型，workOrderTypeId:13）
 *
 * 2026-11-03 实测确认：/api/WorkOrder/DeleteUserUsdt 真正执行删除，fieldValue 按
 * "{钱包记录id}|{USDT地址}" 格式提交已验证能成功删除。注意：当时测试账号只有1条
 * USDT记录，不能100%确认这个格式对USDT是否"必需"（也可能和电子钱包一样不挑剔），
 * 这里保守起见统一按银行卡同样的规范传递。
 */
import { submitDeleteWalletOrder, approveAndExecuteDeleteWalletOrder } from './deleteWalletOrderCore.js';

const TAG = 'DeleteUsdtOrder';
const WORK_ORDER_TYPE_ID = 13; // 删除USDT半自动
const DELETE_API = '/api/WorkOrder/DeleteUserUsdt';

/**
 * 会员前台发起"删除USDT"工单申请
 * @param {string} userToken
 * @param {string} adminToken - 后台token（仅用于查表单配置）
 * @param {string|number} recordId - 钱包记录本身的id（GetWallet 返回的 usersWalletVirtualCurrencyList[].id）
 * @param {string} address - USDT地址
 * @returns {boolean}
 */
export function submitDeleteUsdtOrder(userToken, adminToken, recordId, address) {
    return submitDeleteWalletOrder(userToken, adminToken, WORK_ORDER_TYPE_ID, 'UsdtAddress', `${recordId}|${address}`, TAG);
}

/**
 * 后台查找该会员最新的"删除USDT"待处理工单，并真正执行删除（锁定→DeleteUserUsdt→审批）
 * @param {string} adminToken
 * @param {number} userId
 * @returns {boolean}
 */
export function approveAndExecuteDeleteUsdt(adminToken, userId) {
    return approveAndExecuteDeleteWalletOrder(adminToken, userId, DELETE_API, TAG);
}
