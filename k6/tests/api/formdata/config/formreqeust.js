// 存放一些公共函数

import { sendRequest, sendQueryRequest } from "../../common/request.js";

/**
 * @param {string} api
 * @param {object} payload  请求的数据
 * @param {string} tag   每个请求的标志位
 * @param {object} data 上下文的数据比如token
 * @returns {Object} 返回对象
*/
export function commonRequest(data, api, payload, tag) {
    const token = data.token
    let result = sendRequest(payload, api, tag, false, token)
    if (typeof result != 'object') {
        result = JSON.parse(result)
    }
    if (result && result !== null) {
        return result
    }
    return {}
}


/**
 * @param {string} api
 * @param {object} payload  请求的数据
 * @param {string} tag   每个请求的标志位
 * @param {object} data 上下文的数据比如token
 * @returns {Array} 返回数组
*/
export function commonRequest2(data, api, payload, tag) {
    const token = data.token
    let result = sendRequest(payload, api, tag, false, token)
    if (typeof result != 'object') {
        result = JSON.parse(result)
    }
    if (result && result.list.length > 0) {
        return result.list
    }
    return []
}


/**
 * @param {string} api
 * @param {object} payload  请求的数据
 * @param {string} tag   每个请求的标志位
 * @param {object} data 上下文的数据比如token
 * @returns {Array,object} 返回数组,对象
*/
export function commonRequest3(data, api, payload, tag) {
    const token = data.token
    let result = sendQueryRequest(payload, api, tag, false, token)
    if (typeof result != 'object') {
        result = JSON.parse(result)
    }
    if (result && result.list.length > 0 && result.summary) {
        return result.list, result.summary
    }
    return [], {}
}



