import { createluckyDoubleBonus } from './createluckyDoubleBonus.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    // K6 requires a default function. We wrap existing createluckyDoubleBonus logic.
    // Get admin token using AdminLogin function
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createluckyDoubleBonus_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createluckyDoubleBonus_dispatch] Executing createluckyDoubleBonus flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createluckyDoubleBonus({ token: token });

    logger.info(`[createluckyDoubleBonus_dispatch] Result: ${JSON.stringify(result)}`);
}
