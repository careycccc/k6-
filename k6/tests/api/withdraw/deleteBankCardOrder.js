/**
 * 银行卡删除工单（半自动类型，workOrderTypeId:14）
 *
 * 2026-11-03 关键发现：提交工单时 formFields 里 BankAccountNumber 这个字段的
 * fieldValue，正确格式必须是 "{钱包记录id}|{卡号}"（钱包记录id 取自 GetWallet 返回的
 * usersWalletbankList[].id），不能只传纯卡号——否则提交接口本身返回成功，工单也能被
 * 正常锁定/审批，但 DeleteUserBank 会因为从 jsonData 里解析不出钱包记录 id 而报
 * "Param is Invalid"，钱包记录不会被真正删除。排查过程中曾怀疑过 remark 格式、
 * 操作顺序、锁定后的等待时间、操作账号权限（租户后台 vs 集团后台主管账号）等好几轮，
 * 最终确认都不是根因，就是这个字段格式传错了——不是后端 bug，是调用方传参问题。
 * 银行卡允许同一用户同时绑定多张（绑定数量上限通常>1），必须靠 recordId 精确定位
 * 删哪一条，这是和电子钱包（上限1，不挑 fieldValue）的关键差异，具体对比见
 * deleteWalletOrderCore.js 的说明。
 *
 * 通用流程骨架（提交→锁定→执行删除→审批收尾）已提炼到 deleteWalletOrderCore.js，
 * 本文件只是针对银行卡这个类型的参数化封装。
 */
import { submitDeleteWalletOrder, approveAndExecuteDeleteWalletOrder } from './deleteWalletOrderCore.js';

const TAG = 'DeleteBankCardOrder';
const WORK_ORDER_TYPE_ID = 14; // 删除银行卡半自动
const DELETE_API = '/api/WorkOrder/DeleteUserBank';

/**
 * 会员前台发起"删除银行卡"工单申请
 * @param {string} userToken  - 会员token
 * @param {string} adminToken - 后台token（仅用于查表单配置，不用于提交本身）
 * @param {string|number} recordId - 钱包记录本身的id（GetWallet 返回的 usersWalletbankList[].id）
 * @param {string} cardNo - 银行卡号
 * @returns {boolean}
 */
export function submitDeleteBankCardOrder(userToken, adminToken, recordId, cardNo) {
    return submitDeleteWalletOrder(userToken, adminToken, WORK_ORDER_TYPE_ID, 'BankAccountNumber', `${recordId}|${cardNo}`, TAG);
}

/**
 * 后台查找该会员最新的"删除银行卡"待处理工单，并真正执行删除（锁定→DeleteUserBank→审批）
 *
 * 注意：假设该 userId 当前只有一条待处理工单——如果账号有历史残留的其他待处理工单，
 * pending[0] 不一定是我们刚提交的这条。
 *
 * @param {string} adminToken
 * @param {number} userId
 * @returns {boolean}
 */
export function approveAndExecuteDeleteBankCard(adminToken, userId) {
    return approveAndExecuteDeleteWalletOrder(adminToken, userId, DELETE_API, TAG);
}
