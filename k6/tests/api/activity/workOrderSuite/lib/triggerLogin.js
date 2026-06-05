/**
 * workOrderSuite/lib/triggerLogin.js
 * 已登录状态下触发工单的核心实现
 *
 * 流程：
 *   1. 后台查询账号 → 验证码登录 → memberToken
 *   2. getFrontUserInfo(memberToken) → userId
 *   3. GetFormList（带 memberToken）→ 保存 formId + workOrderTypeId 映射
 *   4. 按 ENABLED_LOGIN_TYPE_IDS 白名单过滤，逐个触发
 *   5. 触发后的客服处理逻辑与未登录一对一客服相同（交叉回复）
 *
 * 新增已登录工单类型时：
 *   1. 在 ENABLED_LOGIN_TYPE_IDS 加入对应 workOrderTypeId
 *   2. 在 buildLoginFormFields() 加入对应字段构建逻辑
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
// 白名单：只触发已提供完整步骤的已登录工单类型
// 新增时加入对应的 workOrderTypeId
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
// 序号格式化：1 → "0001"，10 → "0010"
// ============================================================
function formatSeq(n) {
    return String(n).padStart(4, '0');
}

// ============================================================
// 获取工单的字段列表（fieldId）
// ============================================================
function fetchFormFieldList(formId, memberToken) {
    const res = sendRequest(
        { formId },
        '/api/WorkOrder/GetFormFieldList',
        TAG,
        true,   // isDesk（前台接口）
        memberToken
    );

    if (!res || !res.formFields) {
        logger.error(`[${TAG}] GetFormFieldList 失败 formId=${formId}`);
        return [];
    }

    return res.formFields; // [{ id, typeCode, fieldName, isRequired }, ...]
}

// ============================================================
// 获取银行枚举列表，随机返回一条 { code, name }
// ============================================================
function fetchRandomBankCode(memberToken) {
    const res = sendRequest(
        { withdrawType: 'BankCard' },
        '/api/Withdraw/GetWalletCodeList',
        TAG,
        true,
        memberToken
    );

    if (!res || !Array.isArray(res) || res.length === 0) {
        logger.error(`[${TAG}] GetWalletCodeList 返回为空`);
        return null;
    }

    const item = res[Math.floor(Math.random() * res.length)];
    logger.info(`[${TAG}] 随机银行: ${item.code} | ${item.name}`);
    return item;
}

// ============================================================
// 获取用户绑定的银行卡，随机返回一条 { walletId, accountNo }
// 若为空则尝试绑卡，绑卡失败返回 null
// ============================================================
function fetchRandomUserWallet(memberToken, adminToken, userId) {
    return fetchRandomWallet(memberToken, adminToken, userId, 'BankCard');
}

// ============================================================
// 修改银行名称自动化（typeId=12）：触发工单提交
// 前置：获取银行枚举 + 获取用户绑定银行卡
// ============================================================
function triggerChangeBankNameOrder(formId, workOrderTypeId, fields, memberToken, adminToken, userId) {
    // 前置1：获取随机银行枚举
    const bankItem = fetchRandomBankCode(memberToken);
    if (!bankItem) {
        logger.error(`[${TAG}] 无法获取银行枚举，跳过修改银行名称工单`);
        return false;
    }

    // 前置2：获取用户绑定银行卡
    const walletItem = fetchRandomUserWallet(memberToken, adminToken, userId);
    if (!walletItem) {
        logger.error(`[${TAG}] 无法获取银行卡数据，跳过修改银行名称工单`);
        return false;
    }

    // 按 fieldId 构建 formFields
    const formFields = fields.map((field) => {
        if (field.typeCode === 'BankName') {
            return {
                typeCode: 'BankName',
                fieldId:  field.id,
                fieldValue: `${bankItem.code}|${bankItem.name}`,
            };
        }
        if (field.typeCode === 'BankAccountNumber') {
            return {
                typeCode: 'BankAccountNumber',
                fieldId:  field.id,
                fieldValue: `${walletItem.walletId}|${walletItem.accountNo}`,
            };
        }
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });

    const payload = { formId, workOrderTypeId, formFields };
    const res = signAndPost(payload, '/api/WorkOrder/Submit', true, memberToken, TAG);

    if (res && res.code === 0) {
        logger.info(`[${TAG}] ✅ 修改银行名称工单提交成功 formId=${formId}`);
        return true;
    }
    logger.error(`[${TAG}] ❌ 修改银行名称工单提交失败: ${JSON.stringify(res)}`);
    return false;
}

// ============================================================
// 通用：按 withdrawType 获取用户钱包，随机返回一条 { walletId, accountNo }
// 为空时尝试绑卡（仅 BankCard 类型），其他类型为空直接返回 null
// ============================================================
function fetchRandomWallet(memberToken, adminToken, userId, withdrawType) {
    const res = sendRequest(
        { withdrawType },
        '/api/Withdraw/GetUserWithdrawWallet',
        TAG,
        true,
        memberToken
    );

    if (res && Array.isArray(res) && res.length > 0) {
        const item = res[Math.floor(Math.random() * res.length)];
        logger.info(`[${TAG}] 随机 ${withdrawType} 钱包: walletId=${item.walletId}`);
        return { walletId: item.walletId, accountNo: item.accountNo };
    }

    if (withdrawType === 'BankCard') {
        logger.warn(`[${TAG}] userId=${userId} 无银行卡，尝试绑卡...`);
        const bindOk = addUserBank(adminToken, userId);
        if (!bindOk) {
            logger.error(`[${TAG}] 绑卡失败，跳过工单`);
            return null;
        }
        sleep(1);
        const retryRes = sendRequest(
            { withdrawType },
            '/api/Withdraw/GetUserWithdrawWallet',
            TAG,
            true,
            memberToken
        );
        if (retryRes && Array.isArray(retryRes) && retryRes.length > 0) {
            const item = retryRes[Math.floor(Math.random() * retryRes.length)];
            return { walletId: item.walletId, accountNo: item.accountNo };
        }
        logger.error(`[${TAG}] 绑卡后仍无银行卡数据，跳过工单`);
        return null;
    }

    logger.error(`[${TAG}] userId=${userId} 无 ${withdrawType} 钱包数据，跳过工单`);
    return null;
}

// ============================================================
// 删除USDT自动化（typeId=19）：需验证码，提交后系统自动执行
// 账号必须是手机号，邮箱跳过
// ============================================================
function triggerDeleteUsdtAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, userId, account) {
    if (detectAccountType(account) !== 'phone') {
        logger.warn(`[${TAG}] 账号 ${account} 是邮箱，删除USDT自动化跳过`);
        return false;
    }

    const walletItem = fetchRandomWallet(memberToken, adminToken, userId, 'USDT');
    if (!walletItem) {
        logger.error(`[${TAG}] 无USDT钱包数据，跳过删除USDT自动化工单`);
        return false;
    }

    const verifyCode = sendToGetVerCode(1, 15, account, adminToken);
    if (!verifyCode) {
        logger.error(`[${TAG}] 获取验证码失败，跳过删除USDT自动化工单`);
        return false;
    }

    const formFields = fields.map((field) => {
        if (field.typeCode === 'UsdtAddress') {
            return { typeCode: 'UsdtAddress', fieldId: field.id, fieldValue: `${walletItem.walletId}|${walletItem.accountNo}` };
        }
        if (field.typeCode === 'PhoneEmailCaptcha') {
            return { typeCode: 'PhoneEmailCaptcha', fieldId: field.id, fieldValue: verifyCode };
        }
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });

    const res = signAndPost({ formId, workOrderTypeId, formFields }, '/api/WorkOrder/Submit', true, memberToken, TAG);
    if (res && res.code === 0) {
        logger.info(`[${TAG}] ✅ 删除USDT自动化工单提交成功 formId=${formId}`);
        return true;
    }
    logger.error(`[${TAG}] ❌ 删除USDT自动化工单提交失败: ${JSON.stringify(res)}`);
    return false;
}

// ============================================================
// 删除USDT半自动（typeId=13）：无需验证码，走后台处理
// ============================================================
function triggerDeleteUsdtSemiOrder(formId, workOrderTypeId, fields, memberToken, adminToken, userId) {
    const walletItem = fetchRandomWallet(memberToken, adminToken, userId, 'USDT');
    if (!walletItem) {
        logger.error(`[${TAG}] 无USDT钱包数据，跳过删除USDT半自动工单`);
        return false;
    }

    const formFields = fields.map((field) => {
        if (field.typeCode === 'UsdtAddress') {
            return { typeCode: 'UsdtAddress', fieldId: field.id, fieldValue: `${walletItem.walletId}|${walletItem.accountNo}` };
        }
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });

    const res = signAndPost({ formId, workOrderTypeId, formFields }, '/api/WorkOrder/Submit', true, memberToken, TAG);
    if (res && res.code === 0) {
        logger.info(`[${TAG}] ✅ 删除USDT半自动工单提交成功 formId=${formId}`);
        return true;
    }
    logger.error(`[${TAG}] ❌ 删除USDT半自动工单提交失败: ${JSON.stringify(res)}`);
    return false;
}

// ============================================================
// 修改真实姓名半自动（typeId=7）：RealName = "autoTest" + 随机6字母
// ============================================================
function triggerChangeRealNameOrder(formId, workOrderTypeId, fields, memberToken) {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    let suffix = '';
    for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
    const realName = `autoTest${suffix}`;

    const formFields = fields.map((field) => {
        if (field.typeCode === 'RealName') {
            return { typeCode: 'RealName', fieldId: field.id, fieldValue: realName };
        }
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });

    const res = signAndPost({ formId, workOrderTypeId, formFields }, '/api/WorkOrder/Submit', true, memberToken, TAG);
    if (res && res.code === 0) {
        logger.info(`[${TAG}] ✅ 修改真实姓名工单提交成功 formId=${formId}`);
        return true;
    }
    logger.error(`[${TAG}] ❌ 修改真实姓名工单提交失败: ${JSON.stringify(res)}`);
    return false;
}

// ============================================================
// 删除PIX自动化（typeId=15）：需验证码，仅手机号
// PixAccount = {walletId}|{accountNo}，PixType 固定 "Phone|Phone"
// ============================================================
function triggerDeletePixAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, userId, account) {
    if (detectAccountType(account) !== 'phone') {
        logger.warn(`[${TAG}] 账号 ${account} 是邮箱，删除PIX自动化跳过`);
        return false;
    }

    const walletItem = fetchRandomWallet(memberToken, adminToken, userId, 'PIX');
    if (!walletItem) {
        logger.error(`[${TAG}] 无PIX钱包数据，跳过删除PIX自动化工单`);
        return false;
    }

    const verifyCode = sendToGetVerCode(1, 15, account, adminToken);
    if (!verifyCode) {
        logger.error(`[${TAG}] 获取验证码失败，跳过删除PIX自动化工单`);
        return false;
    }

    const formFields = fields.map((field) => {
        if (field.typeCode === 'PixAccount') {
            return { typeCode: 'PixAccount', fieldId: field.id, fieldValue: `${walletItem.walletId}|${walletItem.accountNo}` };
        }
        if (field.typeCode === 'PixType') {
            return { typeCode: 'PixType', fieldId: field.id, fieldValue: 'Phone|Phone' };
        }
        if (field.typeCode === 'PhoneEmailCaptcha') {
            return { typeCode: 'PhoneEmailCaptcha', fieldId: field.id, fieldValue: verifyCode };
        }
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });

    const res = signAndPost({ formId, workOrderTypeId, formFields }, '/api/WorkOrder/Submit', true, memberToken, TAG);
    if (res && res.code === 0) {
        logger.info(`[${TAG}] ✅ 删除PIX自动化工单提交成功 formId=${formId}`);
        return true;
    }
    logger.error(`[${TAG}] ❌ 删除PIX自动化工单提交失败: ${JSON.stringify(res)}`);
    return false;
}

// ============================================================
// 修改提现密码自动化（typeId=21）：需验证码，仅手机号
// NewWithdrawPassword = 随机6位数字
// ============================================================
function triggerChangeWithdrawPwdAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, account) {
    if (detectAccountType(account) !== 'phone') {
        logger.warn(`[${TAG}] 账号 ${account} 是邮箱，修改提现密码自动化跳过`);
        return false;
    }

    const verifyCode = sendToGetVerCode(1, 15, account, adminToken);
    if (!verifyCode) {
        logger.error(`[${TAG}] 获取验证码失败，跳过修改提现密码自动化工单`);
        return false;
    }

    // 随机6位数字新密码
    let newPwd = '';
    for (let i = 0; i < 6; i++) newPwd += Math.floor(Math.random() * 10);

    const formFields = fields.map((field) => {
        if (field.typeCode === 'NewWithdrawPassword') {
            return { typeCode: 'NewWithdrawPassword', fieldId: field.id, fieldValue: newPwd };
        }
        if (field.typeCode === 'PhoneEmailCaptcha') {
            return { typeCode: 'PhoneEmailCaptcha', fieldId: field.id, fieldValue: verifyCode };
        }
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });

    const res = signAndPost({ formId, workOrderTypeId, formFields }, '/api/WorkOrder/Submit', true, memberToken, TAG);
    if (res && res.code === 0) {
        logger.info(`[${TAG}] ✅ 修改提现密码自动化工单提交成功 formId=${formId}`);
        return true;
    }
    logger.error(`[${TAG}] ❌ 修改提现密码自动化工单提交失败: ${JSON.stringify(res)}`);
    return false;
}

// ============================================================
// 修改提现密码半自动化（typeId=22）：无需验证码，走后台处理
// NewWithdrawPassword = 随机6位数字
// ============================================================
function triggerChangeWithdrawPwdSemiOrder(formId, workOrderTypeId, fields, memberToken) {
    let newPwd = '';
    for (let i = 0; i < 6; i++) newPwd += Math.floor(Math.random() * 10);

    const formFields = fields.map((field) => {
        if (field.typeCode === 'NewWithdrawPassword') {
            return { typeCode: 'NewWithdrawPassword', fieldId: field.id, fieldValue: newPwd };
        }
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });

    const res = signAndPost({ formId, workOrderTypeId, formFields }, '/api/WorkOrder/Submit', true, memberToken, TAG);
    if (res && res.code === 0) {
        logger.info(`[${TAG}] ✅ 修改提现密码半自动化工单提交成功 formId=${formId}`);
        return true;
    }
    logger.error(`[${TAG}] ❌ 修改提现密码半自动化工单提交失败: ${JSON.stringify(res)}`);
    return false;
}

// ============================================================
// 其他问题（typeId=3）：LongText = "{frontUserId}:otherissues{seq}"
// seq 在工单内部递增，3位补零
// ============================================================
function triggerOtherIssueOrder(formId, workOrderTypeId, fields, memberToken, frontUserId, seqCounter) {
    const seqStr = String(seqCounter).padStart(3, '0');
    const content = `${frontUserId}:otherissues${seqStr}`;

    const formFields = fields.map((field) => {
        if (field.typeCode === 'LongText') {
            return { typeCode: 'LongText', fieldId: field.id, fieldValue: content };
        }
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });

    const res = signAndPost({ formId, workOrderTypeId, formFields }, '/api/WorkOrder/Submit', true, memberToken, TAG);
    if (res && res.code === 0) {
        logger.info(`[${TAG}] ✅ 其他问题工单提交成功 formId=${formId} content=${content}`);
        return true;
    }
    logger.error(`[${TAG}] ❌ 其他问题工单提交失败: ${JSON.stringify(res)}`);
    return false;
}

// ============================================================
// 修改登录密码-已登录（typeId=8）：直接提交，NewPassword 固定 qqqq1234
// ============================================================
function triggerChangePasswordLoginOrder(formId, workOrderTypeId, fields, memberToken) {
    const formFields = fields.map((field) => {
        if (field.typeCode === 'NewPassword') {
            return { typeCode: 'NewPassword', fieldId: field.id, fieldValue: 'qqqq1234' };
        }
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });

    const res = signAndPost({ formId, workOrderTypeId, formFields }, '/api/WorkOrder/Submit', true, memberToken, TAG);

    if (res && res.code === 0) {
        logger.info(`[${TAG}] ✅ 修改登录密码（已登录）工单提交成功 formId=${formId}`);
        return true;
    }
    logger.error(`[${TAG}] ❌ 修改登录密码（已登录）工单提交失败: ${JSON.stringify(res)}`);
    return false;
}

// ============================================================
// 新增USDT半自动（typeId=17）：直接生成新 USDT 地址提交，无前置查询
// ============================================================
function triggerAddUsdtOrder(formId, workOrderTypeId, fields, memberToken) {
    const formFields = fields.map((field) => {
        if (field.typeCode === 'UsdtAddress') {
            return { typeCode: 'UsdtAddress', fieldId: field.id, fieldValue: generateTRONAddress() };
        }
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });

    const res = signAndPost({ formId, workOrderTypeId, formFields }, '/api/WorkOrder/Submit', true, memberToken, TAG);

    if (res && res.code === 0) {
        logger.info(`[${TAG}] ✅ 新增USDT半自动工单提交成功 formId=${formId}`);
        return true;
    }
    logger.error(`[${TAG}] ❌ 新增USDT半自动工单提交失败: ${JSON.stringify(res)}`);
    return false;
}

// ============================================================
// 修改银行信息（typeId=6）：触发工单提交
// 前置：获取用户绑定银行卡
// BankAccountNumber fieldValue = {walletId}|{accountNo}
// ============================================================
function triggerChangeBankInfoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, userId) {
    const walletItem = fetchRandomUserWallet(memberToken, adminToken, userId);
    if (!walletItem) {
        logger.error(`[${TAG}] 无法获取银行卡数据，跳过修改银行信息工单`);
        return false;
    }

    const formFields = fields.map((field) => {
        if (field.typeCode === 'BankAccountNumber') {
            return {
                typeCode: 'BankAccountNumber',
                fieldId:  field.id,
                fieldValue: `${walletItem.walletId}|${walletItem.accountNo}`,
            };
        }
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });

    const payload = { formId, workOrderTypeId, formFields };
    const res = signAndPost(payload, '/api/WorkOrder/Submit', true, memberToken, TAG);

    if (res && res.code === 0) {
        logger.info(`[${TAG}] ✅ 修改银行信息工单提交成功 formId=${formId}`);
        return true;
    }
    logger.error(`[${TAG}] ❌ 修改银行信息工单提交失败: ${JSON.stringify(res)}`);
    return false;
}

// ============================================================
// 删除银行卡自动化（typeId=18）：需验证码，提交后系统自动执行，无需后台处理
// 账号必须是手机号，邮箱账号直接跳过
// ============================================================
function triggerDeleteBankAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, userId, account) {
    // 只支持手机号
    if (detectAccountType(account) !== 'phone') {
        logger.warn(`[${TAG}] 账号 ${account} 是邮箱，删除银行卡自动化跳过`);
        return false;
    }

    // 前置：获取用户银行卡
    const walletItem = fetchRandomUserWallet(memberToken, adminToken, userId);
    if (!walletItem) {
        logger.error(`[${TAG}] 无银行卡数据，跳过删除银行卡自动化工单`);
        return false;
    }

    // 发验证码并获取验证码值（verifyCodeType=1 手机号，codeType=15）
    const verifyCode = sendToGetVerCode(1, 15, account, adminToken);
    if (!verifyCode) {
        logger.error(`[${TAG}] 获取验证码失败，跳过删除银行卡自动化工单`);
        return false;
    }

    const formFields = fields.map((field) => {
        if (field.typeCode === 'BankAccountNumber') {
            return { typeCode: 'BankAccountNumber', fieldId: field.id, fieldValue: `${walletItem.walletId}|${walletItem.accountNo}` };
        }
        if (field.typeCode === 'PhoneEmailCaptcha') {
            return { typeCode: 'PhoneEmailCaptcha', fieldId: field.id, fieldValue: verifyCode };
        }
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });

    const res = signAndPost({ formId, workOrderTypeId, formFields }, '/api/WorkOrder/Submit', true, memberToken, TAG);

    if (res && res.code === 0) {
        logger.info(`[${TAG}] ✅ 删除银行卡自动化工单提交成功 formId=${formId}`);
        return true;
    }
    logger.error(`[${TAG}] ❌ 删除银行卡自动化工单提交失败: ${JSON.stringify(res)}`);
    return false;
}

// ============================================================
// 删除银行卡半自动（typeId=14）：无需验证码，需后台处理
// ============================================================
function triggerDeleteBankSemiOrder(formId, workOrderTypeId, fields, memberToken, adminToken, userId) {
    const walletItem = fetchRandomUserWallet(memberToken, adminToken, userId);
    if (!walletItem) {
        logger.error(`[${TAG}] 无银行卡数据，跳过删除银行卡半自动工单`);
        return false;
    }

    const formFields = fields.map((field) => {
        if (field.typeCode === 'BankAccountNumber') {
            return { typeCode: 'BankAccountNumber', fieldId: field.id, fieldValue: `${walletItem.walletId}|${walletItem.accountNo}` };
        }
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });

    const res = signAndPost({ formId, workOrderTypeId, formFields }, '/api/WorkOrder/Submit', true, memberToken, TAG);

    if (res && res.code === 0) {
        logger.info(`[${TAG}] ✅ 删除银行卡半自动工单提交成功 formId=${formId}`);
        return true;
    }
    logger.error(`[${TAG}] ❌ 删除银行卡半自动工单提交失败: ${JSON.stringify(res)}`);
    return false;
}

// ============================================================
// 修改IFSC自动化（typeId=11）：触发工单提交
// 前置：获取用户绑定银行卡（BankAccountNumber={walletId}|{accountNo}）
// IFSC fieldValue = generateIFSC()
// ============================================================
function triggerChangeIfscOrder(formId, workOrderTypeId, fields, memberToken, adminToken, userId) {
    // 前置：获取用户绑定银行卡
    const walletItem = fetchRandomUserWallet(memberToken, adminToken, userId);
    if (!walletItem) {
        logger.error(`[${TAG}] 无法获取银行卡数据，跳过修改IFSC工单`);
        return false;
    }

    const formFields = fields.map((field) => {
        if (field.typeCode === 'BankAccountNumber') {
            return {
                typeCode: 'BankAccountNumber',
                fieldId:  field.id,
                fieldValue: `${walletItem.walletId}|${walletItem.accountNo}`,
            };
        }
        if (field.typeCode === 'IFSC') {
            return {
                typeCode: 'IFSC',
                fieldId:  field.id,
                fieldValue: generateIFSC(),
            };
        }
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });

    const payload = { formId, workOrderTypeId, formFields };
    const res = signAndPost(payload, '/api/WorkOrder/Submit', true, memberToken, TAG);

    if (res && res.code === 0) {
        logger.info(`[${TAG}] ✅ 修改IFSC工单提交成功 formId=${formId}`);
        return true;
    }
    logger.error(`[${TAG}] ❌ 修改IFSC工单提交失败: ${JSON.stringify(res)}`);
    return false;
}

// ============================================================
// 一对一客服-已登陆：触发工单提交
// LongText fieldValue = "{userId}：{seqStr}"
// FileUpload 30% 概率上传图片
// ============================================================
function triggerCsLoginOrder(formId, workOrderTypeId, fields, userId, memberToken, env, seqCounter) {
    const seqStr = formatSeq(seqCounter);
    const formFields = [];

    for (const field of fields) {
        if (field.typeCode === 'LongText') {
            formFields.push({
                typeCode: 'LongText',
                fieldId: field.id,
                fieldValue: `${userId}：${seqStr}`,
            });
        } else if (field.typeCode === 'FileUpload') {
            // 30% 概率上传图片
            if (Math.random() < 0.3) {
                logger.info(`[${TAG}] 尝试上传图片，BASE_DESK_URL=${env ? env.BASE_DESK_URL : 'undefined'}`);
                const uploadResult = uploadFrontendWithToken(env, memberToken);
                if (uploadResult.success) {
                    formFields.push({
                        typeCode: 'FileUpload',
                        fieldId: field.id,
                        fieldValue: `${uploadResult.attachmentPath}?${uploadResult.attachmentName}`,
                    });
                    logger.info(`[${TAG}] 已上传图片: ${uploadResult.attachmentName}`);
                } else {
                    logger.warn(`[${TAG}] 图片上传失败，跳过 FileUpload 字段`);
                }
            }
            // 不上传时该字段不加入 formFields
        }
    }

    const payload = { formId, workOrderTypeId, formFields };

    const res = signAndPost(payload, '/api/WorkOrder/Submit', true, memberToken, TAG);

    if (res && res.code === 0) {
        logger.info(`[${TAG}] ✅ 一对一客服（已登陆）工单提交成功 formId=${formId}`);
        return true;
    }
    logger.error(`[${TAG}] ❌ 一对一客服（已登陆）工单提交失败: ${JSON.stringify(res)}`);
    return false;
}

// ============================================================
// 获取已登录状态的工单列表（formId + workOrderTypeId 映射）
// ============================================================
function fetchLoginFormList(memberToken) {
    const res = sendRequest(
        {},
        '/api/WorkOrder/GetFormList',
        TAG,
        true,   // isDesk（前台接口）
        memberToken
    );

    if (!res || !Array.isArray(res)) {
        logger.error(`[${TAG}] GetFormList 失败或返回格式异常`);
        return [];
    }

    logger.info(`[${TAG}] GetFormList 返回 ${res.length} 个工单类型`);
    return res; // [{ id(formId), workOrderTypeId, workOrderTypeName, ... }]
}

// ============================================================
// 公开：已登录单账号触发所有白名单工单
// ============================================================

/**
 * @param {string} adminToken   - 后台管理员 token（用于发验证码）
 * @param {string} tenantId     - 租户 ID
 * @param {string} account      - 会员账号（手机号/邮箱）
 * @param {number} userId       - 会员 userId（short）
 * @param {object} env          - 当前环境配置
 */
