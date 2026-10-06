/**
 * 充值留存分析 API 封装
 *
 * 包含：
 *   - 时区工具（按 COUNTRY_CODE 推算时区偏移）
 *   - 自然日时间戳计算
 *   - 翻页公共逻辑（fetchAllPages）
 *   - 充值订单查询封装
 */

import { sleep } from 'k6';
import { sendRequest } from '../common/request.js';

// ============================================================
// 时区工具（已移到 libs/common/time.js，这里转发保持旧 import 可用）
// ============================================================

export { getTzOffset, getDayRange } from '../../../libs/common/time.js';

// ============================================================
// 翻页公共逻辑
// ============================================================

const PAGE_SIZE = 500;
const API_RECHARGE_ORDER = '/api/RechargeOrder/GetRechargeOrderPageList';
const TAG_RECHARGE_ORDER = 'GetRechargeOrderPageList';

/**
 * 拉取充值订单全量数据（自动翻页）
 *
 * @param {string} adminToken
 * @param {number} startTime  - 毫秒时间戳
 * @param {number} endTime    - 毫秒时间戳
 * @param {string} rechargeState - 默认 'Payed'
 * @param {number|null} channelPackageId - 渠道来源ID（必填，不传则报错）
 * @returns {Array} 全量订单列表
 */
export function fetchAllRechargeOrders(adminToken, startTime, endTime, rechargeState = 'Payed', channelPackageId = null) {
    if (!channelPackageId) {
        throw new Error('[RetentionApi] ❌ 未提供渠道来源（channelPackageId），请通过 -e CHANNEL_PACKAGE_ID=xxx 传入');
    }

    const allOrders = [];
    let pageNo = 1;
    let totalCount = null;

    console.log(`[RetentionApi] 查询充值订单: ${new Date(startTime).toISOString()} ~ ${new Date(endTime).toISOString()}`);
    console.log(`[RetentionApi] 渠道来源: ${channelPackageId}`);

    while (true) {
        const payload = {
            channelPackageId: channelPackageId,
            rechargeState: rechargeState,
            startTime: startTime,
            endTime: endTime,
            pageNo: pageNo,
            pageSize: PAGE_SIZE,
            dateType: 1,
            orderBy: 'Desc'
        };

        const response = sendRequest(payload, API_RECHARGE_ORDER, TAG_RECHARGE_ORDER, false, adminToken);

        if (!response) {
            console.error(`[RetentionApi] 第 ${pageNo} 页请求失败`);
            break;
        }

        // sendRequest 返回的是 parsedBody.data 或完整响应
        const data = response.data ? response.data : response;
        const list = data.list || [];
        allOrders.push(...list);

        // 第一页时记录总数
        if (pageNo === 1) {
            totalCount = data.totalCount || 0;
            console.log(`[RetentionApi] 总记录数: ${totalCount}，本页获取: ${list.length}`);
        } else {
            console.log(`[RetentionApi] 第 ${pageNo} 页获取: ${list.length} 条`);
        }

        // 判断是否还有下一页
        const totalPage = data.totalPage || Math.ceil(totalCount / PAGE_SIZE);
        if (pageNo >= totalPage || list.length === 0) {
            break;
        }

        pageNo++;
        sleep(0.5); // 翻页间隔 500ms
    }

    console.log(`[RetentionApi] 全量数据获取完成，共 ${allOrders.length} 条`);
    return allOrders;
}

// ============================================================
// 数据分析工具
// ============================================================

/**
 * 按 userId 聚合订单
 * @param {Array} orders
 * @returns {Map<number, { totalAmount: number, count: number, orders: Array }>}
 */
export function groupByUserId(orders) {
    const map = new Map();
    for (const order of orders) {
        const uid = String(order.userId);
        if (!map.has(uid)) {
            map.set(uid, { totalAmount: 0, count: 0, orders: [] });
        }
        const entry = map.get(uid);
        entry.totalAmount += order.amount || 0;
        entry.count++;
        entry.orders.push(order);
    }
    return map;
}

/**
 * 当日复充分析
 * 筛选：同一天内充值 ≥2 次的用户
 *
 * @param {Array} orders - 单天全量订单
 * @returns {Array<{ userId, totalAmount, count }>} 按充值总金额降序
 */
export function analyzeSameDayRetention(orders) {
    const grouped = groupByUserId(orders);
    const result = [];

    for (const [userId, data] of grouped) {
        if (data.count >= 2) {
            result.push({
                userId,
                totalAmount: data.totalAmount,
                count: data.count
            });
        }
    }

    // 按充值总金额降序
    result.sort((a, b) => b.totalAmount - a.totalAmount);
    return result;
}

/**
 * 次日复充分析
 * 筛选：day1 有充值 且 day2 也有充值的用户
 *
 * @param {Array} day1Orders - 第一天全量订单
 * @param {Array} day2Orders - 第二天全量订单
 * @returns {Array<{ userId, totalAmount, day1Count, day2Count }>} 按充值总金额降序
 */
export function analyzeNextDayRetention(day1Orders, day2Orders) {
    const day1Map = groupByUserId(day1Orders);
    const day2Map = groupByUserId(day2Orders);
    const result = [];

    for (const [userId, day1Data] of day1Map) {
        if (day2Map.has(userId)) {
            const day2Data = day2Map.get(userId);
            result.push({
                userId,
                totalAmount: day1Data.totalAmount + day2Data.totalAmount,
                day1Count: day1Data.count,
                day2Count: day2Data.count
            });
        }
    }

    result.sort((a, b) => b.totalAmount - a.totalAmount);
    return result;
}
