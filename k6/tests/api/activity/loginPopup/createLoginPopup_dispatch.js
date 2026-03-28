import { createLoginPopup } from './createLoginPopup.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createLoginPopup_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createLoginPopup_dispatch] Executing createLoginPopup flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createLoginPopup({ token: token });

    logger.info(`[createLoginPopup_dispatch] Result: ${JSON.stringify(result)}`);
}
