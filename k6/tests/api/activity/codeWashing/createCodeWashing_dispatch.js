import { createCodeWashing } from './createCodeWashing.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createCodeWashing_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createCodeWashing_dispatch] Executing createCodeWashing flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createCodeWashing({ token: token });

    logger.info(`[createCodeWashing_dispatch] Result: ${JSON.stringify(result)}`);
}
