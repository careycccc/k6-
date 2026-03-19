import { createDailyTasks } from './createDailyTasks.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createDailyTasks_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createDailyTasks_dispatch] Executing createDailyTasks flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createDailyTasks({ token: token });

    logger.info(`[createDailyTasks_dispatch] Result: ${JSON.stringify(result)}`);
}
