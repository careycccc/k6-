/**
 * 前台充值工单 - 重复提交验证
 *
 * 需求：会员登录 → 查充值历史(GetRechargeRecord) → 筛出 rechargeState=Wait 且 rechargeType=USDT/BankCard 的记录
 *       (只有一种就提一种；两种都有就各提一次) → 按类型构造工单(图片用 banner 随机上传)提交 →
 *       等待 WAIT 秒(默认180=3分钟) → 用【相同 payload】再提交一次 →
 *       测"工单未处理时再次提交会不会重复提交"：第2次被拒(14013 同类型进行中)=防重正常；第2次仍 code=0=疑似重复。
 *
 * 复用：signAndPost(工单签名提交,submitHelper) / autoLoginByAccount(会员登录) / getFrontUserInfo /
 *       sendRequest / 图片上传接口 /api/WorkOrder/UploadToOss(自写 banner 版)。
 *
 * 用法（在 workOrderSuite 目录运行）：
 *   node depositWorkOrderRepeatRunner.js --tenant 3004 --account 91xxxxxxxxxx
 *   k6 run -e TENANT_ID=3004 -e ACCOUNT=91xxxxxxxxxx depositWorkOrderRepeatVerify.js
 *
 * 可选 -e：WAIT(两次提交间隔秒,默认180) TENANT_ID(默认3004)
 */

import http from 'k6/http';
import { sleep } from 'k6';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { autoLoginByAccount } from '../../user/userAccountApi.js';
import { getFrontUserInfo } from '../../user/userManagement.js';
import { sendRequest } from '../../common/request.js';
import { signAndPost } from './lib/submitHelper.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const ACCOUNT = __ENV.ACCOUNT || '';
const WAIT = parseInt(__ENV.WAIT || '180', 10); // 两次提交间隔秒(默认3分钟)
const TAG = 'DepositWORepeat';

// banner 3 张图预加载，运行时随机
const BANNERS = [
    { content: open('../../uploadFile/img/banner/1.png', 'b'), name: '1.png' },
    { content: open('../../uploadFile/img/banner/2.png', 'b'), name: '2.png' },
    { content: open('../../uploadFile/img/banner/3.png', 'b'), name: '3.png' },
];

// 充值工单模板（3004 固定值，你给的 payload）
const WO_TEMPLATE = {
    USDT: { formId: 200414, workOrderTypeId: 23, fields: { DepositOrderNo: 200620, OrderAmount: 200621, ImageUpload: 200690 } },
    BankCard: { formId: 200129, workOrderTypeId: 4, fields: { DepositOrderNo: 200196, UTR: 200608, OrderAmount: 200197, ImageUpload: 200628 } },
};

export const options = { scenarios: { w: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '20m' } } };

function W(msg) { console.log(`##WO##${msg}`); }
function randomUTR() { let s = ''; for (let i = 0; i < 12; i++) s += Math.floor(Math.random() * 10); return s; }

/** banner 图上传到前台 /api/WorkOrder/UploadToOss，返回 { success, fieldValue } */
function uploadBanner(env, memberToken) {
    const img = BANNERS[Math.floor(Math.random() * BANNERS.length)];
    const baseUrl = env.BASE_DESK_URL;
    const host = baseUrl.replace(/^(https?:\/\/)?([^:/\s]+).*$/, '$2');
    const params = {
        timeout: '120s',
        headers: {
            'Host': host,
            'ignorecanceltoken': 'true',
            'referer': `${baseUrl}/`,
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'accept': 'application/json, text/plain, */*',
            'origin': `${baseUrl}/`,
            'accept-language': 'zh-CN,zh;q=0.9',
            'authorization': `Bearer ${memberToken}`,
            'domainurl': `${baseUrl}/`,
        },
    };
    try {
        const res = http.post(`${baseUrl}/api/WorkOrder/UploadToOss`,
            { files: http.file(img.content, img.name, 'image/png'), fileType: 'other', customPath: '' }, params);
        const body = JSON.parse(res.body);
        if (body.code === 0 && body.data && body.data.length > 0) {
            const item = body.data[0];
            const fullUrl = item.src || item.file || '';
            const attachmentPath = fullUrl.replace(/^https?:\/\/[^/]+\//, '');
            return { success: true, fieldValue: `${attachmentPath}?${item.title}`, img: img.name };
        }
        return { success: false, error: body.msg || res.body };
    } catch (e) { return { success: false, error: e.message }; }
}

/** 查充值历史，返回 rechargeState=Wait 的记录（PageSize 后端限制 ≤30，故翻页收集） */
function fetchWaitRecords(memberToken) {
    const now = Date.now();
    const waits = [];
    for (let pageNo = 1; pageNo <= 5; pageNo++) {
        const payload = {
            startTime: now - 30 * 86400000, endTime: now + 86400000,
            rechargeState: null, rechargeCategoryId: null, pageSize: 30, pageNo,
        };
        const res = sendRequest(payload, '/api/Recharge/GetRechargeRecord', TAG, true, memberToken);
        const list = (res && res.data && Array.isArray(res.data.list)) ? res.data.list : (res && Array.isArray(res.list) ? res.list : []);
        for (const r of list) if (r.rechargeState === 'Wait') waits.push(r);
        const totalPage = (res && res.data && res.data.totalPage) ? res.data.totalPage : 1;
        if (pageNo >= totalPage || list.length === 0) break;
        sleep(0.3);
    }
    return waits;
}

/** 按类型构造工单业务 payload（图片值传入） */
function buildPayload(type, record, imageFieldValue) {
    const tpl = WO_TEMPLATE[type];
    const ff = [];
    ff.push({ typeCode: 'DepositOrderNo', fieldId: tpl.fields.DepositOrderNo, fieldValue: record.orderNo });
    if (type === 'BankCard') ff.push({ typeCode: 'UTR', fieldId: tpl.fields.UTR, fieldValue: randomUTR() });
    ff.push({ typeCode: 'OrderAmount', fieldId: tpl.fields.OrderAmount, fieldValue: String(record.amount) });
    ff.push({ typeCode: 'ImageUpload', fieldId: tpl.fields.ImageUpload, fieldValue: imageFieldValue });
    return { formId: tpl.formId, workOrderTypeId: tpl.workOrderTypeId, formFields: ff, payTypeId: record.rechargeChannelId, payName: record.rechargeChannelName };
}

export function setup() {
    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);
    if (!ACCOUNT) throw new Error(`[${TAG}] 请用 -e ACCOUNT=账号 指定一个有 Wait 充值记录的会员`);
    const adminToken = AdminLogin();
    if (!adminToken) throw new Error(`[${TAG}] 后台登录失败`);
    return { adminToken, envConfig };
}

