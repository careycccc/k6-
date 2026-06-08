/**
 * workOrderSuite/lib/triggerLogin.js
 * 已登录状态下触发工单的核心实现
 *
 * 流程：
 *   1. 验证码登录前台 → memberToken
 *   2. getFrontUserInfo(memberToken) → frontUserId
 *   3. GetFormList（带 memberToken）→ formId + workOrderTypeId 映射
 *   4. 按 ENABLED_LOGIN_TYPE_IDS 白名单过滤，逐个触发
 *
 * 新增已登录工单类型时：
 *   1. 在 ENABLED_LOGIN_TYPE_IDS 加入对应 workOrderTypeId
 *   2. 新增对应的触发函数
 *   3. 在分发 switch 里加 else if 分支
 */

import { sleep } from 'k6';
import { sendRequest } from '../../../common/request.js';
import { signAndPost } from './submitHelper.js';
import { uploadFrontendWithToken } from './upload.js';
import { autoLoginByAccount, detectAccountType } from '../../../user/userAccountApi.js';
import { getFrontUserInfo } from '../../../user/userManagement.js';
import { addUserBank, generateIFSC, generateTRONAddress } from '../../../withdraw/addWalletApi.js';
import { sendToGetVerCode } from '../../../login/SendVerifiyCode.test.js';
import { logger } from '../../../../../libs/utils/logger.js';

const TAG = 'TriggerLogin';

// ============================================================
// 提交工单并处理 14013（同类型进行中）
// 返回 true=成功, null=跳过(14013), false=失败
// ============================================================
function submitOrder(payload, memberToken, tag) {
    const res = signAndPost(payload, '/api/WorkOrder/Submit', true, memberToken, tag || TAG);
    if (res && res.code === 0) return true;
    if (res && res.msgCode === 14013) {
        logger.warn(`[${tag || TAG}] ⏭️ 同类型工单进行中，跳过 formId=${payload.formId}`);
        return null;
    }
    logger.error(`[${tag || TAG}] ❌ 工单提交失败: ${JSON.stringify(res)}`);
    return false;
}

// ============================================================
// 白名单
// ============================================================
const ENABLED_LOGIN_TYPE_IDS = [
    2,   // 一对一客服-已登陆
    12,  // 修改银行名称自动化
    11,  // 修改IFSC自动化
    6,   // 修改银行信息
    18,  // 删除银行卡自动化
    14,  // 删除银行卡半自动
    8,   // 修改登录密码-已登录
    17,  // 新增USDT半自动
    19,  // 删除USDT自动化
    13,  // 删除USDT半自动
    7,   // 修改真实姓名半自动
    15,  // 删除PIX自动化
    21,  // 修改提现密码自动化
    22,  // 修改提现密码半自动化
    3,   // 其他问题
];

// ============================================================
// 序号格式化
// ============================================================
function formatSeq(n) {
    return String(n).padStart(4, '0');
}

// ============================================================
// 获取工单字段列表
// ============================================================
function fetchFormFieldList(formId, memberToken) {
    const res = sendRequest({ formId }, '/api/WorkOrder/GetFormFieldList', TAG, true, memberToken);
    if (!res || !res.formFields) {
        logger.error(`[${TAG}] GetFormFieldList 失败 formId=${formId}`);
        return [];
    }
    return res.formFields;
}

// ============================================================
// 获取银行枚举（随机一条）
// ============================================================
function fetchRandomBankCode(memberToken) {
    const res = sendRequest({ withdrawType: 'BankCard' }, '/api/Withdraw/GetWalletCodeList', TAG, true, memberToken);
    if (!res || !Array.isArray(res) || res.length === 0) {
        logger.error(`[${TAG}] GetWalletCodeList 返回为空`);
        return null;
    }
    const item = res[Math.floor(Math.random() * res.length)];
    logger.info(`[${TAG}] 随机银行: ${item.code} | ${item.name}`);
    return item;
}

