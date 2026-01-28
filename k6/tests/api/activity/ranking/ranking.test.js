import { fromOptions } from '../../formdata/config/config.js';
import { commonRequest5 } from '../../formdata/config/formreqeust.js';

export const rankingTag = 'ranking'


/**
 * 查询会员排行榜的审核通过了的数据
*/
export function queryRanking(data) {
    const api = 'api/Rank/GetUserRankAuditList'
    const payload = {
        rankDateMin: fromOptions.startTime,
        rankDateMax: fromOptions.endTime,
        rankType: 1,  // 1:日榜 2:周榜 3:月榜
        state: 'Approved'
    }
    const result = commonRequest5(data, api, payload, rankingTag)
    console.log(result)
}