export default function (data) {
    const { adminToken, envConfig } = data;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);
    const env = envConfig;

    // 1) 账号登录
    const memberToken = autoLoginByAccount(ACCOUNT, adminToken);
    if (!memberToken) { W(`❌ 账号 ${ACCOUNT} 登录失败`); return; }
    const info = getFrontUserInfo(memberToken);
    W(`账号=${ACCOUNT} userId=${info ? info.userId : '?'} 登录成功`);

    // 2) 查充值历史，筛 Wait
    const waits = fetchWaitRecords(memberToken);
    W(`Wait 充值记录数=${waits.length}`);
    const usdt = waits.find(r => r.rechargeType === 'USDT');
    const bank = waits.find(r => r.rechargeType === 'BankCard');
    const targets = [];
    if (usdt) targets.push({ type: 'USDT', record: usdt });
    if (bank) targets.push({ type: 'BankCard', record: bank });
    if (targets.length === 0) { W(`⚠️ 没有 Wait 的 USDT/BankCard 充值记录，无法提工单（换个有 Wait 记录的账号）`); return; }
    W(`目标工单：${targets.map(t => `${t.type}(${t.record.orderNo})`).join(', ')}`);

    // 3) 每个 target：上传图片 + 构造 payload + 第一次提交
    const submits = [];
    for (const t of targets) {
        const up = uploadBanner(env, memberToken);
        if (!up.success) { W(`${t.type} ❌ banner 上传失败: ${up.error}，跳过`); continue; }
        const payload = buildPayload(t.type, t.record, up.fieldValue);
        const amtStr = payload.formFields.find(f => f.typeCode === 'OrderAmount').fieldValue;
        W(`${t.type} 图片(${up.img})=${up.fieldValue}`);
        W(`${t.type} 第1次提交 formId=${payload.formId} type=${payload.workOrderTypeId} orderNo=${t.record.orderNo} amount=${amtStr} payTypeId=${payload.payTypeId} payName=${payload.payName}`);
        const r1 = signAndPost(payload, '/api/WorkOrder/Submit', true, memberToken, TAG);
        W(`${t.type} 第1次结果 code=${r1 ? r1.code : '?'} msgCode=${r1 ? r1.msgCode : '?'} msg=${r1 ? r1.msg : '?'}`);
        submits.push({ t, payload, r1 });
        sleep(3); // 拉开两个工单之间的间隔，避免上传/提交撞「Do not resubmit」防重
    }
    if (submits.length === 0) { W('无成功的第一次提交，终止'); return; }

    // 4) 等待 WAIT 秒（默认3分钟）
    W(`⏳ 等待 ${WAIT}s(${(WAIT / 60).toFixed(1)}分钟) 后用相同 payload 第二次提交...`);
    sleep(WAIT);

    // 5) 第二次提交（相同业务 payload：orderNo/amount/图片/payTypeId 全同）
    for (const s of submits) {
        const r2 = signAndPost(s.payload, '/api/WorkOrder/Submit', true, memberToken, TAG);
        W(`${s.t.type} 第2次结果 code=${r2 ? r2.code : '?'} msgCode=${r2 ? r2.msgCode : '?'} msg=${r2 ? r2.msg : '?'}`);
        if (r2 && r2.msgCode === 14013) {
            W(`${s.t.type} ✅ 第2次被拒(14013 同类型进行中) → 防重正常，未产生重复工单`);
        } else if (r2 && r2.code === 0) {
            W(`${s.t.type} 🔴 第2次又提交成功 → 疑似【重复提交】：未处理工单可再次提交`);
        } else {
            W(`${s.t.type} ⚠️ 第2次返回异常 code=${r2 ? r2.code : '?'} msg=${r2 ? r2.msg : '?'}`);
        }
        sleep(1);
    }
    W('—— 完成 ——');
}