// ============================================================
// 通用：获取用户钱包（随机一条）
// BankCard 为空时尝试绑卡，其他类型为空直接返回 null
// ============================================================
function fetchRandomWallet(memberToken, adminToken, userId, withdrawType) {
    const res = sendRequest({ withdrawType }, '/api/Withdraw/GetUserWithdrawWallet', TAG, true, memberToken);
    if (res && Array.isArray(res) && res.length > 0) {
        const item = res[Math.floor(Math.random() * res.length)];
        logger.info(`[${TAG}] 随机 ${withdrawType} 钱包: walletId=${item.walletId}`);
        return { walletId: item.walletId, accountNo: item.accountNo };
    }
    if (withdrawType === 'BankCard') {
        logger.warn(`[${TAG}] userId=${userId} 无银行卡，尝试绑卡...`);
        const bindOk = addUserBank(adminToken, userId);
        if (!bindOk) { logger.error(`[${TAG}] 绑卡失败`); return null; }
        sleep(1);
        const retryRes = sendRequest({ withdrawType }, '/api/Withdraw/GetUserWithdrawWallet', TAG, true, memberToken);
        if (retryRes && Array.isArray(retryRes) && retryRes.length > 0) {
            const item = retryRes[Math.floor(Math.random() * retryRes.length)];
            return { walletId: item.walletId, accountNo: item.accountNo };
        }
        logger.error(`[${TAG}] 绑卡后仍无银行卡数据`); return null;
    }
    logger.error(`[${TAG}] userId=${userId} 无 ${withdrawType} 钱包数据`); return null;
}

function fetchRandomUserWallet(memberToken, adminToken, userId) {
    return fetchRandomWallet(memberToken, adminToken, userId, 'BankCard');
}

// ============================================================
// 获取已登录工单列表
// ============================================================
function fetchLoginFormList(memberToken) {
    const res = sendRequest({}, '/api/WorkOrder/GetFormList', TAG, true, memberToken);
    if (!res || !Array.isArray(res)) { logger.error(`[${TAG}] GetFormList 失败`); return []; }
    logger.info(`[${TAG}] GetFormList 返回 ${res.length} 个工单类型`);
    return res;
}

// ============================================================
// 触发函数
// ============================================================

// typeId=2：一对一客服-已登陆
function triggerCsLoginOrder(formId, workOrderTypeId, fields, userId, memberToken, env, seqCounter) {
    const seqStr = formatSeq(seqCounter);
    const formFields = [];
    for (const field of fields) {
        if (field.typeCode === 'LongText') {
            formFields.push({ typeCode: 'LongText', fieldId: field.id, fieldValue: `${userId}：${seqStr}` });
        } else if (field.typeCode === 'FileUpload' && Math.random() < 0.3) {
            logger.info(`[${TAG}] 尝试上传图片，BASE_DESK_URL=${env ? env.BASE_DESK_URL : 'undefined'}`);
            const uploadResult = uploadFrontendWithToken(env, memberToken);
            if (uploadResult.success) {
                formFields.push({ typeCode: 'FileUpload', fieldId: field.id, fieldValue: `${uploadResult.attachmentPath}?${uploadResult.attachmentName}` });
            } else {
                logger.warn(`[${TAG}] 图片上传失败，跳过 FileUpload 字段`);
            }
        }
    }
    return submitOrder({ formId, workOrderTypeId, formFields }, memberToken, TAG);
}

// typeId=12：修改银行名称自动化
function triggerChangeBankNameOrder(formId, workOrderTypeId, fields, memberToken, adminToken, userId) {
    const bankItem = fetchRandomBankCode(memberToken);
    if (!bankItem) { logger.error(`[${TAG}] 无法获取银行枚举，跳过`); return false; }
    const walletItem = fetchRandomUserWallet(memberToken, adminToken, userId);
    if (!walletItem) { logger.error(`[${TAG}] 无法获取银行卡数据，跳过`); return false; }
    const formFields = fields.map((field) => {
        if (field.typeCode === 'BankName') return { typeCode: 'BankName', fieldId: field.id, fieldValue: `${bankItem.code}|${bankItem.name}` };
        if (field.typeCode === 'BankAccountNumber') return { typeCode: 'BankAccountNumber', fieldId: field.id, fieldValue: `${walletItem.walletId}|${walletItem.accountNo}` };
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });
    return submitOrder({ formId, workOrderTypeId, formFields }, memberToken, TAG);
}

