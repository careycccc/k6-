import { createTag } from './createTag.js';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';

export default function () {
    const token = AdminLogin();

    if (!token) {
        logger.error(`[createTag_dispatch] 后台登录失败，无法创建活动`);
        return;
    }

    logger.info(`[createTag_dispatch] Executing createTag flow for platform: ${__ENV.TENANT_ID || 'default'}`);

    const result = createTag({ token: token });

    logger.info(`[createTag_dispatch] Result: ${JSON.stringify(result)}`);
}
