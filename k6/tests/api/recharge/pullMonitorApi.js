/**
 * 拉单监控（充值拉单黑名单）后台接口封装
 *
 * 两个接口：
 *   GetPageList  查监控名单（该 userId 有记录 = 已进入拉单监控/风控中）
 *   SetLimitTime 设置限制时长（分钟）；正式启动前台拦截
 *
 * 规则要点（来自后台实测）：
 *   - 单日「当前 Wait 状态订单数 > 阈值(默认5)」→ 后台每 10 分钟轮询一次，轮询到才进名单
 *   - 进名单 = 已风控（监控中），但只有 SetLimitTime 设置了 limitStartTime 后前台才正式被拦
 *   - limitMinutes 闭区间 [30, 1440]；同一账号可多次设置，后一次必须 > 前一次
 *   - 时长是绝对值、不累加，且始终从 limitStartTime（最初风控开始时刻）算起
 *   - GetPageList 的 startTime/endTime 是「字符串」("YYYY-MM-DD HH:mm:ss")，按印度时区
 *   - SetLimitTime 的 tenantDate 是「字符串」("YYYY-MM-DD")，按印度时区
 *   - 响应里的 triggerTime/limitStartTime/limitEndTime 是绝对毫秒时间戳
 */

import { sendRequest } from '../common/request.js';

const API_LIST = '/api/RechargePullMonitor/GetPageList';
const API_SET = '/api/RechargePullMonitor/SetLimitTime';

/**
 * 查拉单监控名单里指定 userId 的记录
 * @param {string} adminToken 管理员 token
 * @param {number} userId 会员ID
 * @param {string} startStr 印度时区今日起 "YYYY-MM-DD 00:00:00"
 * @param {string} endStr   印度时区今日止 "YYYY-MM-DD 23:59:59"
 * @returns {object|null} 命中记录对象；无记录返回 null
 *   记录字段：{ userId, tenantDate, triggerTime, lastUpdateTime, pullOrderCount,
 *              paidOrderCount, limitStartTime, limitEndTime, limitMinutes,
 *              totalLimitMinutes, lastUpdateMan }
 */
export function getPullMonitorRecords(adminToken, userId, startStr, endStr) {
    const payload = {
        userId: userId,
        startTime: startStr,
        endTime: endStr,
        pageNo: 1,
        pageSize: 20,
    };
    // isDesk=false 走后台域名；sendRequest 对「有 data 无 token」的响应会返回 data 本身
    const resp = sendRequest(payload, API_LIST, 'PullMonitorGetPageList', false, adminToken);
    if (!resp) return [];
    // resp 可能是 data 本身({list,...})，也可能是完整响应({data:{list,...}})
    const list = (resp.data && Array.isArray(resp.data.list)) ? resp.data.list
        : (Array.isArray(resp.list) ? resp.list : []);
    return list.filter(r => String(r.userId) === String(userId));
}

/** 取该会员今日监控记录（正常一天只应有一条）；无则 null。多条时返回第一条（唯一性由调用方另行断言） */
export function getPullMonitorRecord(adminToken, userId, startStr, endStr) {
    const arr = getPullMonitorRecords(adminToken, userId, startStr, endStr);
    return arr.length ? arr[0] : null;
}

/**
 * 设置拉单限制时长
 * @param {string} adminToken 管理员 token
 * @param {number} userId 会员ID
 * @param {string} tenantDate 印度时区日期 "YYYY-MM-DD"
 * @param {number} limitMinutes 限制分钟数（合法区间 [30,1440]）
 * @returns {object|null} 完整响应 { code, msg, msgCode }；code===0 表示成功
 */
export function setPullLimitTime(adminToken, userId, tenantDate, limitMinutes) {
    const payload = {
        userId: userId,
        tenantDate: tenantDate,
        limitMinutes: limitMinutes,
    };
    // SetLimitTime 成功响应无 data 无 token → sendRequest 返回完整体，可判 code/msgCode
    const resp = sendRequest(payload, API_SET, 'PullMonitorSetLimitTime', false, adminToken);
    return resp || null;
}
