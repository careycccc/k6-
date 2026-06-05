/**
 * 导出租户会员账号为 CSV
 * 
 * 用法：
 *   k6 run -e TENANT_ID=3004 -e PAGE_SIZE=100 exportAccounts.test.js
 * 
 * 说明：
 *   - 从 /api/Users/GetPageList 查询会员账号
 *   - 导出为 CSV 格式（只包含 userName，不含密码）
 *   - 输出到控制台，需手动复制到 k6/data/csv/accounts.csv
 * 
 * 环境变量：
 *   TENANT_ID   - 租户ID（必填）
 *   PAGE_SIZE   - 每页数量，默认 100
 */

import { AdminLogin } from '../login/adminlogin.test.js';
import { sendQueryRequest } from '../common/request.js';
import { getUserAccount } from '../user/userAccountApi.js';

export const options = {
    vus: 1,
    iterations: 1,
};

const TAG = 'ExportAccounts';

export default function () {
    const tenantId = __ENV.TENANT_ID;
    if (!tenantId) {
        console.error(`❌ 缺少环境变量 TENANT_ID，请使用: -e TENANT_ID=3004`);
        return;
    }

    const pageSize = parseInt(__ENV.PAGE_SIZE || '100', 10);
    const outputMode = __ENV.OUTPUT_MODE || 'full'; // 'full' 或 'csv'

    // 后台登录
    const adminToken = AdminLogin();
    if (!adminToken) {
        if (outputMode === 'full') console.error(`[${TAG}] ❌ 后台登录失败`);
        return;
    }

    // 查询会员列表
    const res = sendQueryRequest(
        { pageNo: 1, pageSize },
        '/api/Users/GetPageList',
        TAG,
        false,
        adminToken
    );

    if (!res || !res.list || res.list.length === 0) {
        if (outputMode === 'full') console.error(`[${TAG}] ❌ 未查询到会员数据`);
        return;
    }

    // 构建 CSV 内容
    const csvLines = ['userName,loginType,remark'];
    let successCount = 0;

    for (let i = 0; i < res.list.length; i++) {
        const user = res.list[i];
        const userId = user.userId;

        // 通过 userId 获取真实账号
        const account = getUserAccount(adminToken, userId);

        if (account) {
            const loginType = account.includes('@') ? 'Email' : 'Mobile';
            const remark = `账号${i + 1}`;
            csvLines.push(`${account},${loginType},${remark}`);
            successCount++;
        }
    }

    const csvContent = csvLines.join('\n');

    // 根据输出模式选择显示方式
    if (outputMode === 'csv') {
        // 纯CSV模式：只输出CSV内容，便于重定向
        console.log(csvContent);
    } else {
        // 完整模式：带说明的输出
        console.log(`\n${'='.repeat(70)}`);
        console.log(`📊 ${TAG} - 导出租户会员账号为 CSV`);
        console.log(`${'='.repeat(70)}\n`);
        console.log(`[${TAG}] 租户: ${tenantId}`);
        console.log(`[${TAG}] 查询到 ${res.list.length} 个会员`);
        console.log(`[${TAG}] 成功: ${successCount} 个\n`);
        console.log(`📄 CSV 内容:\n`);
        console.log(csvContent);
        console.log(`\n${'='.repeat(70)}`);
        console.log(`💡 自动写入方法:`);
        console.log(`   PowerShell: .\\exportAccounts.ps1 -TenantId ${tenantId}`);
        console.log(`   批处理:     exportAccounts.bat ${tenantId}`);
        console.log(`   手动重定向: k6 run -e TENANT_ID=${tenantId} -e OUTPUT_MODE=csv exportAccounts.test.js > ..\\..\\..\\data\\csv\\accounts.csv`);
        console.log(`${'='.repeat(70)}\n`);
    }
}