export function triggerLoginForAccount(adminToken, tenantId, account, userId, env) {
    logger.info(`[${TAG}] ===== 开始已登录工单触发 账号=${account} (userId=${userId}) =====`);
    logger.info(`[${TAG}] 白名单 workOrderTypeId: [${ENABLED_LOGIN_TYPE_IDS.join(', ')}]`);

    const memberAccount = account;

    // Step 1: 前台验证码登录
    const memberToken = autoLoginByAccount(memberAccount, adminToken);
    if (!memberToken) {
        logger.error(`[${TAG}] 会员 ${memberAccount} 登录失败，跳过已登录触发`);
        return;
    }
    logger.info(`[${TAG}] ✅ 会员登录成功`);

    // Step 2: 获取前台 userId
    const userInfo = getFrontUserInfo(memberToken);
    if (!userInfo || !userInfo.userId) {
        logger.error(`[${TAG}] 获取前台 userId 失败，跳过已登录触发`);
        return;
    }
    const frontUserId = userInfo.userId;
    logger.info(`[${TAG}] 前台 userId: ${frontUserId}`);

    // Step 4: 获取已登录工单列表
    const formList = fetchLoginFormList(memberToken);
    if (formList.length === 0) {
        logger.warn(`[${TAG}] 已登录工单列表为空，跳过`);
        return;
    }

    // Step 5: 按白名单过滤，逐个触发
    let successCount = 0;
    let skipCount    = 0;
    let failCount    = 0;

    // 序号计数器（一对一客服跨轮共享）
    let seqCounter = 1;
    // 其他问题工单内部序号
    let otherIssueSeq = 1;

    for (const form of formList) {
        const { id: formId, workOrderTypeId } = form;

        if (!ENABLED_LOGIN_TYPE_IDS.includes(workOrderTypeId)) {
            logger.info(`[${TAG}] ⏭️ 跳过未提供步骤的工单 typeId=${workOrderTypeId} (${form.workOrderTypeName})`);
            skipCount++;
            continue;
        }

        logger.info(`[${TAG}] → 触发: ${form.workOrderTypeName} (formId=${formId}, typeId=${workOrderTypeId})`);

        // 获取字段列表
        const fields = fetchFormFieldList(formId, memberToken);
        if (fields.length === 0) {
            logger.warn(`[${TAG}] 字段列表为空，跳过 formId=${formId}`);
            skipCount++;
            sleep(0.5);
            continue;
        }
        sleep(0.3);

        // 按工单类型分发触发逻辑
        let ok = false;
        if (workOrderTypeId === 2) {
            // 一对一客服-已登陆
            ok = triggerCsLoginOrder(formId, workOrderTypeId, fields, frontUserId, memberToken, env, seqCounter);
            seqCounter++;
        } else if (workOrderTypeId === 12) {
            // 修改银行名称自动化
            ok = triggerChangeBankNameOrder(formId, workOrderTypeId, fields, memberToken, adminToken, frontUserId);
        } else if (workOrderTypeId === 11) {
            // 修改IFSC自动化
            ok = triggerChangeIfscOrder(formId, workOrderTypeId, fields, memberToken, adminToken, frontUserId);
        } else if (workOrderTypeId === 6) {
            // 修改银行信息
            ok = triggerChangeBankInfoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, frontUserId);
        } else if (workOrderTypeId === 18) {
            // 删除银行卡自动化（邮箱账号跳过）
            ok = triggerDeleteBankAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, frontUserId, account);
        } else if (workOrderTypeId === 14) {
            // 删除银行卡半自动
            ok = triggerDeleteBankSemiOrder(formId, workOrderTypeId, fields, memberToken, adminToken, frontUserId);
        } else if (workOrderTypeId === 8) {
            // 修改登录密码-已登录
            ok = triggerChangePasswordLoginOrder(formId, workOrderTypeId, fields, memberToken);
        } else if (workOrderTypeId === 17) {
            // 新增USDT半自动
            ok = triggerAddUsdtOrder(formId, workOrderTypeId, fields, memberToken);
        } else if (workOrderTypeId === 19) {
            // 删除USDT自动化（邮箱账号跳过）
            ok = triggerDeleteUsdtAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, frontUserId, account);
        } else if (workOrderTypeId === 13) {
            // 删除USDT半自动
            ok = triggerDeleteUsdtSemiOrder(formId, workOrderTypeId, fields, memberToken, adminToken, frontUserId);
        } else if (workOrderTypeId === 7) {
            // 修改真实姓名半自动
            ok = triggerChangeRealNameOrder(formId, workOrderTypeId, fields, memberToken);
        } else if (workOrderTypeId === 15) {
            // 删除PIX自动化（邮箱账号跳过）
            ok = triggerDeletePixAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, frontUserId, account);
        } else if (workOrderTypeId === 21) {
            // 修改提现密码自动化（邮箱账号跳过）
            ok = triggerChangeWithdrawPwdAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, account);
        } else if (workOrderTypeId === 22) {
            // 修改提现密码半自动化
            ok = triggerChangeWithdrawPwdSemiOrder(formId, workOrderTypeId, fields, memberToken);
        } else if (workOrderTypeId === 3) {
            // 其他问题
            ok = triggerOtherIssueOrder(formId, workOrderTypeId, fields, memberToken, frontUserId, otherIssueSeq);
            otherIssueSeq++;
        }
        // 后续新增工单类型在此加 else if 分支

        if (ok) {
            successCount++;
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
