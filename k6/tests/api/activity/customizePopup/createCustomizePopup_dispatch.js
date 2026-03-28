import { createCustomizePopup } from './createCustomizePopup.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createCustomizePopup_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createCustomizePopup_dispatch] Executing createCustomizePopup flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createCustomizePopup({ token: token });

    logger.info(`[createCustomizePopup_dispatch] Result: ${JSON.stringify(result)}`);
}
