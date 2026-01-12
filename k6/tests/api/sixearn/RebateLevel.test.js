import { sendRequest } from "../common/request.js";
import { isNonEmptyArray } from "../../utils/utils.js";
import { logger } from '../../../libs/utils/logger.js';
// 查询后台六级代理配置

export const adminsixearnTag = 'adminsixearn';

/**
 * 查询返佣等级配置
 * @returns {Array} 返佣等级配置
*/
export function RebateLevel(data) {
    const api = '/api/RebateLevel/GetList'
    const result = LevelCommon(data, api)
    console.log('返佣等级配置---', result)
    if (isNonEmptyArray(result)) {
        return result
    } else {
        logger.error('返佣等级配置没有查询到结果', result);
    }
}

/**
 * 返佣汇率配置
 * @returns {Array} 返佣汇率配置
*/
export function RebateLevelRate(data) {
    const api = '/api/RebateLevelRate/GetList'
    const result = LevelCommon(data, api)
    console.log(result)
    if (isNonEmptyArray(result)) {
        return result
    } else {
        logger.error('返佣等级配置没有查询到结果', result);
    }
}

// 辅助函数用于抽离公共查询逻辑
export function LevelCommon(data, api) {
    const token = data.token
    const payload = {}
    let result = sendRequest(payload, api, adminsixearnTag, false, token)
    if (typeof result != 'object') {
        result = JSON.parse(result)
    }

    if (result && result.data) {
        return result.data
    }
    return result
}