// typeId=11：修改IFSC自动化
function triggerChangeIfscOrder(formId, workOrderTypeId, fields, memberToken, adminToken, userId) {
    const walletItem = fetchRandomUserWallet(memberToken, adminToken, userId);
    if (!walletItem) { logger.error(`[${TAG}] 无银行卡数据，跳过`); return false; }
    const formFields = fields.map((field) => {
        if (field.typeCode === 'BankAccountNumber') return { typeCode: 'BankAccountNumber', fieldId: field.id, fieldValue: `${walletItem.walletId}|${walletItem.accountNo}` };
        if (field.typeCode === 'IFSC') return { typeCode: 'IFSC', fieldId: field.id, fieldValue: generateIFSC() };
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });
    return submitOrder({ formId, workOrderTypeId, formFields }, memberToken, TAG);
}

// typeId=6：修改银行信息
function triggerChangeBankInfoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, userId) {
    const walletItem = fetchRandomUserWallet(memberToken, adminToken, userId);
    if (!walletItem) { logger.error(`[${TAG}] 无银行卡数据，跳过`); return false; }
    const formFields = fields.map((field) => {
        if (field.typeCode === 'BankAccountNumber') return { typeCode: 'BankAccountNumber', fieldId: field.id, fieldValue: `${walletItem.walletId}|${walletItem.accountNo}` };
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });
    return submitOrder({ formId, workOrderTypeId, formFields }, memberToken, TAG);
}

// typeId=18：删除银行卡自动化（仅手机号）
function triggerDeleteBankAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, userId, account) {
    if (detectAccountType(account) !== 'phone') { logger.warn(`[${TAG}] 邮箱账号跳过删除银行卡自动化`); return false; }
    const walletItem = fetchRandomUserWallet(memberToken, adminToken, userId);
    if (!walletItem) { logger.error(`[${TAG}] 无银行卡数据，跳过`); return false; }
    const verifyCode = sendToGetVerCode(1, 15, account, adminToken);
    if (!verifyCode) { logger.error(`[${TAG}] 获取验证码失败，跳过`); return false; }
    const formFields = fields.map((field) => {
        if (field.typeCode === 'BankAccountNumber') return { typeCode: 'BankAccountNumber', fieldId: field.id, fieldValue: `${walletItem.walletId}|${walletItem.accountNo}` };
        if (field.typeCode === 'PhoneEmailCaptcha') return { typeCode: 'PhoneEmailCaptcha', fieldId: field.id, fieldValue: verifyCode };
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });
    return submitOrder({ formId, workOrderTypeId, formFields }, memberToken, TAG);
}

// typeId=14：删除银行卡半自动
function triggerDeleteBankSemiOrder(formId, workOrderTypeId, fields, memberToken, adminToken, userId) {
    const walletItem = fetchRandomUserWallet(memberToken, adminToken, userId);
    if (!walletItem) { logger.error(`[${TAG}] 无银行卡数据，跳过`); return false; }
    const formFields = fields.map((field) => {
        if (field.typeCode === 'BankAccountNumber') return { typeCode: 'BankAccountNumber', fieldId: field.id, fieldValue: `${walletItem.walletId}|${walletItem.accountNo}` };
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });
    return submitOrder({ formId, workOrderTypeId, formFields }, memberToken, TAG);
}

