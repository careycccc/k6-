/**
 * 实时数据统计报表 一致性校验 —— 入口
 *
 * 用法：
 *   k6 run -e TENANT_ID=3004 -e DATE=2026-07-28 runSnapshotCompare.test.js
 *   不传 DATE 默认取今天；容差用 -e TOL=0.01 调整。
 */
import { logger } from '../../../libs/utils/logger.js';
import { AdminLogin } from '../login/adminlogin.test.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { runSnapshotCompare } from './snapshotCompare.js';

export const options = {
    scenarios: {
        rpt_compare: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '5m' },
    },
};

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function setup() {
    const tenantId = __ENV.TENANT_ID || '3004';
    if (tenantId !== '3004') {
        const env = getEnvByTenantId(tenantId);
        if (env) Object.assign(ENV_CONFIG, env);
    }
    const token = AdminLogin();
    if (!token) throw new Error('[RptCompare] 管理员登录失败');
    const date = __ENV.DATE || todayStr();
    logger.info(`[RptCompare] 租户=${tenantId} 日期=${date}`);
    return { token, tenantId, date };
}

export default function (data) {
    if (data.tenantId !== '3004') {
        const env = getEnvByTenantId(data.tenantId);
        if (env) Object.assign(ENV_CONFIG, env);
    }
    runSnapshotCompare(data.token, data.date);
}
