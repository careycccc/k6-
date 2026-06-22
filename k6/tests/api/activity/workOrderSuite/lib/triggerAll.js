/**
 * workOrderSuite/lib/triggerAll.js
 * 单账号触发已提供处理逻辑的未登录工单类型
 *
 * 只触发 ENABLED_QUERY_IDS 白名单中 isLoginForm=0 的工单。
 * 新增类型时在此处添加对应的 queryId 即可。
 */

import { sleep } from 'k6';
import { orderSystemConfig } from '../../orderSystem/oderyconfig.js';
import { sendRequest, sendQueryRequest } from '../../../common/request.js';
import { signAndPost } from './submitHelper.js';
import { logger } from '../../../../../libs/utils/logger.js';
import { PERF_METRICS, ERROR_COUNTERS } from '../../../../../libs/monitor/perfMetrics.js';

const TAG = 'TriggerAll';

// ============================================================
// 白名单：只触发已提供处理逻辑的工单类型（用 queryId 匹配）
// 新增类型时在此处添加对应的 queryId 值即可
// ============================================================
const ENABLED_QUERY_IDS = [
    2,   // 一对一客服-未登陆（isLoginForm:0）
    8,   // 修改登录密码半自动-未登陆（isLoginForm:0）
    9,   // 忘记会员账号（isLoginForm:0）
    10,  // 会员账号解冻半自动（isLoginForm:0）
];

// ============================================================
// 字段值生成器
// ============================================================
function buildFieldValue(type, account, formId) {
    switch (type) {
        case 'UserName':             return account || 'testuser001';
        case 'LongText':             return `autotest_${account}_form${formId}_${Date.now()}`;
        case 'NewPassword':          return 'qqqq1234';
        case 'NewWithdrawPassword':  return 'qqqq1234';
        case 'PhoneEmailCaptcha':    return '123456';
        case 'RealName':             return 'Test Name';
        case 'DepositOrderNo':       return `DEP${Date.now()}`;
        case 'OrderAmount':          return '100';
        case 'WithdrawOrderNo':      return `WIT${Date.now()}`;
        case 'WithdrawAmount':       return '50';
        case 'BankAccountNumber':    return '1234567890123456';
        case 'BankName':             return 'Test Bank';
        case 'IFSC':                 return 'SBIN0001234';
        case 'UsdtAddress':          return 'TTestUsdtAddress123456789012345';
        case 'PixAccount':           return 'test@pix.com';
        case 'PixType':              return 'EMAIL';
        case 'EWallet':              return 'testewallet001';
        default:                     return `test_${type}_value`;
    }
}

// ============================================================
// 内部：查询某工单类型下所有已开启的表单
// ============================================================
function fetchFirstActiveForm(config, adminToken) {
    const res = sendQueryRequest(
        { workOrderTypeId: config.queryId, isLoginForm: config.isLoginForm, pageNo: 1, pageSize: 20 },
        '/api/TenantForm/GetPageList',
        TAG,
        false,
        adminToken
    );

    if (!res || !res.list || res.list.length === 0) {
        logger.warn(`[${TAG}] "${config.name}" 未找到表单，跳过触发`);
        return null;
    }

    const active = res.list.find((f) => f.state === 1);
    if (!active) {
        logger.warn(`[${TAG}] "${config.name}" 没有开启的表单，跳过触发`);
        return null;
    }

    return active;
}

// ============================================================
// 内部：提交一个工单
// ============================================================
function submitWorkOrder(formId, workOrderTypeId, fields, account, memberToken, isLoginForm) {
    // 按字段类型生成测试值
    const formFields = (fields || []).map((field) => ({
        typeCode: field.type,
        fieldId:  field.id || 0,
        fieldValue: buildFieldValue(field.type, account, formId),
    }));

    const basePayload = { formId, workOrderTypeId };

    // 已登录工单用会员 token；未登录工单传空串
    const token = isLoginForm ? (memberToken || '') : '';

    logger.info(`[${TAG}] 提交工单 formId=${formId} typeId=${workOrderTypeId} isLogin=${isLoginForm} fields=${formFields.length}`);

    const res = signAndPost(
        { ...basePayload, formFields },
        '/api/WorkOrder/Submit',
        true,   // isDesk（前台接口）
        token,
        TAG,
        {
            trendObj: PERF_METRICS.WORK_ORDER_CREATE,
            errorCounter: ERROR_COUNTERS.WORK_ORDER_SUBMIT_FAIL,
        }
    );

    if (res && res.code === 0) {
        logger.info(`[${TAG}] ✅ 工单提交成功: formId=${formId}`);
        return true;
    }

    // 同类型工单进行中，跳过（不算失败）
    if (res && res.msgCode === 14013) {
        logger.warn(`[${TAG}] ⏭️ 同类型工单进行中，跳过 formId=${formId}`);
        ERROR_COUNTERS.INVENTORY_FAIL.add(1);
        return null; // null 表示跳过，不计入失败
    }

    logger.error(`[${TAG}] ❌ 工单提交失败: formId=${formId} → ${JSON.stringify(res)}`);
    return false;
}

