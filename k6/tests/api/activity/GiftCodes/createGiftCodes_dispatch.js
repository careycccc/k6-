import { createGiftCodes } from './createGiftCodes.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createGiftCodes_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createGiftCodes_dispatch] Executing createGiftCodes flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createGiftCodes({ token: token });

    logger.info(`[createGiftCodes_dispatch] Result: ${JSON.stringify(result)}`);
}