// typeId=8：修改登录密码-已登录
function triggerChangePasswordLoginOrder(formId, workOrderTypeId, fields, memberToken) {
    const formFields = fields.map((field) => {
        if (field.typeCode === 'NewPassword') return { typeCode: 'NewPassword', fieldId: field.id, fieldValue: 'qqqq1234' };
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });
    return submitOrder({ formId, workOrderTypeId, formFields }, memberToken, TAG);
}

// typeId=17：新增USDT半自动
function triggerAddUsdtOrder(formId, workOrderTypeId, fields, memberToken) {
    const formFields = fields.map((field) => {
        if (field.typeCode === 'UsdtAddress') return { typeCode: 'UsdtAddress', fieldId: field.id, fieldValue: generateTRONAddress() };
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });
    return submitOrder({ formId, workOrderTypeId, formFields }, memberToken, TAG);
}

// typeId=19：删除USDT自动化（仅手机号）
function triggerDeleteUsdtAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, userId, account) {
    if (detectAccountType(account) !== 'phone') { logger.warn(`[${TAG}] 邮箱账号跳过删除USDT自动化`); return false; }
    const walletItem = fetchRandomWallet(memberToken, adminToken, userId, 'USDT');
    if (!walletItem) { logger.error(`[${TAG}] 无USDT钱包数据，跳过`); return false; }
    const verifyCode = sendToGetVerCode(1, 15, account, adminToken);
    if (!verifyCode) { logger.error(`[${TAG}] 获取验证码失败，跳过`); return false; }
    const formFields = fields.map((field) => {
        if (field.typeCode === 'UsdtAddress') return { typeCode: 'UsdtAddress', fieldId: field.id, fieldValue: `${walletItem.walletId}|${walletItem.accountNo}` };
        if (field.typeCode === 'PhoneEmailCaptcha') return { typeCode: 'PhoneEmailCaptcha', fieldId: field.id, fieldValue: verifyCode };
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });
    return submitOrder({ formId, workOrderTypeId, formFields }, memberToken, TAG);
}

// typeId=13：删除USDT半自动
function triggerDeleteUsdtSemiOrder(formId, workOrderTypeId, fields, memberToken, adminToken, userId) {
    const walletItem = fetchRandomWallet(memberToken, adminToken, userId, 'USDT');
    if (!walletItem) { logger.error(`[${TAG}] 无USDT钱包数据，跳过`); return false; }
    const formFields = fields.map((field) => {
        if (field.typeCode === 'UsdtAddress') return { typeCode: 'UsdtAddress', fieldId: field.id, fieldValue: `${walletItem.walletId}|${walletItem.accountNo}` };
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });
    return submitOrder({ formId, workOrderTypeId, formFields }, memberToken, TAG);
}

// typeId=7：修改真实姓名半自动
function triggerChangeRealNameOrder(formId, workOrderTypeId, fields, memberToken) {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    let suffix = '';
    for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
    const formFields = fields.map((field) => {
        if (field.typeCode === 'RealName') return { typeCode: 'RealName', fieldId: field.id, fieldValue: `autoTest${suffix}` };
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });
    return submitOrder({ formId, workOrderTypeId, formFields }, memberToken, TAG);
}

// typeId=15：删除PIX自动化（仅手机号）
function triggerDeletePixAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, userId, account) {
    if (detectAccountType(account) !== 'phone') { logger.warn(`[${TAG}] 邮箱账号跳过删除PIX自动化`); return false; }
    const walletItem = fetchRandomWallet(memberToken, adminToken, userId, 'PIX');
    if (!walletItem) { logger.error(`[${TAG}] 无PIX钱包数据，跳过`); return false; }
    const verifyCode = sendToGetVerCode(1, 15, account, adminToken);
    if (!verifyCode) { logger.error(`[${TAG}] 获取验证码失败，跳过`); return false; }
    const formFields = fields.map((field) => {
        if (field.typeCode === 'PixAccount') return { typeCode: 'PixAccount', fieldId: field.id, fieldValue: `${walletItem.walletId}|${walletItem.accountNo}` };
        if (field.typeCode === 'PixType') return { typeCode: 'PixType', fieldId: field.id, fieldValue: 'Phone|Phone' };
        if (field.typeCode === 'PhoneEmailCaptcha') return { typeCode: 'PhoneEmailCaptcha', fieldId: field.id, fieldValue: verifyCode };
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });
    return submitOrder({ formId, workOrderTypeId, formFields }, memberToken, TAG);
}

