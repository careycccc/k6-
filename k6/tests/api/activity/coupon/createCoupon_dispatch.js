import { createCoupon } from './createCoupon.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createCoupon_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createCoupon_dispatch] Executing createCoupon flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createCoupon({ token: token });

    logger.info(`[createCoupon_dispatch] Result: ${JSON.stringify(result)}`);
}
