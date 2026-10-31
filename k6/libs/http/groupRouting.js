/**
 * 集团后台查询路由：默认登录集团、集团查询，集团登录失败时整体降级到商户自己登录查询
 *
 * 背景（2026-10-30 浏览器实测确认，见 config/groupAdminConfig.js）：
 * 集团后台(g1002.mggametransit.com)用同一个管理员账号登录一次，之后任何查询请求
 * 只要在请求头里带上 `tenantId`（纯数字字符串，如 "3001"），就能查到该商户的数据，
 * API 路径/payload 和商户自己登录查询完全一致，域名和 token 全程不变——这一点已经
 * 用 fetch/XHR 拦截器在真实页面上重新抓包验证过，头部字段名确认就是小写驼峰 tenantId。
 * 集团 token 的 JWT claims 里 TenantId="0"、IsGroupUser="True"、GroupCode="G1002"、
 * TenantScopeType="1"，是"集团范围"通用凭证，不绑定具体商户——查询范围完全由
 * tenantId 请求头决定，和 token 本身无关。
 *
 * 这个模块只管"后台管理查询"的路由(isDesk=false)。前台(isDesk=true，玩家登录/下单
 * 等)不受集团模式影响，集团后台域名对前台业务没有意义。
 */
import http from 'k6/http';
import { buildBaseHeaders, signPayload, resolveTenant, getTenantBaseUrl } from './primitives.js';
import { totpVCode } from '../utils/totp.js';
import { getTimeRandom } from '../../tests/utils/utils.js';
import { getGroupAdminByTenantId } from '../../config/groupAdminConfig.js';

/**
 * 集团模式总开关，默认开启。排查问题时可以 -e USE_GROUP_ADMIN=false 整体关掉，
 * 回到改造前"各商户各自登录查询"的行为。
 */
export function isGroupModeEnabled() {
    return (__ENV.USE_GROUP_ADMIN || 'true').toLowerCase() !== 'false';
}

/**
 * 按集团实例 NAME 分别记录登录状态。k6 每个 VU 是独立 JS 运行时，这个模块级对象
 * 天然就是"每个 VU 一份"，不需要额外同步——同一个 VU 内，每个集团实例只在第一次
 * 被用到时真正尝试登录一次(不管成功失败)，后续调用直接复用结果。这就是"登录粒度
 * 降级"的具体实现：不是每次请求都重新判断一遍集团是否可用。
 */
const groupLoginState = {};

function groupAdminPost(baseUrl, token, api, payload) {
    const timeData = getTimeRandom();
    const body = { ...payload, random: timeData.random, language: 'zh', timestamp: timeData.timestamp };
    const signed = signPayload(body);
    const headers = buildBaseHeaders(baseUrl, token);
    const resp = http.post(`${baseUrl}${api}`, JSON.stringify(signed), { headers });
    try {
        return JSON.parse(resp.body);
    } catch (e) {
        console.error(`[GroupRouting] 响应解析失败 api=${api}: ${e.message} body=${String(resp.body).slice(0, 200)}`);
        return null;
    }
}

/**
 * 集团后台登录，TOTP 多窗口重试(容忍客户端/服务端时钟偏差)。
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
            console.log(`[GroupRouting] ✅ 集团后台登录成功: ${g.ADMIN_USERNAME} (${g.NAME})`);
            return resp.data.token;
        }
    }
    console.error(`[GroupRouting] ❌ 集团后台登录失败: ${g.ADMIN_USERNAME} (${g.NAME}) 最后响应=${JSON.stringify(lastResp)}`);
    return null;
}

/**
 * 获取某个 tenantId 归属的集团实例的登录 token。同一个 VU 内，每个集团实例只真正
 * 尝试登录一次。
 * @param {string|number} tenantId
 * @returns {string|null} token；null 表示该 tenantId 不属于任何已配置的集团实例，
 *   或者所属的集团实例登录失败——两种情况调用方都应该降级到商户自己登录查询。
 */
export function getGroupToken(tenantId) {
    if (!isGroupModeEnabled()) return null;

    const tenant = resolveTenant(tenantId);
    const g = getGroupAdminByTenantId(tenant);
    if (!g) return null;

    const state = groupLoginState[g.NAME] || (groupLoginState[g.NAME] = { tried: false, available: false, token: null });
    if (!state.tried) {
        state.tried = true;
        state.token = groupAdminLogin(g);
        state.available = !!state.token;
    }
    return state.available ? state.token : null;
}

/**
 * 核心路由解析：决定一个请求最终该打到哪个域名、要不要额外带 tenantId 请求头。
 * @param {boolean} isDesk - 是否前台请求。true 时直接走商户自己的前台域名，不受
 *   集团模式影响(集团后台域名只对后台管理查询有意义)。
 * @param {string|number} [tenantId] - 租户ID，可选（默认走 core.js 的 resolveTenant 规则）
 * @param {boolean} [forceTenant=false] - 强制走商户自己的域名，不套集团路由，也不触发
 *   集团登录（2026-10-30 新增）。给已经用 tenantAdminLogin(id, true)/AdminLogin(true) 拿到
 *   商户 token 的调用方用——token 和路由必须同步走商户模式，否则会出现"商户 token 打到
 *   集团域名"或反过来的错配（已实测踩坑：图片上传接口硬编码商户域名，若 token 是集团的
 *   会报 "Account type does not match the admin site"）。
 * @returns {{baseUrl: string, extraHeaders: object, isGroupMode: boolean}}
 */
export function resolveQueryRoute(isDesk, tenantId, forceTenant = false) {
    const tenant = resolveTenant(tenantId);

    if (!isDesk && !forceTenant) {
        const groupToken = getGroupToken(tenant);
        if (groupToken) {
            const g = getGroupAdminByTenantId(tenant);
            return {
                baseUrl: g.BASE_URL.replace(/\/$/, ''),
                extraHeaders: { tenantId: String(tenant) },
                isGroupMode: true
            };
        }
    }

    return {
        baseUrl: getTenantBaseUrl(isDesk, tenant),
        extraHeaders: {},
        isGroupMode: false
    };
}