// typeId=21：修改提现密码自动化（仅手机号）
function triggerChangeWithdrawPwdAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, account) {
    if (detectAccountType(account) !== 'phone') { logger.warn(`[${TAG}] 邮箱账号跳过修改提现密码自动化`); return false; }
    const verifyCode = sendToGetVerCode(1, 15, account, adminToken);
    if (!verifyCode) { logger.error(`[${TAG}] 获取验证码失败，跳过`); return false; }
    let newPwd = '';
    for (let i = 0; i < 6; i++) newPwd += Math.floor(Math.random() * 10);
    const formFields = fields.map((field) => {
        if (field.typeCode === 'NewWithdrawPassword') return { typeCode: 'NewWithdrawPassword', fieldId: field.id, fieldValue: newPwd };
        if (field.typeCode === 'PhoneEmailCaptcha') return { typeCode: 'PhoneEmailCaptcha', fieldId: field.id, fieldValue: verifyCode };
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });
    return submitOrder({ formId, workOrderTypeId, formFields }, memberToken, TAG);
}

// typeId=22：修改提现密码半自动化
function triggerChangeWithdrawPwdSemiOrder(formId, workOrderTypeId, fields, memberToken) {
    let newPwd = '';
    for (let i = 0; i < 6; i++) newPwd += Math.floor(Math.random() * 10);
    const formFields = fields.map((field) => {
        if (field.typeCode === 'NewWithdrawPassword') return { typeCode: 'NewWithdrawPassword', fieldId: field.id, fieldValue: newPwd };
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });
    return submitOrder({ formId, workOrderTypeId, formFields }, memberToken, TAG);
}

// typeId=3：其他问题
function triggerOtherIssueOrder(formId, workOrderTypeId, fields, memberToken, frontUserId, seqCounter) {
    const seqStr = String(seqCounter).padStart(3, '0');
    const content = `${frontUserId}:otherissues${seqStr}`;
    const formFields = fields.map((field) => {
        if (field.typeCode === 'LongText') return { typeCode: 'LongText', fieldId: field.id, fieldValue: content };
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });
    return submitOrder({ formId, workOrderTypeId, formFields }, memberToken, TAG);
}

