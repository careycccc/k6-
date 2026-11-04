/**
 * 电子钱包删除工单（半自动类型，workOrderTypeId:16）
 *
 * 2026-11-03 实测确认：/api/WorkOrder/DeleteElectronicWallet 真正执行删除。特别
 * 注意——电子钱包绑定数量上限通常为1（同一用户同时只会有0或1条记录），实测即使
 * fieldValue 传错误值（比如 undefined）依然能成功删除，推测是接口只靠 workOrderId
 * 关联的用户直接删掉其名下唯一的那条记录，不需要靠 fieldValue 做区分——这点和银行卡/
 * USDT（允许同时绑定多条，必须精确指定）不一样。本模块依然统一按规范格式传递，不
 * 依赖这个"容错"特性，避免以后绑定数量上限配置变化导致行为不一致。
 *
 * 另外，电子钱包记录没有"账号"这个字段，它的标识是 electronicName（GetWallet 返回
 * 的 usersWalletElectronicWalletList[].electronicName，示例值类似 "ceshiyong"，和
 * bankCode 同义），不是 accountNo/account。
 */
import { submitDeleteWalletOrder, approveAndExecuteDeleteWalletOrder } from './deleteWalletOrderCore.js';

const TAG = 'DeleteEWalletOrder';
const WORK_ORDER_TYPE_ID = 16; // 删除电子钱包半自动
const DELETE_API = '/api/WorkOrder/DeleteElectronicWallet';

/**
 * 会员前台发起"删除电子钱包"工单申请
 * @param {string} userToken
 * @param {string} adminToken - 后台token（仅用于查表单配置）
 * @param {string|number} recordId - 钱包记录本身的id（GetWallet 返回的 usersWalletElectronicWalletList[].id）
 * @param {string} electronicName - 电子钱包标识（注意不是accountNo，是 electronicName 字段）
 * @returns {boolean}
 */
export function submitDeleteEWalletOrder(userToken, adminToken, recordId, electronicName) {
    return submitDeleteWalletOrder(userToken, adminToken, WORK_ORDER_TYPE_ID, 'EWallet', `${recordId}|${electronicName}`, TAG);
}

/**
 * 后台查找该会员最新的"删除电子钱包"待处理工单，并真正执行删除（锁定→DeleteElectronicWallet→审批）
 * @param {string} adminToken
 * @param {number} userId
 * @returns {boolean}
 */
export function approveAndExecuteDeleteEWallet(adminToken, userId) {
    return approveAndExecuteDeleteWalletOrder(adminToken, userId, DELETE_API, TAG);
}
