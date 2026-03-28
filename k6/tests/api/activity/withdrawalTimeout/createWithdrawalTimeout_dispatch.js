import { createWithdrawalTimeout } from './createWithdrawalTimeout.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createWithdrawalTimeout_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createWithdrawalTimeout_dispatch] Executing createWithdrawalTimeout flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createWithdrawalTimeout({ token: token });

    logger.info(`[createWithdrawalTimeout_dispatch] Result: ${JSON.stringify(result)}`);
}
