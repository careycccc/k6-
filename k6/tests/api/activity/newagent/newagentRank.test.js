import { commonRequest5, commonRequest } from '../../formdata/config/formreqeust.js';
import { fromOptions } from '../../formdata/config/config.js';
import { logger } from '../../../../libs/utils/logger.js';
import { groupByAndSum } from '../../common/common.js';


let newagentRandInfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}
export const newagentRankTag = 'newagentRank'

// 新版返佣的排行榜的统计
export function queryNewagentRank(data) {
    const api = '/api/Rank/GetAgentRankAuditList'
    const payload = {
        rankDateMin: fromOptions.startTime,
        rankDateMax: fromOptions.endTime,
        state: 'Approved'
    }
    const result = commonRequest5(data, api, payload, newagentRankTag)
    if (!result || !result.list) {
        logger.info('新版返佣排行榜查询结果为空，跳过后续处理')
        return {}
    }

    newagentRandInfo.amountcountTotal = result.totalCount
    const groupResult = groupByAndSum(result.list, 'userId', 'rewardAmount')
    newagentRandInfo.amountUsercount = groupResult.count
    newagentRandInfo.amount = groupResult.sum
    return newagentRandInfo
}