/**
 * 代理层级 / 转线 接口封装（后台 isDesk=false）。
 * 均带翻页：totalCount > pageSize 时自动拉全（后端 totalPage 驱动）。
 */
import { sendRequest } from '../common/request.js';

const TAG = 'AgentHierarchyVerify';
const MAX_PAGES = 50; // 翻页安全上限（500/页 → 最多 2.5 万条）

/**
 * 代理层级列表 /api/Agent/GetPageListAgentList
 * 按需求给定的 payload：isAll:false, isFullAgentLine:true, isIncludeSelfAndParent:true
 * @returns {{list: Array, totalCount: number, pages: number}}
 */
export function fetchAgentLine(adminToken, userId, pageSize = 500) {
    const api = '/api/Agent/GetPageListAgentList';
    let all = [];
    let pageNo = 1;
    let totalPage = 1;
    let totalCount = 0;

    while (pageNo <= totalPage && pageNo <= MAX_PAGES) {
        const payload = {
            userId: userId,
            isAll: false,
            isFullAgentLine: true,
            isIncludeSelfAndParent: true,
            pageNo: pageNo,
            pageSize: pageSize,
            orderBy: 'Desc'
        };
        let res = sendRequest(payload, api, TAG, false, adminToken);
        if (typeof res !== 'object') { try { res = JSON.parse(res); } catch (e) { break; } }
        if (!res) break;

        const list = res.list || [];
        all = all.concat(list);
        totalCount = res.totalCount != null ? res.totalCount : all.length;
        if (res.totalPage && res.totalPage > totalPage) totalPage = res.totalPage;

        console.log(`   [代理列表] 第 ${pageNo}/${totalPage} 页，本页 ${list.length} 条（累计 ${all.length}/${totalCount}）`);
        pageNo++;
    }

    return { list: all, totalCount, pages: pageNo - 1 };
}

/**
 * 当天转线记录 /api/Agent/GetPageListAgentTransfer（timeType=1 全局按时间）
 * 注意：必须用 sendRequest（sendQueryRequest 会覆盖 pageNo/pageSize 导致翻页失效）。
 * @returns {{list: Array, totalCount: number, pages: number}}
 */
export function fetchDayTransfers(adminToken, timeFrom, timeTo, pageSize = 500) {
    const api = '/api/Agent/GetPageListAgentTransfer';
    let all = [];
    let pageNo = 1;
    let totalPage = 1;
    let totalCount = 0;

    while (pageNo <= totalPage && pageNo <= MAX_PAGES) {
        const payload = {
            timeType: 1,
            timeFrom: timeFrom,
            timeTo: timeTo,
            pageNo: pageNo,
            pageSize: pageSize,
            orderBy: 'Desc'
        };
        let res = sendRequest(payload, api, TAG, false, adminToken);
        if (typeof res !== 'object') { try { res = JSON.parse(res); } catch (e) { break; } }
        if (!res) break;

        const list = res.list || [];
        all = all.concat(list);
        totalCount = res.totalCount != null ? res.totalCount : all.length;
        if (res.totalPage && res.totalPage > totalPage) totalPage = res.totalPage;

        console.log(`   [转线记录] 第 ${pageNo}/${totalPage} 页，本页 ${list.length} 条（累计 ${all.length}/${totalCount}）`);
        pageNo++;
    }

    return { list: all, totalCount, pages: pageNo - 1 };
}
