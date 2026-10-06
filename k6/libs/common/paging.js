/**
 * 分页响应解析 + 翻页取全量 公共工具（k6 脚本用，ESM）
 *
 * 兼容两种响应形态：
 *   - sendRequest 返回的 data 对象：{ list, totalPage, totalCount }
 *   - tenantRequest / 原始 body：   { data: { list, totalPage, totalCount } }
 */

import { sleep } from 'k6';

/** 取列表：data.list / list / data(数组) / 本身是数组；都没有返回 [] */
export function extractList(res) {
    if (!res) return [];
    if (res.data && Array.isArray(res.data.list)) return res.data.list;
    if (Array.isArray(res.list)) return res.list;
    if (Array.isArray(res.data)) return res.data;
    if (Array.isArray(res)) return res;
    return [];
}

/** 取总页数；取不到返回 1 */
export function extractTotalPage(res) {
    if (!res) return 1;
    if (res.totalPage) return res.totalPage;
    if (res.data && res.data.totalPage) return res.data.totalPage;
    return 1;
}

/** 取总条数；取不到返回 null */
export function extractTotalCount(res) {
    if (!res) return null;
    if (res.totalCount != null) return res.totalCount;
    if (res.data && res.data.totalCount != null) return res.data.totalCount;
    return null;
}

/**
 * 翻页取全量
 * @param {(pageNo:number) => any} fetchPage  请求第 pageNo 页，返回响应（任意上述形态）
 * @param {object} [opts]
 * @param {number} [opts.maxPages=200]  最多翻几页（防死循环）
 * @param {number} [opts.pause=0.3]     每页之间 sleep 秒数
 * @param {(res:any, pageNo:number) => void} [opts.onPage]  每取到一页回调原始响应（取 summary/sum 等汇总字段用）
 * @returns {Array} 所有页的列表拼接
 *
 * 结束条件：本页为空 / 已收齐 totalCount / 到达 totalPage。
 * （注意：部分后台接口会把 pageSize 截到 20 左右，所以优先按 totalCount 判断）
 */
export function fetchAllPages(fetchPage, opts = {}) {
    const maxPages = opts.maxPages || 200;
    const pause = opts.pause === undefined ? 0.3 : opts.pause;
    const out = [];
    for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
        const res = fetchPage(pageNo);
        if (opts.onPage && res) opts.onPage(res, pageNo);
        const list = extractList(res);
        out.push(...list);
        const totalCount = extractTotalCount(res);
        if (list.length === 0) break;
        if (totalCount != null && out.length >= totalCount) break;
        if (totalCount == null && pageNo >= extractTotalPage(res)) break;
        if (pause > 0) sleep(pause);
    }
    return out;
}
