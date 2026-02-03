import { fromOptions } from '../../formdata/config/config.js';
import { commonRequest5 } from '../../formdata/config/formreqeust.js';
import { groupByAndSum } from '../../common/common.js';
import { logger } from '../../../../libs/utils/logger.js';

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
    if (!result || !result.list) {
        logger.error('邀请转盘查询失败', result)
        return {}
    }
    inviteTurntableInfo.amountcountTotal = result.totalCount || 0;
    const groupResult = groupByAndSum(result.list, 'userId', 'withdrawAmount')
    inviteTurntableInfo.amount = groupResult.sum || 0;
    inviteTurntableInfo.amountUsercount = groupResult.count || 0;
    //console.log(inviteTurntableInfo)
    return inviteTurntableInfo
}

