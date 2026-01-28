import { fromOptions } from '../../formdata/config/config.js';
import { commonRequest5 } from '../../formdata/config/formreqeust.js';
import { groupByAndSum } from '../../common/common.js';

// 邀请转盘
let inviteTurntableInfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}
export const inviteTurntableTag = 'inviteTurntable'

/**
 * 邀请转盘的成功提现了的统计查询
 * @param {*} data 
 * @returns 
 */
export function queryInviteTurntable(data) {
    const api = 'api/InvitedWheel/GetPageListWithdrawRecord'
    const payload = {
        auditState: 2,
        startDay: fromOptions.startTime,
        endDay: fromOptions.endTime,
    }
    const result = commonRequest5(data, api, payload, inviteTurntableTag)

    inviteTurntableInfo.amountcountTotal = result.totalCount
    const groupResult = groupByAndSum(result.list, 'userId', 'withdrawAmount')
    inviteTurntableInfo.amount = groupResult.sum
    inviteTurntableInfo.amountUsercount = groupResult.count
    return inviteTurntableInfo
}

