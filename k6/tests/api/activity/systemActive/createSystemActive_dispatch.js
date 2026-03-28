import { createSystemActive } from './createSystemActive.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    // K6 requires a default function. We wrap the existing createSystemActive logic.
    // Get admin token using AdminLogin function
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createSystemActive_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createSystemActive_dispatch] Executing createSystemActive flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createSystemActive({ token: token });

    logger.info(`[createSystemActive_dispatch] Result: ${JSON.stringify(result)}`);
}
