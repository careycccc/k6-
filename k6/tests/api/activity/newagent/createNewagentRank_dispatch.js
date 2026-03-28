import { createNewagentRank } from './createNewagentRank.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createNewagentRank_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createNewagentRank_dispatch] Executing createNewagentRank flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createNewagentRank({ token: token });

    logger.info(`[createNewagentRank_dispatch] Result: ${JSON.stringify(result)}`);
}
