import { createActivityGuide } from './createActivityGuide.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createActivityGuide_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createActivityGuide_dispatch] Executing createActivityGuide flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createActivityGuide({ token: token });

    logger.info(`[createActivityGuide_dispatch] Result: ${JSON.stringify(result)}`);
}
