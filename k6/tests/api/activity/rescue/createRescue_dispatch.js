import { createRescue } from './createRescue.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createRescue_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createRescue_dispatch] Executing createRescue flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createRescue({ token: token });

    logger.info(`[createRescue_dispatch] Result: ${JSON.stringify(result)}`);
}
