/**
 * 集团后台(Group Admin) API 封装 —— 登录 + 充提报表查询
 *
 * 和租户后台是两套完全独立的系统：域名/账号/密钥见 config/groupAdminConfig.js
 * 的 GROUP_ADMIN_TEST/GROUP_ADMIN_UAT。登录协议(userName/pwd/vCode + 签名)和
 * 租户后台一致，复用 libs/http/tenantRequest.js 的 totpVCode 和
 * libs/http/core.js 的 signPayload/buildBaseHeaders；但域名解析不能用
 * getBaseUrl(走 envconfig 的 ENV_MAP 按 tenantId 查)，因为集团后台不在那张表
 * 里，要用配置里写死的 BASE_URL 直接拼。
 *
 * 2026-10-26 三个查询接口均已实测确认可用：
 *   - GetTenantPageList：商户充提明细(按tenantId逐行，周期内一次性去重口径)
 *   - GetRechargeChannelSummaryPageList：充值通道汇总(按sysCurrency分组，
 *     没有tenantId字段——如果多个商户共享同一币种，这里的数据是跨商户合并的)
 *   - GetWithdrawChannelSummaryPageList：提现通道汇总，字段比充值版本少
 *     orderUserCount(发起人数)和failCount(失败订单数)，这是后端接口本身的
 *     不对称设计，不是我们漏看了，PRD文档里"4.5提现通道汇总"字段定义确认过
 *     就是没有这两个字段。
 */

import http from 'k6/http';
import { buildBaseHeaders, signPayload } from '../../../libs/http/core.js';
import { totpVCode } from '../../../libs/http/tenantRequest.js';
import { getTimeRandom } from '../../utils/utils.js';

/**
 * 发一个已签名的集团后台请求。
 * @param {string} baseUrl - 不带末尾斜杠
 * @param {string|null} token - 登录后的token，登录请求本身传null
 * @param {string} api - 形如 '/api/Login/Login'
 * @param {object} payload - 业务参数，不含random/language/timestamp(这里统一补)
 * @returns {object} 解析后的响应体 {code, msg, msgCode, data, ...}
 */
function groupAdminPost(baseUrl, token, api, payload) {
    const timeData = getTimeRandom();
    const body = { ...payload, random: timeData.random, language: 'zh', timestamp: timeData.timestamp };
    const signed = signPayload(body);
    const headers = buildBaseHeaders(baseUrl, token);
    const resp = http.post(`${baseUrl}${api}`, JSON.stringify(signed), { headers });
    try {
        return JSON.parse(resp.body);
    } catch (e) {
        console.error(`[GroupAdminApi] 响应解析失败 api=${api}: ${e.message} body=${String(resp.body).slice(0, 200)}`);
        return null;
    }
}

/**
 * 集团后台登录，TOTP 多窗口重试(容忍客户端/服务端时钟偏差)，照抄
 * tenantRequest.js 的 backendLogin 同款逻辑。
 * @param {object} g - GROUP_ADMIN_TEST 或 GROUP_ADMIN_UAT 配置对象
 * @returns {string|null} token
 */
export function groupAdminLogin(g) {
    const baseUrl = g.BASE_URL.replace(/\/$/, '');
    const baseSec = Math.floor(Date.now() / 1000);
    let lastResp = null;
    for (const off of [0, -1, 1, -2, 2]) {
        const vCode = totpVCode(g.GOOGLE_SECRET, off, baseSec);
        const resp = groupAdminPost(baseUrl, null, '/api/Login/Login', { userName: g.ADMIN_USERNAME, pwd: g.ADMIN_PASSWORD, vCode });
        lastResp = resp;
        if (resp && resp.code === 0 && resp.data && resp.data.token) {
            console.log(`[GroupAdminApi] ✅ 集团后台登录成功: ${g.ADMIN_USERNAME}`);
            return resp.data.token;
        }
    }
    console.error(`[GroupAdminApi] ❌ 集团后台登录失败: ${g.ADMIN_USERNAME} 最后响应=${JSON.stringify(lastResp)}`);
    return null;
}

