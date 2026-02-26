
import { AdminLogin, adminTag } from '../login/adminlogin.test.js';
import { createRedRainActivity as createRedRainActivityfunc } from '../activity/RedRainActivity/createRedRainActivity.js';
import { createTagfunc as createTagfuncfunc } from '../activity/tag/createTag.js'

import { logger } from '../../../libs/utils/logger.js';
import { sleep } from 'k6';

// ==================== setup：全局登录一次 ====================
export function setup() {
    try {
        const token = AdminLogin();
        if (!token) {
            logger.error('AdminLogin 返回空值，登录失败');
            throw new Error('AdminLogin 返回空 token');
        }
        return { token };
    } catch (error) {
        logger.error('AdminLogin 发生异常:', error.message);
        throw new Error(`登录失败: ${error.message}`);
    }
}

// ==================== scenarios 定义 ====================
export const options = {
    scenarios: {
        // 单一场景：按顺序执行所有活动
        sequentialExecution: {
            executor: 'shared-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '120s'
        }
    },
};

// ==================== 必须的 default（按顺序执行所有活动） ====================
export default function (data) {
    logger.info('开始按顺序执行活动创建');

    // 步骤1：创建标签
    // logger.info('========== 步骤1：创建标签 ==========');
    // const tagResult = createTagfuncfunc(data);
    // if (!tagResult || !tagResult.success) {
    //     logger.error(`标签创建失败: ${tagResult?.message || '未知错误'}`);
    //     return;
    // }
    // logger.info('标签创建成功');

    // // 等待2秒
    // sleep(2);

    // 步骤2：创建充值礼包
    logger.info('========== 步骤2：创建红包雨 ==========');
    const giftPackResult = createRedRainActivityfunc(data);
    if (!giftPackResult || !giftPackResult.success) {
        logger.error(`红包雨创建失败: ${giftPackResult?.message || '未知错误'}`);
        return;
    }
    logger.info('红包雨创建成功');

    logger.info('所有活动创建完成');
}
