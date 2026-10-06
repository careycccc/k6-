/**
 * libs/http/core.js 自测：租户解析优先级、域名、请求头、签名（不发请求）
 *   k6 run -e TENANT=3101 -e TENANT_ID=3004 k6/tests/unit/httpCore.test.js
 */
import { resolveTenant, getBaseUrl, buildBaseHeaders, signPayload } from '../../libs/http/core.js';
import { getApiUrl } from '../../config/environment.js';
import { getEnvByTenantId } from '../../config/envconfig.js';

export const options = { vus: 1, iterations: 1 };
let fail = 0;
const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fail++; console.log(`${ok ? '✅' : '❌'} ${n} got=${JSON.stringify(g)}${ok ? '' : ' want=' + JSON.stringify(w)}`); };

export default function () {
    eq('显式 tenantId 优先', resolveTenant('3006'), '3006');
    eq('未传时 TENANT 优先于 TENANT_ID', resolveTenant(), __ENV.TENANT || __ENV.TENANT_ID);
    const e = getEnvByTenantId(resolveTenant());
    eq('前台域名', getBaseUrl(true), e.BASE_DESK_URL);
    eq('后台域名', getBaseUrl(false), e.BASE_ADMIN_URL);
    eq('getApiUrl 与请求头同租户', getApiUrl('/api/x', false).startsWith(getBaseUrl(false)), true);
    eq('请求头无 token', Object.keys(buildBaseHeaders('https://a.b', '')), ['Content-Type', 'Domainurl', 'Referrer']);
    eq('请求头带 token', buildBaseHeaders('https://a.b', 'T').Authorization, 'Bearer T');
    const s = signPayload({ a: 1, random: 1, timestamp: 1, language: 'en' });
    eq('签名生成 signature', typeof s.signature === 'string' && s.signature.length > 0, true);
    console.log(fail === 0 ? '全部通过' : `失败 ${fail} 项`);
    if (fail) throw new Error('httpCore 自测失败');
}