/**
 * 商户充提明细(含集团充提概览卡片同款字段)。
 * @param {object} g
 * @param {string} token
 * @param {string} start - 'YYYY-MM-DD'
 * @param {string} end - 'YYYY-MM-DD'
 * @param {number} [pageNo=1]
 * @param {number} [pageSize=50]
 * @returns {object|null} 完整响应，list里每条含 tenantId/tenantName/sysCurrency/
 *   rechargeOrderUserCount/rechargeOrderCount/rechargeSuccessUserCount/
 *   rechargeSuccessCount/rechargeFailCount/rechargeSuccessAmount/
 *   rechargeUsdtSuccessAmount/rechargeUsdtSuccessUGold/withdrawOrderUserCount/
 *   withdrawOrderCount/withdrawSuccessUserCount/withdrawSuccessCount/
 *   withdrawSuccessAmount/withdrawUsdtSuccessAmount/withdrawUsdtSuccessUGold/
 *   rechargeWithdrawDiff/rechargeSuccessRate
 */
export function getTenantPageList(g, token, start, end, pageNo = 1, pageSize = 50) {
    const baseUrl = g.BASE_URL.replace(/\/$/, '');
    return groupAdminPost(baseUrl, token, '/api/GroupRechargeWithdrawReport/GetTenantPageList', { start, end, pageNo, pageSize });
}

/**
 * 充值通道汇总。不传 sysCurrency 查全部币种混合(此时 amountRate 恒为 null，
 * 已实测确认——【全部】tab 没有占比指标，要看占比得按币种单独查)。
 * @returns {object|null} list 每条含 sysCurrency/channelId/channelName/
 *   orderUserCount/orderCount/successUserCount/successCount/failCount/
 *   successRate/successAmount/usdtSuccessUGold/amountRate
 */
export function getRechargeChannelSummaryPageList(g, token, start, end, pageNo = 1, pageSize = 50, sysCurrency = null) {
    const baseUrl = g.BASE_URL.replace(/\/$/, '');
    const payload = { start, end, pageNo, pageSize };
    if (sysCurrency) payload.sysCurrency = sysCurrency;
    return groupAdminPost(baseUrl, token, '/api/GroupRechargeWithdrawReport/GetRechargeChannelSummaryPageList', payload);
}

/**
 * 提现通道汇总。⚠️ 和充值通道汇总不对称：没有 orderUserCount(发起人数)、
 * 没有 failCount(失败订单数)——这是接口本身的设计，已用真实请求确认过，
 * 不要在对比逻辑里假设这两个字段存在。
 * @returns {object|null} list 每条含 sysCurrency/channelId/channelName/
 *   orderCount/successUserCount/successCount/successAmount/usdtSuccessUGold/amountRate
 */
export function getWithdrawChannelSummaryPageList(g, token, start, end, pageNo = 1, pageSize = 50, sysCurrency = null) {
    const baseUrl = g.BASE_URL.replace(/\/$/, '');
    const payload = { start, end, pageNo, pageSize };
    if (sysCurrency) payload.sysCurrency = sysCurrency;
    return groupAdminPost(baseUrl, token, '/api/GroupRechargeWithdrawReport/GetWithdrawChannelSummaryPageList', payload);
}

/**
 * 集团充提概览(按币种分组，疑似"按天去重累加"口径，和商户明细/通道汇总的
 * "周期内一次性去重"口径可能不同——这个疑点尚未实测验证出差异，暂不用于
 * 核心对比逻辑，只在需要时单独调用参考)。
 * @returns {object|null} data.currencyList 每条含 sysCurrency/tenantCount + 同 GetTenantPageList 的统计字段
 */
export function getOverview(g, token, start, end) {
    const baseUrl = g.BASE_URL.replace(/\/$/, '');
    return groupAdminPost(baseUrl, token, '/api/GroupRechargeWithdrawReport/GetOverview', { start, end });
}
