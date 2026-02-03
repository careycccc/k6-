import { commonRequest3 } from '../../formdata/config/formreqeust.js';
import { stringToTimestamp } from '../../formdata/config/config.js';
import { groupByAndSum } from '../../common/common.js';
import { logger } from '../../../../libs/utils/logger.js';

//超级大奖
export const megaJackpotTag = 'MegaJackpot'


let megaJackpoInfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}

/**
 * 查询超级大奖的领取的信息，领奖金额，领奖人数，总共领奖多少次
 * 
 */
export function queryMegaJackpot(data) {
    const api = '/api/BigJackpot/GetRecordPageList'

    const payload = {
        timeType: 4, // 领取时间
        startTime: stringToTimestamp.starttime,
        endTime: stringToTimestamp.endtime,
        pageSize: 200
    }
    const result = commonRequest3(data, api, payload, megaJackpotTag)
    if (!result || !result.list) {
        logger.error('超级大奖查询失败', result)
        return {}
    }
    megaJackpoInfo.amountcountTotal = result.totalCount || 0;
    megaJackpoInfo.amount = result.summary.totalBonusAmount || 0;
    const groupResult = groupByAndSum(result.list, 'userId', 'awardAmount')
    megaJackpoInfo.amountUsercount = groupResult.count || 0;
    return megaJackpoInfo
}