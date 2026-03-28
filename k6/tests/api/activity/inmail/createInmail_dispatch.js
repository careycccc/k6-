import { createInmail } from './createInmail.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createInmail_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createInmail_dispatch] Executing createInmail flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createInmail({ token: token });

    logger.info(`[createInmail_dispatch] Result: ${JSON.stringify(result)}`);
}
