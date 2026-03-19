import { createRechargeWheel } from './createRechargeWheel.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createRechargeWheel_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createRechargeWheel_dispatch] Executing createRechargeWheel flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createRechargeWheel({ token: token });

    logger.info(`[createRechargeWheel_dispatch] Result: ${JSON.stringify(result)}`);
}
