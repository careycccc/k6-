import { createRedRainActivity } from './createRedRainActivity.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    // K6 requires a default function. We wrap the existing createRedRainActivity logic.
    // Get admin token using AdminLogin function
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createRedRainActivity_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createRedRainActivity_dispatch] Executing createRedRainActivity flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createRedRainActivity({ token: token });

    logger.info(`[createRedRainActivity_dispatch] Result: ${JSON.stringify(result)}`);
}
