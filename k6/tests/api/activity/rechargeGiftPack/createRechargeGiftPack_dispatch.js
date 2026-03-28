import { createRechargeGiftPack } from './createRechargeGiftPack.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createRechargeGiftPack_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createRechargeGiftPack_dispatch] Executing createRechargeGiftPack flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createRechargeGiftPack({ token: token });

    logger.info(`[createRechargeGiftPack_dispatch] Result: ${JSON.stringify(result)}`);
}
