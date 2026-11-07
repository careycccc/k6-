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
import { uploadWorkOrderFile, UPLOAD_PROBABILITY } from './upload.js';
import { autoLoginByAccount, detectAccountType } from '../../../user/userAccountApi.js';
import { getFrontUserInfo } from '../../../user/userManagement.js';
import { addFrontBankCard, generateIFSC, generateTRONAddress } from '../../../withdraw/addWalletApi.js';
import { sendToGetVerCode } from '../../../login/SendVerifiyCode.test.js';
import { logger } from '../../../../../libs/utils/logger.js';
import { PERF_METRICS, ERROR_COUNTERS } from '../../../../../libs/monitor/perfMetrics.js';

const TAG = 'TriggerLogin';

// msgCode 9 "Do not resubmit"：后端对同一会员短时间内连续提交的防重（同类型的多个表单
// 在 GetFormList 里是挨着的，间隔 ~1.3s 连发就会撞上）。只有 opts.retryResubmit 的调用方才等待重试
const RESUBMIT_RETRY_WAITS = [3, 5, 8];

// ============================================================
// 提交工单并处理 14013（同类型进行中）
// 返回 true=成功, null=跳过(14013), false=失败
// ============================================================
function submitOrder(payload, memberToken, tag, opts = {}) {
    const post = () => signAndPost(payload, '/api/WorkOrder/Submit', true, memberToken, tag || TAG, {
        trendObj: PERF_METRICS.WORK_ORDER_CREATE,
        errorCounter: ERROR_COUNTERS.WORK_ORDER_SUBMIT_FAIL,
    });
    let res = post();
    for (let i = 0; opts.retryResubmit && res && res.msgCode === 9 && i < RESUBMIT_RETRY_WAITS.length; i++) {
        logger.warn(`[${tag || TAG}] 防重拦截(msgCode 9 ${res.msg})，${RESUBMIT_RETRY_WAITS[i]}s 后重试 formId=${payload.formId} (${i + 1}/${RESUBMIT_RETRY_WAITS.length})`);
        sleep(RESUBMIT_RETRY_WAITS[i]);
        res = post();
    }
    if (res && res.code === 0) return true;
    if (res && res.msgCode === 14013) {
        logger.warn(`[${tag || TAG}] ⏭️ 同类型工单进行中，跳过 formId=${payload.formId}`);
        ERROR_COUNTERS.INVENTORY_FAIL.add(1);
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
    4,   // 存款未到账自动化（需会员有 Wait 法币充值单）
    23,  // USDT存款未到账自动化（需会员有 Wait USDT充值单）
    5,   // 取款未到账（需会员有 Wait 法币提现单）
    24,  // USDT取款未到账（需会员有 Wait USDT提现单 + 已绑 USDT 钱包）
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
// 获取码表枚举（随机一条）：BankCard=银行列表，PIX=PIX 类型
// ============================================================
function fetchRandomWalletCode(memberToken, withdrawType) {
    const res = sendRequest({ withdrawType }, '/api/Withdraw/GetWalletCodeList', TAG, true, memberToken);
    if (!res || !Array.isArray(res) || res.length === 0) {
        logger.error(`[${TAG}] GetWalletCodeList(${withdrawType}) 返回为空`);
        return null;
    }
    const item = res[Math.floor(Math.random() * res.length)];
    logger.info(`[${TAG}] 随机 ${withdrawType} 码表: ${item.code} | ${item.name}`);
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
        const bindOk = addFrontBankCard(memberToken);
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
// 通用字段构造器（按 GetFormFieldList 的字段定义逐个生成值）
//
// 表单字段是后台随时可配的（同一 typeId 的表单字段各不相同，也会被人加字段），
// 所以不能只认"该类型应有的字段"、其它一律填 ''。取值规则照搬前台 selfService 页
// （2026-11-06 读 3004 前台包 index-*.js 确认）：
//   - 提交前过滤掉空值字段，从不发 fieldValue=''（发了后端回 310 "Request parameters cannot be empty"）
//   - 必填字段缺失 → 后端回 6 "Param is Invalid"
//   - 文件类 ImageUpload/FileUpload/VideoUpload/PdfUpload：先 UploadToOss，值 = `${imagePath}?${fileName}`
//   - 钱包下拉 UsdtAddress/BankAccountNumber/PixAccount/EWallet/UpiWallet：值 = `${walletId}|${accountNo}`
//     （typeId=17 新增USDT 例外：UsdtAddress 是输入框，填新地址）
//   - 码表下拉 BankName/PixType：值 = `${code}|${name}`（GetWalletCodeList）
//   - PhoneEmailCaptcha：短信验证码，前台发 SendVerifiyCode{verifyCodeType:1, codeType:15}
//   - Captcha：图形验证码（GetCaptcha 返回图片 + 顶层 captchaId），脚本不做识别 → 必填时整单跳过
//   - TextContent 前台限制 1~40 字符；OrderAmount/WithdrawAmount 前台只读（只在未到账类型自动带出），
//     但后端对必填的照样要求有值
// ============================================================
const FILE_FIELD_TYPES = ['ImageUpload', 'FileUpload', 'VideoUpload', 'PdfUpload'];
const WALLET_FIELD_TYPES = { UsdtAddress: 'USDT', BankAccountNumber: 'BankCard', PixAccount: 'PIX', EWallet: 'EWallet', UpiWallet: 'UPI' };
const CODE_FIELD_TYPES = { BankName: 'BankCard', PixType: 'PIX' };

function randomDigits(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
    return s;
}

function randomLower(n) {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    let s = '';
    for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}

// 生成不了值时返回 { unsupported }（脚本按设计不支持，记"跳过"）或 { failed }（运行时出错，记"失败"）
function fetchWorkOrderSmsCode(ctx) {
    if (detectAccountType(ctx.account) !== 'phone') return { unsupported: '邮箱账号收不到短信验证码（前台只往手机发）' };
    const code = sendToGetVerCode(1, 15, ctx.account, ctx.adminToken, null, null, ctx.forceTenant);
    return code || { failed: '发送/查询短信验证码失败' };
}

/**
 * 按字段类型生成一个"真实用户会填的"值
 * @returns {string|null|{unsupported:string}|{failed:string}}  null=选填字段不填
 */
function genericFieldValue(field, ctx, required) {
    const t = field.typeCode;
    if (FILE_FIELD_TYPES.includes(t)) {
        if (!required && Math.random() >= UPLOAD_PROBABILITY) return null; // 选填附件按概率带
        const up = uploadWorkOrderFile(ctx.env, ctx.memberToken, t);
        return up.success ? up.fieldValue : { failed: `${t} 上传失败: ${up.error}` };
    }
    if (WALLET_FIELD_TYPES[t]) {
        const w = fetchRandomWallet(ctx.memberToken, ctx.adminToken, ctx.userId, WALLET_FIELD_TYPES[t]);
        return w ? `${w.walletId}|${w.accountNo}` : { failed: `会员没有 ${WALLET_FIELD_TYPES[t]} 钱包` };
    }
    if (CODE_FIELD_TYPES[t]) {
        const c = fetchRandomWalletCode(ctx.memberToken, CODE_FIELD_TYPES[t]);
        return c ? `${c.code}|${c.name}` : { failed: `GetWalletCodeList(${CODE_FIELD_TYPES[t]}) 为空` };
    }
    switch (t) {
        case 'LongText':          return ctx.text;
        case 'TextContent':       return ctx.text.slice(0, 40);
        case 'PhoneEmailCaptcha': return fetchWorkOrderSmsCode(ctx);
        case 'Captcha':           return { unsupported: '图形验证码（GetCaptcha 图片），脚本不做识别' };
        case 'IFSC':              return generateIFSC();
        case 'UTR':               return required ? randomUTR() : null;
        case 'OrderAmount':
        case 'WithdrawAmount':    return required ? '100' : null;
        case 'DepositOrderNo':
        case 'WithdrawOrderNo':   return { unsupported: '订单号只在存/取款未到账类型里引用会员自己的订单' };
        case 'RealName':          return `autoTest${randomLower(6)}`;
        case 'NewPassword':       return 'qqqq1234';
        case 'NewWithdrawPassword': return randomDigits(6);
        case 'UserName':
        case 'Account':           return ctx.account;
        case 'UserId':            return String(ctx.userId);
        default:
            if (required) logger.warn(`[${TAG}] 未知必填字段类型 ${t}(${field.fieldName})，按文本填`);
            return required ? ctx.text.slice(0, 30) : null;
    }
}

/**
 * @param {Array}  fields     GetFormFieldList 返回的 formFields
 * @param {object} ctx        { memberToken, adminToken, account, userId, env, text }
 * @param {object} overrides  { [typeCode]: 值 | (field) => 值 } 触发函数的特殊取值，优先于通用规则
 * @returns {{formFields:Array}|{skipReason:string}|{failReason:string}}
 */
function buildFormFields(fields, ctx, overrides = {}) {
    const formFields = [];
    const sorted = fields.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
    for (const field of sorted) {
        const required = field.isRequired === 1;
        const label = `${field.typeCode}(${field.fieldName})`;
        const o = overrides[field.typeCode];
        const v = o === undefined ? genericFieldValue(field, ctx, required) : (typeof o === 'function' ? o(field) : o);
        if (v && typeof v === 'object') {
            const reason = v.unsupported || v.failed;
            if (required) return v.unsupported ? { skipReason: `必填 ${label}：${reason}` } : { failReason: `必填 ${label}：${reason}` };
            logger.warn(`[${TAG}] 选填 ${label} 不填：${reason}`);
            continue;
        }
        if (v === null || v === undefined || v === '') {
            if (required) return { failReason: `必填 ${label} 没生成出值` };
            continue;
        }
        formFields.push({ typeCode: field.typeCode, fieldId: field.id, fieldValue: String(v) });
    }
    return { formFields };
}

// 构造 + 提交；返回 true=成功, null=跳过, false=失败
function submitBuiltOrder(formId, workOrderTypeId, fields, ctx, overrides, label) {
    const built = buildFormFields(fields, ctx, overrides);
    if (built.skipReason) {
        logger.warn(`[${TAG}] ⏭️ ${label} formId=${formId} 跳过 —— ${built.skipReason}`);
        return null;
    }
    if (built.failReason) {
        logger.error(`[${TAG}] ❌ ${label} formId=${formId} 字段构造失败 —— ${built.failReason}`);
        return false;
    }
    if (built.formFields.length === 0) {
        logger.warn(`[${TAG}] ⏭️ ${label} formId=${formId} 没有可填的字段，跳过`);
        return null;
    }
    logger.info(`[${TAG}] ${label} formId=${formId} 提交字段: ${built.formFields.map((f) => f.typeCode).join(',')}`);
    return submitOrder({ formId, workOrderTypeId, formFields: built.formFields }, ctx.memberToken, TAG, { retryResubmit: true });
}

// ============================================================
// 未到账类工单的数据源：会员自己近 30 天、状态为 Wait 的充值/提现单
// （PageSize 后端限制 ≤30，翻页收集，最多 5 页）
// ============================================================
function fetchWaitOrders(api, basePayload, stateKey, memberToken) {
    const now = Date.now();
    const waits = [];
    for (let pageNo = 1; pageNo <= 5; pageNo++) {
        const payload = Object.assign({}, basePayload, {
            startTime: now - 30 * 86400000, endTime: now + 86400000, pageSize: 30, pageNo,
        });
        const res = sendRequest(payload, api, TAG, true, memberToken);
        const list = res && Array.isArray(res.list) ? res.list : [];
        for (const r of list) if (r[stateKey] === 'Wait') waits.push(r);
        if (pageNo >= ((res && res.totalPage) || 1) || list.length === 0) break;
        sleep(0.3);
    }
    return waits;
}

function fetchWaitDeposits(memberToken) {
    return fetchWaitOrders('/api/Recharge/GetRechargeRecord',
        { rechargeState: null, rechargeCategoryId: null }, 'rechargeState', memberToken);
}

function fetchWaitWithdraws(memberToken) {
    return fetchWaitOrders('/api/Withdraw/GetWithdrawHistory',
        { withdrawType: '', withdrawState: '' }, 'withdrawState', memberToken);
}

function randomUTR() {
    let s = '';
    for (let i = 0; i < 12; i++) s += Math.floor(Math.random() * 10);
    return s;
}

// ============================================================
// 触发函数
// ============================================================

// 以下 2/12/11/6/17/3 走通用字段构造器 buildFormFields，按表单当前字段定义填值。
// 2026-11-06 3004 实测各表单字段（GetFormFieldList）：
//   2  一对一客服 200074/200078/200127: LongText | 200152: LongText+ImageUpload
//      200280: FileUpload+ImageUpload+VideoUpload+WithdrawAmount（无 LongText，旧逻辑发出空 formFields）
//      300145: LongText+OrderAmount | 300146: PhoneEmailCaptcha（字段名叫 Long Text）
//   12 修改银行名称 200405: BankName+BankAccountNumber+PhoneEmailCaptcha
//   11 修改IFSC 200010: BankAccountNumber+IFSC+PhoneEmailCaptcha
//   6  修改银行信息 200013: BankName+ImageUpload+TextContent(选填)
//   17 新增USDT 200018: Captcha(图形验证码)+UsdtAddress
//   3  其他问题 200409: TextContent(选填)+FileUpload | 200422: TextContent

// typeId=2：一对一客服-已登陆
function triggerCsLoginOrder(formId, workOrderTypeId, fields, ctx, seqCounter) {
    const text = `${ctx.userId}：${formatSeq(seqCounter)}`;
    return submitBuiltOrder(formId, workOrderTypeId, fields, Object.assign({}, ctx, { text }), {}, '一对一客服');
}

// typeId=12：修改银行名称自动化（BankName 取银行码表，BankAccountNumber 取会员已绑银行卡）
function triggerChangeBankNameOrder(formId, workOrderTypeId, fields, ctx) {
    return submitBuiltOrder(formId, workOrderTypeId, fields, ctx, {}, '修改银行名称自动化');
}

// typeId=11：修改IFSC自动化
function triggerChangeIfscOrder(formId, workOrderTypeId, fields, ctx) {
    return submitBuiltOrder(formId, workOrderTypeId, fields, ctx, {}, '修改IFSC自动化');
}

// typeId=6：修改银行信息
function triggerChangeBankInfoOrder(formId, workOrderTypeId, fields, ctx) {
    return submitBuiltOrder(formId, workOrderTypeId, fields, ctx, {}, '修改银行信息');
}

// typeId=18：删除银行卡自动化（仅手机号）
function triggerDeleteBankAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, userId, account, forceTenant = false) {
    if (detectAccountType(account) !== 'phone') { logger.warn(`[${TAG}] 邮箱账号跳过删除银行卡自动化`); return false; }
    const walletItem = fetchRandomUserWallet(memberToken, adminToken, userId);
    if (!walletItem) { logger.error(`[${TAG}] 无银行卡数据，跳过`); return false; }
    const verifyCode = sendToGetVerCode(1, 15, account, adminToken, null, null, forceTenant);
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

// typeId=17：新增USDT半自动（前台这里 UsdtAddress 是输入框，填一个新 TRON 地址，不是选已绑钱包）
// 注意：表单里配了必填的图形验证码 Captcha 时，脚本不做识别，整单记"跳过"
function triggerAddUsdtOrder(formId, workOrderTypeId, fields, ctx) {
    return submitBuiltOrder(formId, workOrderTypeId, fields, ctx, { UsdtAddress: () => generateTRONAddress() }, '新增USDT半自动');
}

// typeId=19：删除USDT自动化（仅手机号）
function triggerDeleteUsdtAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, userId, account, forceTenant = false) {
    if (detectAccountType(account) !== 'phone') { logger.warn(`[${TAG}] 邮箱账号跳过删除USDT自动化`); return false; }
    const walletItem = fetchRandomWallet(memberToken, adminToken, userId, 'USDT');
    if (!walletItem) { logger.error(`[${TAG}] 无USDT钱包数据，跳过`); return false; }
    const verifyCode = sendToGetVerCode(1, 15, account, adminToken, null, null, forceTenant);
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
function triggerDeletePixAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, userId, account, forceTenant = false) {
    if (detectAccountType(account) !== 'phone') { logger.warn(`[${TAG}] 邮箱账号跳过删除PIX自动化`); return false; }
    const walletItem = fetchRandomWallet(memberToken, adminToken, userId, 'PIX');
    if (!walletItem) { logger.error(`[${TAG}] 无PIX钱包数据，跳过`); return false; }
    const verifyCode = sendToGetVerCode(1, 15, account, adminToken, null, null, forceTenant);
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
function triggerChangeWithdrawPwdAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, account, forceTenant = false) {
    if (detectAccountType(account) !== 'phone') { logger.warn(`[${TAG}] 邮箱账号跳过修改提现密码自动化`); return false; }
    const verifyCode = sendToGetVerCode(1, 15, account, adminToken, null, null, forceTenant);
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

// typeId=3：其他问题（文本 ≤40 字符，TextContent 前台限制 1~40）
function triggerOtherIssueOrder(formId, workOrderTypeId, fields, ctx, seqCounter) {
    const text = `${ctx.userId}:otherissues${String(seqCounter).padStart(3, '0')}`;
    return submitBuiltOrder(formId, workOrderTypeId, fields, Object.assign({}, ctx, { text }), {}, '其他问题');
}

// typeId=4：存款未到账自动化（法币） / typeId=23：USDT存款未到账自动化
// 必须引用会员自己的一笔 Wait 充值单；没有就跳过（返回 null 计入"跳过"，不算失败）
function triggerDepositNotReceivedOrder(formId, workOrderTypeId, fields, memberToken, waitDeposits) {
    const isUsdt = workOrderTypeId === 23;
    const candidates = waitDeposits.filter((r) => (r.rechargeType === 'USDT') === isUsdt);
    const record = candidates.find((r) => r.rechargeType === 'BankCard') || candidates[0];
    if (!record) {
        logger.warn(`[${TAG}] ⏭️ 无 Wait 状态的${isUsdt ? 'USDT' : '法币'}充值单，跳过 typeId=${workOrderTypeId}`);
        return null;
    }
    const formFields = fields.map((field) => {
        if (field.typeCode === 'DepositOrderNo') return { typeCode: 'DepositOrderNo', fieldId: field.id, fieldValue: record.orderNo };
        if (field.typeCode === 'OrderAmount') return { typeCode: 'OrderAmount', fieldId: field.id, fieldValue: String(record.amount) };
        if (field.typeCode === 'UTR') return { typeCode: 'UTR', fieldId: field.id, fieldValue: randomUTR() };
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });
    logger.info(`[${TAG}] 存款未到账 引用充值单 ${record.orderNo} (${record.rechargeType}, ${record.amount})`);
    return submitOrder({
        formId, workOrderTypeId, formFields,
        payTypeId: record.rechargeChannelId, payName: record.rechargeChannelName,
    }, memberToken, TAG);
}

// typeId=5：取款未到账（法币） / typeId=24：USDT取款未到账
// 必须引用会员自己的一笔 Wait 提现单；提现历史里没有收款地址，USDT 地址取会员已绑的 USDT 钱包
function triggerWithdrawNotReceivedOrder(formId, workOrderTypeId, fields, memberToken, adminToken, userId, waitWithdraws) {
    const isUsdt = workOrderTypeId === 24;
    const record = waitWithdraws.find((r) => (r.withdrawType === 'USDT') === isUsdt);
    if (!record) {
        logger.warn(`[${TAG}] ⏭️ 无 Wait 状态的${isUsdt ? 'USDT' : '法币'}提现单，跳过 typeId=${workOrderTypeId}`);
        return null;
    }
    let usdtWallet = null;
    if (isUsdt) {
        usdtWallet = fetchRandomWallet(memberToken, adminToken, userId, 'USDT');
        if (!usdtWallet) { logger.error(`[${TAG}] 无USDT钱包数据，跳过`); return false; }
    }
    const formFields = fields.map((field) => {
        if (field.typeCode === 'WithdrawOrderNo') return { typeCode: 'WithdrawOrderNo', fieldId: field.id, fieldValue: record.orderNo };
        if (field.typeCode === 'WithdrawAmount' || field.typeCode === 'OrderAmount') return { typeCode: field.typeCode, fieldId: field.id, fieldValue: String(record.amount) };
        if (field.typeCode === 'UsdtAddress' && usdtWallet) return { typeCode: 'UsdtAddress', fieldId: field.id, fieldValue: `${usdtWallet.walletId}|${usdtWallet.accountNo}` };
        return { typeCode: field.typeCode, fieldId: field.id, fieldValue: '' };
    });
    logger.info(`[${TAG}] 取款未到账 引用提现单 ${record.orderNo} (${record.withdrawType}, ${record.amount})`);
    return submitOrder({ formId, workOrderTypeId, formFields }, memberToken, TAG);
}

// ============================================================
// 公开：已登录单账号触发所有白名单工单
// ============================================================
/**
 * @param {object} [opts]
 * @param {number[]} [opts.onlyFormIds] 只触发这些 formId（排查单个表单用）；不传时读 -e WO_FORM_IDS=200078,300145
 */
export function triggerLoginForAccount(adminToken, tenantId, account, userId, env, memberTokenMap = null, opts = {}) {
    logger.info(`[${TAG}] ===== 已登录工单触发 账号=${account} (userId=${userId}) =====`);
    const onlyFormIds = opts.onlyFormIds
        || (__ENV.WO_FORM_IDS ? __ENV.WO_FORM_IDS.split(',').map((s) => Number(s.trim())).filter(Boolean) : null);
    if (onlyFormIds) logger.info(`[${TAG}] 只触发 formId: [${onlyFormIds.join(', ')}]`);

    // Step 1: 获取前台 token —— 必须现登，不能复用映射表里 setup 阶段登录的旧 token。
    // 会员前台 token 约 55s 失效（已知限制，见 libs/http/groupRouting.js 外的项目记忆），
    // 而 setup 阶段的环境巡检 + 账号查询本身就常常超过 55s，等轮到这里 memberTokenMap
    // 里的 token 基本已经过期；2026-11-07 实测这里不改的话，下一步 getFrontUserInfo
    // 会 100% 拿到 401/空响应，整个已登录触发直接跳过。memberTokenMap 参数保留但不再
    // 在这用，是给调用方传历史兼容参数用的。
    logger.info(`[${TAG}] 现登: ${account}`);
    const memberToken = autoLoginByAccount(account, adminToken, opts.forceTenant);
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

    // 未到账类工单要引用会员自己的 Wait 订单：同一账号只在第一次用到时查一次
    const pendingCache = {};
    const waitDeposits  = () => pendingCache.deposits  || (pendingCache.deposits  = fetchWaitDeposits(memberToken));
    const waitWithdraws = () => pendingCache.withdraws || (pendingCache.withdraws = fetchWaitWithdraws(memberToken));

    // forceTenant：adminToken 是商户自己登录拿到的（非集团token）时传 true（opts.forceTenant），
    // 否则集团模式下查短信验证码等后台接口会被自动路由去集团域名，token/域名错配报 "Account
    // type does not match the admin site"（2026-11-07 实测踩坑，见 libs/http/groupRouting.js）
    const forceTenant = !!opts.forceTenant;

    // 通用字段构造器的上下文（text 是 LongText/TextContent 的默认内容，各触发函数可覆盖）
    const ctx = { memberToken, adminToken, account, userId: frontUserId, env, text: `autotest${frontUserId}`, forceTenant };

    for (const form of formList) {
        const { id: formId, workOrderTypeId } = form;

        if (!ENABLED_LOGIN_TYPE_IDS.includes(workOrderTypeId)) {
            logger.info(`[${TAG}] ⏭️ 跳过 typeId=${workOrderTypeId} (${form.workOrderTypeName})`);
            skipCount++;
            continue;
        }
        if (onlyFormIds && !onlyFormIds.includes(formId)) continue;

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
            ok = triggerCsLoginOrder(formId, workOrderTypeId, fields, ctx, seqCounter);
            seqCounter++;
        } else if (workOrderTypeId === 12) {
            ok = triggerChangeBankNameOrder(formId, workOrderTypeId, fields, ctx);
        } else if (workOrderTypeId === 11) {
            ok = triggerChangeIfscOrder(formId, workOrderTypeId, fields, ctx);
        } else if (workOrderTypeId === 6) {
            ok = triggerChangeBankInfoOrder(formId, workOrderTypeId, fields, ctx);
        } else if (workOrderTypeId === 18) {
            ok = triggerDeleteBankAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, frontUserId, account, forceTenant);
        } else if (workOrderTypeId === 14) {
            ok = triggerDeleteBankSemiOrder(formId, workOrderTypeId, fields, memberToken, adminToken, frontUserId);
        } else if (workOrderTypeId === 8) {
            ok = triggerChangePasswordLoginOrder(formId, workOrderTypeId, fields, memberToken);
        } else if (workOrderTypeId === 17) {
            ok = triggerAddUsdtOrder(formId, workOrderTypeId, fields, ctx);
        } else if (workOrderTypeId === 19) {
            ok = triggerDeleteUsdtAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, frontUserId, account, forceTenant);
        } else if (workOrderTypeId === 13) {
            ok = triggerDeleteUsdtSemiOrder(formId, workOrderTypeId, fields, memberToken, adminToken, frontUserId);
        } else if (workOrderTypeId === 7) {
            ok = triggerChangeRealNameOrder(formId, workOrderTypeId, fields, memberToken);
        } else if (workOrderTypeId === 15) {
            ok = triggerDeletePixAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, frontUserId, account, forceTenant);
        } else if (workOrderTypeId === 21) {
            ok = triggerChangeWithdrawPwdAutoOrder(formId, workOrderTypeId, fields, memberToken, adminToken, account, forceTenant);
        } else if (workOrderTypeId === 22) {
            ok = triggerChangeWithdrawPwdSemiOrder(formId, workOrderTypeId, fields, memberToken);
        } else if (workOrderTypeId === 3) {
            ok = triggerOtherIssueOrder(formId, workOrderTypeId, fields, ctx, otherIssueSeq);
            otherIssueSeq++;
        } else if (workOrderTypeId === 4 || workOrderTypeId === 23) {
            ok = triggerDepositNotReceivedOrder(formId, workOrderTypeId, fields, memberToken, waitDeposits());
        } else if (workOrderTypeId === 5 || workOrderTypeId === 24) {
            ok = triggerWithdrawNotReceivedOrder(formId, workOrderTypeId, fields, memberToken, adminToken, frontUserId, waitWithdraws());
        }
        // 后续新增工单类型在此加 else if 分支

        if (ok === true) {
            successCount++;
        } else if (ok === null) {
            skipCount++; // 14013 同类型进行中 / 无可引用订单 / 必填字段脚本不支持（如图形验证码）
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
