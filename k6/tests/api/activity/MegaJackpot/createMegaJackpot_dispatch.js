import { createMegaJackpot } from './createMegaJackpot.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createMegaJackpot_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createMegaJackpot_dispatch] Executing createMegaJackpot flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createMegaJackpot({ token: token });

    logger.info(`[createMegaJackpot_dispatch] Result: ${JSON.stringify(result)}`);
}