// ============================================================
// 公开：已登录单账号触发所有白名单工单
// ============================================================
export function triggerLoginForAccount(adminToken, tenantId, account, userId, env, memberTokenMap = null) {
    logger.info(`[${TAG}] ===== 已登录工单触发 账号=${account} (userId=${userId}) =====`);

    // Step 1: 获取前台 token（优先从 token 映射表取，没有才重新登录）
    let memberToken = null;
    if (memberTokenMap && memberTokenMap[userId]) {
        memberToken = memberTokenMap[userId];
        logger.info(`[${TAG}] ✅ 复用预登录 token (userId=${userId})`);
    } else {
        logger.info(`[${TAG}] 映射表无 token，重新登录: ${account}`);
        memberToken = autoLoginByAccount(account, adminToken);
        if (memberToken && memberTokenMap) {
            memberTokenMap[userId] = memberToken; // 缓存
        }
    }
    if (!memberToken) { logger.error(`[${TAG}] 登录失败，跳过`); return; }
    logger.info(`[${TAG}] ✅ token 就绪`);

    // Step 2: 获取前台 userId
    const userInfo = getFrontUserInfo(memberToken);
    if (!userInfo || !userInfo.userId) { logger.error(`[${TAG}] 获取前台 userId 失败，跳过`); return; }
    const frontUserId = userInfo.userId;
    logger.info(`[${TAG}] 前台 userId: ${frontUserId}`);

    // Step 3: 获取已登录工单列表
    const formList = fetchLoginFormList(memberToken);
    if (formList.length === 0) { logger.warn(`[${TAG}] 工单列表为空，跳过`); return; }

    let successCount = 0;
    let skipCount    = 0;
    let failCount    = 0;
    let seqCounter   = 1;
    let otherIssueSeq = 1;

    for (const form of formList) {
        const { id: formId, workOrderTypeId } = form;

        if (!ENABLED_LOGIN_TYPE_IDS.includes(workOrderTypeId)) {
            logger.info(`[${TAG}] ⏭️ 跳过 typeId=${workOrderTypeId} (${form.workOrderTypeName})`);
            skipCount++;
            continue;
        }

        logger.info(`[${TAG}] → 触发: ${form.workOrderTypeName} (formId=${formId}, typeId=${workOrderTypeId})`);

        const fields = fetchFormFieldList(formId, memberToken);
        if (fields.length === 0) {
            logger.warn(`[${TAG}] 字段为空，跳过 formId=${formId}`);
            skipCount++;
            sleep(0.5);
            continue;
        }
        sleep(0.3);

        let ok = false;
        if (workOrderTypeId === 2) {
            ok = triggerCsLoginOrder(formId, workOrderTypeId, fields, frontUserId, memberToken, env, seqCounter);
            seqCounter++;
        } else if (workOrderTypeId === 12) {
            ok = triggerChangeBankNameOrder(formId, workOrderTypeId, fields, memberToken, adminToken, frontUserId);
        } else if (workOrderTypeId === 11) {
            ok = triggerChangeIfscOrder(formId, workOrderTypeId, fields, memberToken, adminToken, frontUserId);
        } else if (workOrderTypeId === 6) {
            ok = triggerChangeBankInfoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, frontUserId);
        } else if (workOrderTypeId === 18) {
            ok = triggerDeleteBankAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, frontUserId, account);
        } else if (workOrderTypeId === 14) {
            ok = triggerDeleteBankSemiOrder(formId, workOrderTypeId, fields, memberToken, adminToken, frontUserId);
        } else if (workOrderTypeId === 8) {
            ok = triggerChangePasswordLoginOrder(formId, workOrderTypeId, fields, memberToken);
        } else if (workOrderTypeId === 17) {
            ok = triggerAddUsdtOrder(formId, workOrderTypeId, fields, memberToken);
        } else if (workOrderTypeId === 19) {
            ok = triggerDeleteUsdtAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, frontUserId, account);
        } else if (workOrderTypeId === 13) {
            ok = triggerDeleteUsdtSemiOrder(formId, workOrderTypeId, fields, memberToken, adminToken, frontUserId);
        } else if (workOrderTypeId === 7) {
            ok = triggerChangeRealNameOrder(formId, workOrderTypeId, fields, memberToken);
        } else if (workOrderTypeId === 15) {
            ok = triggerDeletePixAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, frontUserId, account);
        } else if (workOrderTypeId === 21) {
            ok = triggerChangeWithdrawPwdAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, account);
        } else if (workOrderTypeId === 22) {
            ok = triggerChangeWithdrawPwdSemiOrder(formId, workOrderTypeId, fields, memberToken);
        } else if (workOrderTypeId === 3) {
            ok = triggerOtherIssueOrder(formId, workOrderTypeId, fields, memberToken, frontUserId, otherIssueSeq);
            otherIssueSeq++;
        }
        // 后续新增工单类型在此加 else if 分支

        if (ok === true) {
            successCount++;
        } else if (ok === null) {
            skipCount++; // 14013：同类型工单进行中
        } else {
            failCount++;
        }

        sleep(1);
    }

    logger.info(
        `[${TAG}] 已登录触发完成 账号=${account} ` +
        `成功=${successCount} 跳过=${skipCount} 失败=${failCount}`
    );
}
