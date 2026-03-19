import { createInviteTurntable } from './createInviteTurntable.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createInviteTurntable_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createInviteTurntable_dispatch] Executing createInviteTurntable flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createInviteTurntable({ token: token });

    logger.info(`[createInviteTurntable_dispatch] Result: ${JSON.stringify(result)}`);
}
