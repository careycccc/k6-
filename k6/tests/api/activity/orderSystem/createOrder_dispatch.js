import { createOrder } from './createOrder.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createOrder_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createOrder_dispatch] Executing createOrder flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createOrder({ token: token });

    logger.info(`[createOrder_dispatch] Result: ${JSON.stringify(result)}`);
}
