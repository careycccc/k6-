import { createSignin } from './createSignin.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    // K6 requires a default function. We wrap the existing createSignin logic.
    // Get admin token using AdminLogin function
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createSignin_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createSignin_dispatch] Executing createSignin flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createSignin({ token: token });

    logger.info(`[createSignin_dispatch] Result: ${JSON.stringify(result)}`);
}
