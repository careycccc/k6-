/**
 * guestToMember.test.js
 * 游客账号转正式会员流程测试
 *
 * 流程：
 *   1. 游客注册（guestRegister）获取游客 token
 *   2. 用游客 token 发送绑定手机验证码，后台查询验证码
 *   3. 调用 /api/User/BindPhone 绑定随机手机号
 *   4. 调用 /api/User/GetUserInfo 验证 canSetPassword === true
 *   5. 打印转正的手机号，供人工核验
 *
 * 运行方式：
 *   k6 run -e TENANT=3101 guestToMember.test.js
 *
 * 参数说明：
 *   TENANT   租户 ID（默认 3004）
 */

import { sleep } from 'k6';
import { tenantAdminLogin, tenantRequest } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId } from '../../../config/envconfig.js';
import { guestRegister } from './register.test.js';
import { sendToGetVerCode } from './SendVerifiyCode.test.js';

// ============================================================
// 参数
// ============================================================

const TENANT_ID = __ENV.TENANT || __ENV.TENANT_ID || '3004';

// 3004 的游客注册参数（与 3007 不同）
const GUEST_CONFIG_3004 = {
    packageName: 'com.ar3004.fb.app',
    eventConfigId: 100064,
    eventType: 99
};

const GUEST_CONFIG_3101 = {
    packageName: 'com.ar3101.fb.app',
    eventConfigId: 100064,
    eventType: 99
};

const TAG = 'GuestToMember';

// ============================================================
// K6 Options
// ============================================================

export const options = {
    scenarios: {
        guest_to_member: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '5m'
        }
    }
};

// ============================================================
// 工具函数
// ============================================================

/**
 * 根据租户 ID 获取游客注册配置
 * 目前只特殊处理 3004，其他租户走默认（3007）参数
 */
function getGuestConfig(tenantId) {
    if (String(tenantId) === '3004') {
        return GUEST_CONFIG_3004;
    }
    if (String(tenantId) === '3101') {
        return GUEST_CONFIG_3101;
    }
    // 其他租户使用 guestRegister 自身的默认参数（3007）
    return {};
}

/**
 * 生成随机手机号
 * 3004 租户区号 91（印度），生成 91 + 10位数字
 */
function randomPhone(tenantId) {
    const envConfig = getEnvByTenantId(tenantId);
    const countryCode = envConfig.COUNTRY_CODE || '91';
    // 生成 10 位随机数字（首位不为 0）
    const first = Math.floor(Math.random() * 9) + 1;
    let rest = '';
    for (let i = 0; i < 9; i++) {
        rest += Math.floor(Math.random() * 10);
    }
    return countryCode + first + rest;
}

/**
 * 用游客 token 调用前台接口（需要 Authorization header）
 * tenantRequest 的 token 参数会自动加上 Bearer header
 */
function frontRequest(api, payload, guestToken) {
    return tenantRequest(api, payload, {
        token: guestToken,
        isDesk: true
    });
}

// ============================================================
// setup：后台登录（用于发验证码后查验证码）
// ============================================================

export function setup() {
    console.log(`[${TAG}] ========== Setup 开始 ==========`);
    console.log(`[${TAG}] 租户: ${TENANT_ID}`);

    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) {
        throw new Error(`[${TAG}] 后台登录失败，终止测试`);
    }
    console.log(`[${TAG}] ✅ 后台登录成功`);
    console.log(`[${TAG}] ========== Setup 完成 ==========`);

    return { adminToken };
}

// ============================================================
// default：游客注册 → 绑手机 → 验证转正
// ============================================================

