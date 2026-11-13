/**
 * 探测工具：查某个userId在GetPageList里的完整字段，重点看packageId字段的真实值。
 * 用法：k6p -e TENANT_ID=3004 -e USER_ID=170776 probeAccountPackageId.js
 */
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { sendRequest } from '../common/request.js';
import { fetchAllPages } from '../../../libs/common/paging.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const USER_ID = parseInt(__ENV.USER_ID, 10);
const TAG = 'ProbeAccountPackageId';

export const options = {
    scenarios: { probe: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '5m' } }
};

export default function () {
    const adminToken = tenantAdminLogin(TENANT_ID, true);
    if (!adminToken) { console.error(`[${TAG}] 后台登录失败`); return; }

    const list = fetchAllPages(
        (pageNo) => sendRequest({ userId: USER_ID, pageNo, pageSize: 100, orderBy: 'Desc' }, '/api/Users/GetPageList', TAG, false, adminToken, true),
        { maxPages: 1, pause: 0 }
    );
    console.log(`[${TAG}] 查到${list.length}条记录`);
    if (list.length > 0) {
        console.log(`[${TAG}] 完整记录: ${JSON.stringify(list[0])}`);
    }
}
