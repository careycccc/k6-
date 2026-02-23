import { commonRequest5, commonRequest } from '../../formdata/config/formreqeust.js';
import { fromOptions } from '../../formdata/config/config.js';
import { logger } from '../../../../libs/utils/logger.js';
import { groupByAndSum } from '../../common/common.js';


let newagentInfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}

// 新版返佣的的查询
export const newagentTag = 'newagent'


/**
 * 新版返佣的返佣查询
*/
export function queryNewagent(data) {
    const api = '/api/AgentL3/GetPageListRebateList'
    const payload = {
        reportDate: fromOptions.reportTime
    }
    const result = commonRequest5(data, api, payload, newagentTag)
    if (!result || !result.list) {
        logger.info('新版返佣查询结果为空，跳过后续处理', result)
        return {}
    }
    // if (!result || !result.list.list) {
    //     logger.error('新版返佣的查询result.list为null')
    //     return {}
    // }
    // 总返佣数据
    let newagentTotal = 0
    // 返佣人数统计
    let newagentCount = 0
    result.list.forEach(ele => {
        if (ele.totalCommission > 0) {
            newagentTotal += ele.totalCommission
            newagentCount++
        }
    });

    newagentInfo.amount = newagentTotal.toFixed(2)
    newagentInfo.amountUsercount = newagentCount
    newagentInfo.amountcountTotal = newagentCount
    return newagentInfo
}