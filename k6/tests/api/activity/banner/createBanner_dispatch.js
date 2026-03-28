import { createBanner } from './createBanner.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createBanner_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createBanner_dispatch] Executing createBanner flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createBanner({ token: token });

    logger.info(`[createBanner_dispatch] Result: ${JSON.stringify(result)}`);
}
