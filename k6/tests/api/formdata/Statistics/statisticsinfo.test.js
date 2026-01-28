import { Statisticstag } from './Statistics.test.js';
import { commonRequest3 } from '../config/formreqeust.js';
import { fromOptions } from '../config/config.js';
import { getMaxFourElements } from '../config/formreqeust.js';

const start = fromOptions.startTime
const end = fromOptions.endTime

const payload = {
    start,
    end,
    dateType: 1,  // 1表示按日查询
    pageSize: 200
}

/**
 * 会员充值通道统计
 * 充值通道前四的详细按钮里面的
 * @returns {object} 返回前4的对象和一个总计
*/

export function GetPageListRptDataSummaryRechargeSumarry(data) {
    const api = 'api/RptDataSummary/GetPageListRptDataSummaryRechargeSumarry'
    return commonFunc(data, api, 'amount')
}

/**
 * 提现通道详情
 */
export function GetPageListRptDataSummaryWithdrawSumarry(data) {
    const api = '/api/RptDataSummary/GetPageListRptDataSummaryWithdrawSumarry'
    return commonFunc(data, api, 'amount')
}

/**
 * 平台前4详情
*/
export function GetPageListRptDataSummaryGameSumarry(data) {
    const api = '/api/RptDataSummary/GetPageListRptDataSummaryGameSumarry'
    return commonFunc(data, api, 'betAmount')
}

/**
 * 子游戏前4
*/
export function GetPageListRptDataSummaryGameTypeSumarry(data) {
    const api = '/api/RptDataSummary/GetPageListRptDataSummaryGameTypeSumarry'
    return commonFunc(data, api, 'betAmount')
}

/**
 * 活动前4详情
*/
export function GetPageListRptDataSummaryActivitySumarry(data) {
    const api = 'api/RptDataSummary/GetPageListRptDataSummaryActivitySumarry'
    return commonFunc(data, api, 'amount')
}

/**
 * 公共函数
 */
function commonFunc(data, api, str) {
    let { list, summary } = commonRequest3(data, api, payload, Statisticstag)
    if (list.length > 0) {
        const arr = getMaxFourElements(list, str)
        return {
            arr,
            summary
        }
    } else {
        return {}
    }
}


