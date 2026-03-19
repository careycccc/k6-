import { createWeekCard } from './createWeekCard.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createWeekCard_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createWeekCard_dispatch] Executing createWeekCard flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createWeekCard({ token: token });

    logger.info(`[createWeekCard_dispatch] Result: ${JSON.stringify(result)}`);
}
