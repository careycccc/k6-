import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import * as api from './api.js';
import * as supplier from './supplier.js';
import { defaultPayloadPatcher } from './memberLimitPayloadBuilder.js';

const CACHE_FLUSH_DELAY = 1.5;
const TAG = 'MemberLimitAdapter';

/**
 * 执行会员准入全套测试
 * @param {string} adminToken - 后台管理员Token
 * @param {object} options - 适配器配置项
 * @param {string} options.activityUpdateApi - 修改活动配置的接口
 * @param {object} options.basePayload - 修改活动配置时的基础 payload
 * @param {function} options.triggerActivity - (userId, expectedSuccess, testName) => boolean 执行活动触发与断言的函数
 * @param {function} [options.patchPayload] - (basePayload, context) => object 可选，自定义组装 payload 的逻辑
 * @param {object} [options.supplierOptions] - (可选) 传递给 supplier 的配置，比如固定分组ID或标签ID
 */
export function runMemberLimitAdapter(adminToken, options) {
    const {
        activityUpdateApi,
        basePayload,
        triggerActivity,
        patchPayload = defaultPayloadPatcher,
        supplierOptions = {}
    } = options;

    logger.info(`[${TAG}] ========== 启动会员准入测试框架 ==========`);

    function runTestCase(name, supplyFn, executeFn) {
        logger.info(`[${TAG}] `);
        logger.info(`[${TAG}] >>>>> 准备执行: ${name}`);
        const data = supplyFn();
        if (!data) {
            logger.warn(`[${TAG}] ⚠️ 寻号失败，跳过 ${name}`);
            return;
        }
        
        const payload = patchPayload(basePayload, data.config);
        logger.info(`[${TAG}] 注入配置: ${JSON.stringify(data.config)}`);
        
        const updateRes = api.updateActivityConfig(adminToken, activityUpdateApi, payload);
        if (!updateRes || updateRes.code !== 0 && updateRes.msgCode !== 0) {
            logger.error(`[${TAG}] ❌ 更新活动配置失败: ${JSON.stringify(updateRes)}`);
            return;
        }

        logger.info(`[${TAG}] 配置更新成功，等待缓存刷新...`);
        sleep(CACHE_FLUSH_DELAY);

        try {
            executeFn(data);
        } finally {
            // 自愈 Teardown
            if (data.positive?.isForced) {
                logger.info(`[${TAG}] 执行 Teardown: 还原正向账号分组`);
                api.updateUserGroup(adminToken, data.positive.userId, data.positive.originalGroupId || 0);
            }
            if (data.negative1?.isForced) {
                logger.info(`[${TAG}] 执行 Teardown: 还原逆向账号分组`);
                api.updateUserGroup(adminToken, data.negative1.userId, 0);
            }
        }
    }

    // TC-01 指定分组准入
    runTestCase("指定分组准入", () => supplier.supplyForGroup(adminToken, supplierOptions), (data) => {
        triggerActivity(data.positive.userId, true, "正向-在指定分组");
        triggerActivity(data.negative.userId, false, "逆向-不在指定分组");
    });

    // TC-02 注册时间限制
    runTestCase("注册时间准入", () => supplier.supplyForTime(adminToken), (data) => {
        triggerActivity(data.positive.userId, true, "正向-新注册会员");
        triggerActivity(data.negative.userId, false, "逆向-老会员(超24h)");
    });

    // TC-03 VIP等级准入
    runTestCase("VIP等级准入", () => supplier.supplyForVip(adminToken), (data) => {
        triggerActivity(data.positive.userId, true, "正向-VIP等级相符");
        triggerActivity(data.negative.userId, false, "逆向-VIP等级不符");
    });

    // TC-04 渠道来源准入
    runTestCase("渠道准入", () => supplier.supplyForChannel(adminToken), (data) => {
        triggerActivity(data.positive.userId, true, "正向-在指定渠道");
        triggerActivity(data.negative.userId, false, "逆向-不在指定渠道");
    });

    // TC-05 剔除测试
    runTestCase("剔除分组与组合标签", () => supplier.supplyForExclude(adminToken, supplierOptions), (data) => {
        triggerActivity(data.positive.userId, true, "正向-没分组也没标签");
        triggerActivity(data.negative1.userId, false, "逆向-有分组无标签");
        triggerActivity(data.negative2.userId, false, "逆向-无分组有标签");
    });

    // TC-06 组合标签准入
    runTestCase("组合标签准入", () => supplier.supplyForTag(adminToken, supplierOptions), (data) => {
        triggerActivity(data.positive.userId, true, "正向-拥有指定标签");
        triggerActivity(data.negative.userId, false, "逆向-没有指定标签");
    });

    // TC-07 全平台 (恢复默认配置)
    logger.info(`[${TAG}] `);
    logger.info(`[${TAG}] >>>>> 准备执行: 恢复为全平台准入`);
    const finalPayload = patchPayload(basePayload, { type: 'platform' });
    api.updateActivityConfig(adminToken, activityUpdateApi, finalPayload);
    sleep(CACHE_FLUSH_DELAY);

    logger.info(`[${TAG}] ========== 会员准入测试框架执行完毕 ==========`);
}
