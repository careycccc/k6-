/**
 * 集团后台(Group Admin) API 封装 —— 充提报表查询
 *
 * 和租户后台是两套完全独立的系统：域名/账号/密钥见 config/groupAdminConfig.js
 * 的 GROUP_ADMIN_TEST/GROUP_ADMIN_UAT。登录协议(userName/pwd/vCode + 签名)和
 * 租户后台一致，复用 libs/http/primitives.js 的 signPayload/buildBaseHeaders；
 * 但域名解析不能用 getBaseUrl(走 envconfig 的 ENV_MAP 按 tenantId 查)，因为
 * 集团后台不在那张表里，要用配置里写死的 BASE_URL 直接拼。
 *
 * 2026-10-30：groupAdminPost/groupAdminLogin 这两个通用函数搬到了
 * libs/http/groupRouting.js（整个项目"默认登录集团、集团查询"改造的核心路由
 * 模块，所有查询路径都经过它判断要不要走集团），这里改为直接复用，避免两份
 * 几乎一样的登录逻辑分叉走偏。本文件只保留集团报表特有的业务查询函数。
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
import { buildBaseHeaders, signPayload } from '../../../libs/http/primitives.js';
import { groupAdminLogin } from '../../../libs/http/groupRouting.js';
import { getTimeRandom } from '../../utils/utils.js';

// 集团登录(TOTP多窗口重试)直接复用 groupRouting.js 的实现，避免两份登录重试
// 逻辑分叉走偏；转发导出保持本文件原有的 import 路径不变。
export { groupAdminLogin };

/**
 * 发一个已签名的集团后台请求。
 * @param {string} baseUrl - 不带末尾斜杠
 * @param {string|null} token - 登录后的token，登录请求本身传null
 * @param {string} api - 形如 '/api/GroupRechargeWithdrawReport/GetTenantPageList'
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
