/**
 * safetest/lib/submit.js
 * 提交工单 /api/WorkOrder/Submit（端到端确认用）
 *
 * 签名算法已用真实抓包样本离线验证：只对标量字段 {formId, workOrderTypeId, language, random}
 * 计算 MD5，剔除 formFields 数组（与 guestRegister 剔除 eventIdentity 同理）。
 *
 * 字段 ID 默认取样本值（3004 一对一客服工单），可用 env 覆盖：
 *   -e FORM_ID=200280 -e WO_TYPE_ID=2 -e TEXT_FIELD_ID=200426 -e FILE_FIELD_ID=200611
 */
import http from 'k6/http';
import { SignatureUtil } from '../../libs/utils/signature.js';
import { hostOf } from './env.js';

const DEFAULTS = { formId: 200280, workOrderTypeId: 2, textFieldId: 200426, fileFieldId: 200611 };

/**
 * @param env
 * @param token 游客/会员 token
 * @param opt { fileValue, text }  fileValue = "<相对imagePath>?<展示文件名>"
 */
export function submitWorkOrder(env, token, opt) {
    const f = {
        formId: Number(__ENV.FORM_ID || DEFAULTS.formId),
        workOrderTypeId: Number(__ENV.WO_TYPE_ID || DEFAULTS.workOrderTypeId),
        textFieldId: Number(__ENV.TEXT_FIELD_ID || DEFAULTS.textFieldId),
        fileFieldId: Number(__ENV.FILE_FIELD_ID || DEFAULTS.fileFieldId),
    };
    const language = 'en';
    const random = Math.floor(Math.random() * 1e12);
    const timestamp = Math.floor(Date.now() / 1000);
    // 只签标量字段（剔除 formFields）
    const signature = SignatureUtil.calculateSignature(
        { formId: f.formId, workOrderTypeId: f.workOrderTypeId, language, random }, ''
    );
    const payload = {
        formId: f.formId,
        workOrderTypeId: f.workOrderTypeId,
        formFields: [
            { typeCode: 'LongText', fieldId: f.textFieldId, fieldValue: opt.text },
            { typeCode: 'FileUpload', fieldId: f.fileFieldId, fieldValue: opt.fileValue },
        ],
        language, random, signature, timestamp,
    };
    const baseUrl = env.BASE_DESK_URL;
    const headers = {
        'Host': hostOf(baseUrl),
        'content-type': 'application/json',
        'referer': `${baseUrl}/`,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
        'accept': 'application/json, text/plain, */*',
        'origin': `${baseUrl}/`,
        'domainurl': `${baseUrl}/`,
        'authorization': `Bearer ${token}`,
    };
    const res = http.post(`${baseUrl}/api/WorkOrder/Submit`, JSON.stringify(payload), { headers, timeout: '60s' });
    let parsed = null;
    try { parsed = JSON.parse(res.body); } catch (e) {}
    return {
        httpStatus: res.status,
        code: parsed ? parsed.code : null,
        msgCode: parsed ? parsed.msgCode : null,
        msg: parsed ? (parsed.msg || parsed.message || '') : '',
        ok: res.status === 200 && parsed && (parsed.code === 0 || parsed.msgCode === 0),
        rawBody: res.body ? String(res.body).slice(0, 400) : '',
        sentFieldValue: opt.fileValue,
    };
}