// ============================================================
// 公开：单账号触发全部工单
// ============================================================

/**
 * 触发 orderSystemConfig 中白名单内的未登录工单类型
 *
 * @param {string} adminToken   - 后台管理员 token
 * @param {string} tenantId     - 租户 ID（日志用）
 * @param {string} account      - 会员账号（手机号/邮箱，用于填 UserName 字段）
 * @param {number} userId       - 会员 userId（日志用）
 */
export function triggerAllForAccount(adminToken, tenantId, account, userId) {
    const memberAccount = account;

    logger.info(`[${TAG}] 账号 ${memberAccount} (userId=${userId}) 开始触发未登录工单`);
    logger.info(`[${TAG}] 当前启用的 queryId: [${ENABLED_QUERY_IDS.join(', ')}]`);

    // 过滤出白名单内的配置（只取未登录的，isLoginForm:0）
    const enabledConfigs = orderSystemConfig.filter(
        (c) => ENABLED_QUERY_IDS.includes(c.queryId) && c.isLoginForm === 0
    );
    if (enabledConfigs.length === 0) {
        logger.warn(`[${TAG}] 白名单为空，没有可触发的工单类型`);
        return;
    }

    // 只有白名单中存在已登录工单时才需要登录（当前白名单全是未登录工单，此分支不会触发）
    let memberToken = null;
    const hasLoginForms = enabledConfigs.some((c) => c.isLoginForm === 1);
    if (hasLoginForms) {
        logger.warn(`[${TAG}] 白名单中存在已登录工单，但 triggerAll.js 只处理未登录工单，请检查配置`);
    }

    let successCount = 0;
    let skipCount    = 0;
    let failCount    = 0;

    for (const config of enabledConfigs) {
        logger.info(`[${TAG}] → 触发工单: "${config.name}" (typeId=${config.queryId}, isLogin=${config.isLoginForm})`);

        // 已登录工单但 token 获取失败 → 跳过
        if (config.isLoginForm === 1 && !memberToken) {
            logger.warn(`[${TAG}] 跳过已登录工单（无 token）: ${config.name}`);
            skipCount++;
            sleep(0.5);
            continue;
        }

        // 查询该类型下已开启的 formId
        const form = fetchFirstActiveForm(config, adminToken);
        if (!form) {
            skipCount++;
            sleep(0.5);
            continue;
        }

        // 获取表单字段详情（需要 fieldId）
        let fields = config.fields || [];
        if (fields.length > 0) {
            const detail = sendRequest(
                { id: form.id },
                '/api/TenantForm/Get',
                TAG,
                false,
                adminToken
            );
            if (detail && detail.translationData && detail.translationData.length > 0) {
                const trans = detail.translationData.find((t) => t.language === 'en') || detail.translationData[0];
                // 用接口返回的 fieldId 替换 config 里的静态定义
                fields = (trans.fields || []).map((f) => ({ type: f.type, id: f.id }));
            }
            sleep(0.3);
        }

        const ok = submitWorkOrder(
            form.id,
            config.queryId,
            fields,
            memberAccount,
            memberToken,
            config.isLoginForm
        );

        if (ok === true) {
            successCount++;
        } else if (ok === null) {
            skipCount++; // 同类型工单进行中，跳过
        } else {
            failCount++;
        }

        sleep(1); // 每条工单之间间隔 1s，避免限流
    }

    logger.info(
        `[${TAG}] 账号 ${account} 未登录触发完成 ` +
        `成功=${successCount} 跳过=${skipCount} 失败=${failCount}`
    );
}
