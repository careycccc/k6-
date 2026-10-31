/**
 * libs/http/core.js 自测：租户解析优先级、域名、请求头、签名（不发请求，除了集团登录本身）
 *   商户模式（旧行为）: k6 run -e TENANT=3101 -e TENANT_ID=3004 -e USE_GROUP_ADMIN=false k6/tests/unit/httpCore.test.js
 *   集团模式（默认，2026-10-30新增）: k6 run -e TENANT_ID=3004 k6/tests/unit/httpCore.test.js
 */
import { resolveTenant, getBaseUrl, buildBaseHeaders, signPayload } from '../../libs/http/core.js';
import { getTenantBaseUrl } from '../../libs/http/primitives.js';
import { resolveQueryRoute, isGroupModeEnabled } from '../../libs/http/groupRouting.js';
import { getApiUrl } from '../../config/environment.js';

export const options = { vus: 1, iterations: 1 };
let fail = 0;
const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fail++; console.log(`${ok ? '✅' : '❌'} ${n} got=${JSON.stringify(g)}${ok ? '' : ' want=' + JSON.stringify(w)}`); };

export default function () {
    eq('显式 tenantId 优先', resolveTenant('3006'), '3006');
    if (__ENV.TENANT || __ENV.TENANT_ID) {
        eq('未传时 TENANT 优先于 TENANT_ID', resolveTenant(), __ENV.TENANT || __ENV.TENANT_ID);
    } else {
        console.log('⏭️  跳过"未传时 TENANT 优先于 TENANT_ID"（本次运行未传 -e TENANT/-e TENANT_ID，走的是 envconfig 默认值）');
    }

    const tenant = resolveTenant();
    const groupOn = isGroupModeEnabled();
    const route = resolveQueryRoute(false, tenant);

    eq('前台域名不受集团模式影响', getBaseUrl(true), getTenantBaseUrl(true, tenant));

    if (groupOn && route.isGroupMode) {
        // 2026-10-30：默认登录集团、集团查询——后台域名应该是集团域名，且 getApiUrl
        // 与 getBaseUrl 要保持一致(不能出现"url打到集团、Domainurl头却是商户域名"的错配)
        eq('集团模式下后台域名=集团域名', getBaseUrl(false), route.baseUrl);
        eq('集团模式下带 tenantId 请求头', route.extraHeaders.tenantId, String(tenant));
    } else {
        eq('非集团模式下后台域名=商户域名', getBaseUrl(false), getTenantBaseUrl(false, tenant));
        eq('非集团模式下不带 tenantId 请求头', route.extraHeaders.tenantId, undefined);
    }
    eq('getApiUrl 与请求头同租户', getApiUrl('/api/x', false).startsWith(getBaseUrl(false)), true);

    eq('请求头无 token', Object.keys(buildBaseHeaders('https://a.b', '')), ['Content-Type', 'Domainurl', 'Referrer']);
    eq('请求头带 token', buildBaseHeaders('https://a.b', 'T').Authorization, 'Bearer T');
    const s = signPayload({ a: 1, random: 1, timestamp: 1, language: 'en' });
    eq('签名生成 signature', typeof s.signature === 'string' && s.signature.length > 0, true);
    console.log(fail === 0 ? '全部通过' : `失败 ${fail} 项`);
    if (fail) throw new Error('httpCore 自测失败');
}
