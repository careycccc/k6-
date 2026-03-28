import { createRanking } from './createRanking.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createRanking_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createRanking_dispatch] Executing createRanking flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createRanking({ token: token });

    logger.info(`[createRanking_dispatch] Result: ${JSON.stringify(result)}`);
}
