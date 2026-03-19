import { createGiftPack } from './createGiftPack.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createGiftPack_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createGiftPack_dispatch] Executing createGiftPack flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createGiftPack({ token: token });

    logger.info(`[createGiftPack_dispatch] Result: ${JSON.stringify(result)}`);
}
