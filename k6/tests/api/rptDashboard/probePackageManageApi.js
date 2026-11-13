/**
 * 探测工具：尝试几个可能的"渠道包管理"接口名，看后台是否暴露了包列表查询接口。
 * 纯只读探测，不修改任何配置。
 */
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { sendRequest } from '../common/request.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const TAG = 'ProbePackageManageApi';

export const options = {
    scenarios: { probe: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '5m' } }
};

const TARGET_IDS = [2, 100054, 100055, 100058];

export default function () {
    const adminToken = tenantAdminLogin(TENANT_ID, true);
    if (!adminToken) { console.error(`[${TAG}] 后台登录失败`); return; }

    let allList = [];
    for (let page = 1; page <= 3; page++) {
        const res = sendRequest({ pageNo: page, pageSize: 100 }, '/api/Package/GetPageList', TAG, false, adminToken, true);
        const list = (res && res.list) || [];
        console.log(`[${TAG}] 第${page}页: ${list.length}条, total=${res ? res.totalCount : 'N/A'}`);
        allList = allList.concat(list);
        if (list.length < 100) break;
    }

    console.log(`[${TAG}] 总共拉到 ${allList.length} 条包记录`);
    for (const id of TARGET_IDS) {
        const found = allList.find(i => i.id === id);
        console.log(`[${TAG}] id=${id} => ${found ? JSON.stringify(found) : '未在列表里找到'}`);
    }
}