export default function (data) {
    const { adminToken } = data;

    // ── 步骤 1：游客注册 ──────────────────────────────────────
    console.log(`\n[${TAG}] ===== 步骤1：游客注册 =====`);

    const guestConfig = getGuestConfig(TENANT_ID);
    const guestResult = guestRegister(guestConfig);

    if (!guestResult) {
        console.error(`[${TAG}] ❌ 游客注册失败，流程终止`);
        return;
    }

    // guestRegister 经 handleRegisterResponseWithToken 处理后：
    // data.token = 裸 token 字符串（来自响应 data.token 字段）
    // headers.Authorization = 'Bearer xxx'（同一个 token）
    // 直接取 data.token 最稳，避免 headers key 大小写问题
    let guestToken = null;
    if (guestResult.data && guestResult.data.token) {
        guestToken = guestResult.data.token;
    } else if (guestResult.headers) {
        // fallback：从 Authorization header 里剥掉 'Bearer '
        const authHeader = guestResult.headers['Authorization'] || guestResult.headers['authorization'] || '';
        guestToken = authHeader.replace(/^Bearer\s+/i, '').trim() || null;
    }

    if (!guestToken) {
        console.error(`[${TAG}] ❌ 无法提取游客 token，流程终止`);
        console.error(`[${TAG}] guestResult keys: ${Object.keys(guestResult).join(', ')}`);
        console.error(`[${TAG}] guestResult.data: ${JSON.stringify(guestResult.data)}`);
        return;
    }

    console.log(`[${TAG}] ✅ 游客注册成功，token（前30位）: ${guestToken.substring(0, 30)}...`);
    sleep(1);

    // ── 步骤 2：生成随机手机号 + 发送绑定验证码 ───────────────
    console.log(`\n[${TAG}] ===== 步骤2：发送绑定手机验证码 =====`);

    const phone = randomPhone(TENANT_ID);
    console.log(`[${TAG}] 随机生成手机号: ${phone}`);

    // codeType=5：绑定手机号专用类型
    // verifyCodeType=1：手机号
    const verifyCode = sendToGetVerCode(1, 5, phone, adminToken);

    if (!verifyCode) {
        console.error(`[${TAG}] ❌ 获取验证码失败，流程终止`);
        return;
    }

    console.log(`[${TAG}] ✅ 验证码获取成功: ${verifyCode}`);
    sleep(1);

    // ── 步骤 3：调用 /api/User/BindPhone ─────────────────────
    console.log(`\n[${TAG}] ===== 步骤3：绑定手机号 =====`);

    const bindRes = frontRequest('/api/User/BindPhone', {
        phoneOrEmail: phone,
        code: verifyCode,
        password: ''
    }, guestToken);

    if (!bindRes || bindRes.msgCode !== 0) {
        console.error(`[${TAG}] ❌ 绑定手机失败: msgCode=${bindRes ? bindRes.msgCode : 'null'} msg=${bindRes ? bindRes.msg : ''}`);
        return;
    }

    console.log(`[${TAG}] ✅ 绑定手机成功: ${phone}`);
    sleep(1);

    // ── 步骤 4：GetUserInfo 验证转正结果 ──────────────────────
    console.log(`\n[${TAG}] ===== 步骤4：验证转正结果（GetUserInfo）=====`);

    const userInfoRes = frontRequest('/api/User/GetUserInfo', {}, guestToken);

    if (!userInfoRes || userInfoRes.msgCode !== 0) {
        console.error(`[${TAG}] ❌ GetUserInfo 请求失败: msgCode=${userInfoRes ? userInfoRes.msgCode : 'null'}`);
        return;
    }

    const userInfo = userInfoRes.data;
    if (!userInfo) {
        console.error(`[${TAG}] ❌ GetUserInfo 返回 data 为空`);
        return;
    }

    // ── 核心断言：canSetPassword 必须为 true ──────────────────
    if (userInfo.canSetPassword !== true) {
        console.error(`[${TAG}] ❌ 断言失败：canSetPassword = ${userInfo.canSetPassword}，转正流程可能有问题！`);
        console.error(`[${TAG}] 手机号: ${phone}`);
        console.error(`[${TAG}] userId: ${userInfo.userId}`);
        console.error(`[${TAG}] verifyMethods: ${JSON.stringify(userInfo.verifyMethods)}`);
        return;
    }

    // ── 全部通过，打印结果 ────────────────────────────────────
    console.log(`\n[${TAG}] ========== 🎉 游客转正成功 ==========`);
    console.log(`[${TAG}] ✅ canSetPassword = true（断言通过）`);
    console.log(`[${TAG}] 转正手机号: ${phone}`);
    console.log(`[${TAG}] userId:      ${userInfo.userId}`);
    console.log(`[${TAG}] nickName:    ${userInfo.nickName}`);
    console.log(`[${TAG}] 绑定手机:    ${userInfo.verifyMethods ? userInfo.verifyMethods.phone : '未知'}`);
    console.log(`[${TAG}] registerType: ${userInfo.registerType}`);
    console.log(`[${TAG}] ==========================================\n`);
}

// ============================================================
// handleSummary：最终汇总
// ============================================================

export function handleSummary(_data) {
    return {
        stdout: [
            '='.repeat(50),
            '  游客转正测试 - 完成',
            '  请查阅上方日志中 "转正手机号" 一行进行核验',
            '='.repeat(50)
        ].join('\n') + '\n'
    };
}
