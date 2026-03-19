import { createNewagent } from './createNewagent.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createNewagent_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createNewagent_dispatch] Executing createNewagent flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createNewagent({ token: token });

    logger.info(`[createNewagent_dispatch] Result: ${JSON.stringify(result)}`);
}
