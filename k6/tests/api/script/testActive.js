
import { AdminLogin, adminTag } from '../login/adminlogin.test.js';
// import { createLoginPopup } from '../activity/loginPopup/createLoginPopup.js';
// import { createCustomizePopup } from '../activity/customizePopup/createCustomizePopup.js';
import { createBanner } from '../activity/banner/createBanner.js';
import { createTagfunc as createTagfuncfunc } from '../activity/tag/createTag.js';

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

    // 步骤2：创建幸运礼包
    // logger.info('========== 步骤2：创建幸运礼包 ==========');
    // const giftPackResult = createChampion(data);
    // if (!giftPackResult || !giftPackResult.success) {
    //     logger.error(`幸运礼包创建失败: ${giftPackResult?.message || '未知错误'}`);
    //     return;
    // }
    // logger.info('幸运礼包创建成功');

    // 等待2秒
    // sleep(2);

    // 步骤3：创建登录前弹窗
    // logger.info('========== 步骤3：创建登录前弹窗 ==========');
    // const loginPopupResult = createLoginPopup(data);
    // if (!loginPopupResult || !loginPopupResult.success) {
    //     logger.error(`登录前弹窗创建失败: ${loginPopupResult?.message || '未知错误'}`);
    //     return;
    // }
    // logger.info('登录前弹窗创建成功');

    // 等待2秒
    //sleep(2);

    // 步骤4：创建定制化弹窗
    // logger.info('========== 步骤4：创建定制化弹窗 ==========');
    // const customizePopupResult = createCustomizePopup(data);
    // if (!customizePopupResult || !customizePopupResult.success) {
    //     logger.error(`定制化弹窗创建失败: ${customizePopupResult?.message || '未知错误'}`);
    //     return;
    // }
    // logger.info('定制化弹窗创建成功');

    // // 等待2秒
    // sleep(2);

    // 步骤5：创建轮播图
    logger.info('========== 步骤5：创建轮播图 ==========');
    const bannerResult = createBanner(data);
    if (!bannerResult || !bannerResult.success) {
        logger.error(`轮播图创建失败: ${bannerResult?.message || '未知错误'}`);
        return;
    }
    logger.info('轮播图创建成功');

    logger.info('所有活动创建完成');
}
