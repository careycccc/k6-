import { createChampion } from './createChampion.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    // K6 requires a default function. We wrap the existing createChampion logic.
    // Get admin token using AdminLogin function
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createChampion_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createChampion_dispatch] Executing createChampion flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createChampion({ token: token });

    logger.info(`[createChampion_dispatch] Result: ${JSON.stringify(result)}`);
}
