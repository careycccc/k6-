/**
 * 合伙人奖励 - 执行脚本（多租户多线程版）
 *
 * 功能：
 *   1. 邀请人通过邀请码注册直属下级
 *   2. 下级随机进行 1-4 次充值（首充/二充/三充/四充）
 *      - 90% 的用户至少充值 1 次（首充）
 *      - 二充 = 首充基础上 80% 的人继续
 *      - 三充 = 二充基础上 70% 的人继续
 *      - 四充 = 三充基础上 40% 的人继续
 *   3. 已充值用户随机投注 0-3 次（0次=只充值不打码）
 *   4. 已充值用户有 80% 概率绑定提现信息并发起提现
 *      （绑定提现信息 = 满足活动「下级绑定提现信息」前置条件）
 *
 * 使用方法：
 *   k6 run -e TENANT_ID=3004 -e ROOT_INVITE_CODE=EM2V2AN -e TOTAL_USERS=2 -e LEVELS=1 -e VUS=1 runPartnerBonusExec.test.js
 
* 场景一：要求下级注册指纹与上级完全相同
  k6 run -e TENANT_ID=3004 -e ROOT_USER_ID=139265 -e MATCH_MODE=FINGERPRINT -e TOTAL_USERS=3 -e LEVELS=1 -e VUS=1 runPartnerBonusExec.test.js
 
* 场景二：要求下级注册设备与上级完全相同
* k6 run -e TENANT_ID=3004 -e ROOT_USER_ID=139099 -e MATCH_MODE=DEVICE -e TOTAL_USERS=3 -e LEVELS=1 -e VUS=1 runPartnerBonusExec.test.js

* 场景三：要求下级注册指纹与设备都与上级完全相同
* k6 run -e TENANT_ID=3004 -e ROOT_USER_ID=139236 -e MATCH_MODE=BOTH -e TOTAL_USERS=3 -e LEVELS=1 -e VUS=1 runPartnerBonusExec.test.js
 * 
 * 
 * 
 * 场景四：所有直属下级共享相同 deviceId（随机生成，每次跑不同）
 * k6 run -e TENANT_ID=3004 -e ROOT_INVITE_CODE=CZZNQ8N -e MATCH_MODE=vanwioxzlw39hbca -e TOTAL_USERS=3 -e LEVELS=1 -e VUS=1 runPartnerBonusExec.test.js
 *
 * 场景五：所有直属下级共享相同 browserId（浏览器指纹）
 * k6 run -e TENANT_ID=3004 -e ROOT_INVITE_CODE=QAVEXPN -e MATCH_MODE=zvetxex3tk16lkdxv1uuvhixe3ts2lc1 -e TOTAL_USERS=2 -e LEVELS=1 -e VUS=1 runPartnerBonusExec.test.js
 *
 * 场景六：所有直属下级共享相同 deviceId 和 browserId
 * k6 run -e TENANT_ID=3004 -e ROOT_INVITE_CODE=RVWM9RN -e MATCH_MODE=SAME_BOTH -e TOTAL_USERS=3 -e LEVELS=1 -e VUS=1 runPartnerBonusExec.test.js
 * 
 * 
 * 环境变量：
 * TENANT_ID          租户ID（默认 3004）
 * ROOT_INVITE_CODE   邀请人的邀请码（不填则自动创建根节点）
 * TOTAL_USERS        团队总人数（默认 20，不含上级）
 * LEVELS             邀请层级（默认 2，合伙人奖励只计算直属下级，但支持多层结构）
 * VUS                并发线程数（默认自动计算）
 *
 * 模式三专用（显式传入设备/指纹）：
 * ROOT_DEVICE        上级注册时的 deviceId（不传则随机；传了会自动注册一个新上级）
 * ROOT_FINGERPRINT   上级注册时的 browserId（不传则随机；传了会自动注册一个新上级）
 * SUB_DEVICE         所有直属下级注册时的 deviceId（不传则各自随机）
 * SUB_FINGERPRINT    所有直属下级注册时的 browserId（不传则各自随机）
 *
 * 场景七：上级用指定设备号注册，下级各自随机
 * k6 run -e TENANT_ID=3004 -e ROOT_DEVICE=pv0cihr7acnkl0hm -e TOTAL_USERS=1 -e LEVELS=1 -e VUS=1 runPartnerBonusExec.test.js
 *
 * 场景八：上级用指定指纹注册，下级共享指定设备号
 * k6 run -e TENANT_ID=3004 -e ROOT_FINGERPRINT=vn3m43ws1rwxre7ifn7871nbc6dc41mf -e SUB_DEVICE=vanwioxzlw39hbcb -e TOTAL_USERS=2 -e LEVELS=1 -e VUS=1 runPartnerBonusExec.test.js
 *
 * 场景九：上级用指定设备号+指纹，下级共享指定设备号+指纹
 * k6 run -e TENANT_ID=3004 -e ROOT_DEVICE=rootDev16chars -e ROOT_FINGERPRINT=rootFingerprint32c -e SUB_DEVICE=subDev16chars -e SUB_FINGERPRINT=subFingerprint32ch -e TOTAL_USERS=3 -e LEVELS=1 -e VUS=2 runPartnerBonusExec.test.js
 *
 * 场景十：只传下级设备号（不创建新上级，用已有邀请码），下级共享设备号
 * k6 run -e TENANT_ID=3004 -e ROOT_INVITE_CODE=RVWM9RN -e SUB_DEVICE=subDev16chars -e TOTAL_USERS=3 -e LEVELS=1 -e VUS=2 runPartnerBonusExec.test.js
 */

import { sleep } from 'k6';
import exec from 'k6/execution';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { phoneRegisterByInvite, phoneRegister } from '../../login/register.test.js';
import { generateRandomPhone } from '../../../utils/accountGenerator.js';
import { getFrontUserInfo } from '../../user/userManagement.js';
import { hybridRecharge, getConfigRechargeAmount } from '../../recharge/rechargeService.js';
import { betRun } from '../../runbet/betRun.js';
import { addAllWallets } from '../../withdraw/addWalletApi.js';
import { getWithdrawBasicInfo, setWithdrawPassword } from '../../withdraw/withdrawApi.js';
import { executeWithdrawCase } from '../../withdraw/withdraw.test.js';
import { runBackendWithdrawApproval } from '../../withdraw/backendWithdrawApi.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import { phoneRegisterBySource, validateAndGetSuperiorSource } from '../../invite/inviteBySource.js';
import { generateCryptoRandomString } from '../../../utils/utils.js';

// ================================================================
// 全局参数
// ================================================================

const totalUsers = parseInt(__ENV.TOTAL_USERS || '20', 10);
const levels = parseInt(__ENV.LEVELS || '2', 10);

// 如果提供了 ROOT_INVITE_CODE、ROOT_USER_ID、ROOT_DEVICE 或 ROOT_FINGERPRINT，
// 说明上级已存在或会在 setup 里新建，TOTAL_USERS 直接等于下级总数，不需要再减 1
const hasExternalRoot = !!(
    __ENV.ROOT_INVITE_CODE ||
    __ENV.ROOT_USER_ID     ||
    __ENV.ROOT_DEVICE      ||
    __ENV.ROOT_FINGERPRINT
);
const subUsers = hasExternalRoot ? totalUsers : Math.max(1, totalUsers - 1);
const maxVus = Math.max(1, Math.floor(subUsers / levels));
let computedVus = Math.min(maxVus, 50);
if (__ENV.VUS) computedVus = parseInt(__ENV.VUS, 10);

export const options = {
    scenarios: {
        partner_bonus_exec: {
            executor: 'per-vu-iterations',
            vus: computedVus,
            iterations: 1,
            maxDuration: '4h',
        },
    },
};

// ================================================================
// 工具函数
// ================================================================

/** 从注册/登录响应中提取 token */
function extractToken(response) {
    if (!response) return null;
    if (response.data && response.data.token) return response.data.token;
    if (response.headers) {
        const auth = response.headers['Authorization'] || response.headers['authorization'];
        if (auth) return auth.replace(/^Bearer\s+/i, '').trim();
    }
    return null;
}

/**
 * 将 totalPeople 按权重随机分配到 levels 层
 * 高层拥有更多人数（金字塔结构）
 */
function distributePeople(totalPeople, levelCount) {
    if (levelCount <= 0 || totalPeople <= 0) return [];
    if (levelCount === 1) return [totalPeople];
    if (levelCount >= totalPeople) {
        return Array.from({ length: levelCount }, (_, i) => (i < totalPeople ? 1 : 0));
    }
    const weights = Array.from({ length: levelCount }, (_, i) =>
        ((levelCount - i) / levelCount) * (0.5 + Math.random())
    ).sort((a, b) => b - a);

    const totalW = weights.reduce((s, w) => s + w, 0);
    const result = weights.map(w => Math.max(1, Math.floor((w / totalW) * totalPeople)));

    let diff = totalPeople - result.reduce((s, n) => s + n, 0);
    while (diff > 0) { for (let i = 0; i < levelCount && diff > 0; i++) { result[i]++; diff--; } }
    while (diff < 0) { for (let i = levelCount - 1; i >= 0 && diff < 0; i--) { if (result[i] > 1) { result[i]--; diff++; } } }
    result.sort((a, b) => b - a);
    return result;
}

/** 从数组中随机取一个元素 */
function randomPick(pool) {
    if (!pool || pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 根据合伙人奖励的随机规则决定充值次数
 *
 * 小团队模式（subUsers < 5）：
 *   - 所有人必定充值，至少 1 次，无不活跃概率
 *   - 二充/三充/四充仍按概率随机，保留充值档次的多样性
 *
 * 大团队模式（subUsers >= 5）：
 *   - 10% 用户：0 次充值（完全不活跃）
 *   - 其余 90% 用户按概率递减充值
 *
 * @param {boolean} smallTeam - 是否小团队模式
 * @returns {number} 0 ~ 4
 */
function decideRechargeCount(smallTeam = false) {
    // 小团队：跳过不活跃逻辑，所有人都充值
    if (!smallTeam && Math.random() < 0.10) return 0;

    let count = 1;                              // 首充（必定发生）
    if (Math.random() < 0.80) {
        count = 2;                              // 二充
        if (Math.random() < 0.70) {
            count = 3;                          // 三充
            if (Math.random() < 0.40) {
                count = 4;                      // 四充
            }
        }
    }
    return count;
}

/**
 * 决定投注次数（只有充值用户才会投注）
 *
 * 小团队模式（subUsers < 5）：至少投注 1 次
 * 大团队模式（subUsers >= 5）：随机 0-3 次（0 = 充了钱但不打码）
 *
 * @param {boolean} smallTeam - 是否小团队模式
 * @returns {number} 0 ~ 3
 */
function decideBetCount(smallTeam = false) {
    if (smallTeam) return Math.floor(Math.random() * 3) + 1; // 1, 2, 3
    return Math.floor(Math.random() * 4); // 0, 1, 2, 3
}

// ================================================================
// Setup：管理员登录，准备根邀请码
// ================================================================

export function setup() {
    const tenantId = __ENV.TENANT_ID || '3004';
    console.log(`\n${'='.repeat(70)}`);
    console.log(`[Setup] 合伙人奖励执行脚本`);
    console.log(`[Setup] 租户: ${tenantId} | 总人数: ${totalUsers} | 层级: ${levels} | VU: ${computedVus}`);
    console.log(`${'='.repeat(70)}\n`);

    if (tenantId !== '3004') {
        const targetEnv = getEnvByTenantId(tenantId);
        if (targetEnv) Object.assign(ENV_CONFIG, targetEnv);
    }

    const adminToken = AdminLogin();
    if (!adminToken) throw new Error('[Setup] 管理员登录失败');

    let rootInviteCode = __ENV.ROOT_INVITE_CODE || '';

    const matchMode = __ENV.MATCH_MODE ? __ENV.MATCH_MODE.toUpperCase() : '';
    const rootUserId = __ENV.ROOT_USER_ID || '';
    let requiredFingerprint = '';
    let requiredDevice = '';

    // ── 模式一：复制上级的设备/指纹（FINGERPRINT / DEVICE / BOTH） ──
    if (matchMode === 'FINGERPRINT' || matchMode === 'DEVICE' || matchMode === 'BOTH') {
        const sourceData = validateAndGetSuperiorSource(adminToken, rootUserId, matchMode);
        requiredFingerprint = sourceData.requiredFingerprint;
        requiredDevice = sourceData.requiredDevice;
        rootInviteCode = rootUserId;

    // ── 模式二：所有直属下级共享同一套随机设备/指纹（SAME_DEVICE / SAME_FINGERPRINT / SAME_BOTH） ──
    } else if (matchMode === 'SAME_DEVICE' || matchMode === 'SAME_FINGERPRINT' || matchMode === 'SAME_BOTH') {
        if (matchMode === 'SAME_DEVICE' || matchMode === 'SAME_BOTH') {
            requiredDevice = generateCryptoRandomString(16);
        }
        if (matchMode === 'SAME_FINGERPRINT' || matchMode === 'SAME_BOTH') {
            requiredFingerprint = generateCryptoRandomString(32);
        }
        console.log(`[Setup] 🔀 直属下级共享模式: ${matchMode}`);
        console.log(`[Setup]    共享 deviceId  : ${requiredDevice   || '(各自随机)'}`);
        console.log(`[Setup]    共享 browserId : ${requiredFingerprint || '(各自随机)'}`);

    } else {
        // ── 模式三：显式传入上级/下级的设备号和指纹（ROOT_DEVICE / ROOT_FINGERPRINT / SUB_DEVICE / SUB_FINGERPRINT） ──
        // 只要传了 ROOT_DEVICE 或 ROOT_FINGERPRINT，就在此处注册一个新上级（使用指定的设备信息），
        // 拿到它的邀请码作为 rootInviteCode，TOTAL_USERS 仍然是下级总数
        const rootDeviceParam       = __ENV.ROOT_DEVICE       || '';
        const rootFingerprintParam  = __ENV.ROOT_FINGERPRINT  || '';
        const subDeviceParam        = __ENV.SUB_DEVICE        || '';
        const subFingerprintParam   = __ENV.SUB_FINGERPRINT   || '';

        // 下级的共享设备/指纹（传了就全部直属下级用同一个，不传则各自随机）
        requiredDevice      = subDeviceParam;
        requiredFingerprint = subFingerprintParam;

        if (rootDeviceParam || rootFingerprintParam) {
            // 需要注册一个指定设备/指纹的上级
            console.log(`[Setup] 🆕 模式三：注册指定设备/指纹的上级节点`);
            console.log(`[Setup]    上级 deviceId  : ${rootDeviceParam      || '(随机)'}`);
            console.log(`[Setup]    上级 browserId : ${rootFingerprintParam || '(随机)'}`);
            console.log(`[Setup]    下级 deviceId  : ${subDeviceParam       || '(各自随机)'}`);
            console.log(`[Setup]    下级 browserId : ${subFingerprintParam  || '(各自随机)'}`);

            const rootPhone   = generateRandomPhone(ENV_CONFIG.COUNTRY_CODE || '91');
            const adminData   = { token: adminToken, envConfig: ENV_CONFIG };
            // 上级用前台总代注册（无邀请码），携带指定的设备/指纹
            const rootRes     = phoneRegister(rootPhone, adminData, 'qwer1234', '', null, rootDeviceParam, rootFingerprintParam);
            const rootToken   = extractToken(rootRes);
            if (!rootToken) {
                throw new Error(`[Setup] ❌ 上级节点注册失败 | 账号: ${rootPhone}`);
            }
            sleep(1);
            const rootUserInfo = getFrontUserInfo(rootToken);
            if (!rootUserInfo || !rootUserInfo.inviteCode) {
                throw new Error(`[Setup] ❌ 上级节点注册成功但获取邀请码失败 | 账号: ${rootPhone}`);
            }
            rootInviteCode = rootUserInfo.inviteCode;
            console.log(`[Setup] ✅ 上级节点注册成功 | 账号: ${rootPhone} | userId: ${rootUserInfo.userId} | 邀请码: ${rootInviteCode}`);

        } else if (!rootInviteCode) {
            // 既没有传设备参数，也没有提供邀请码 → 走普通随机上级注册
            console.log('[Setup] 未提供 ROOT_INVITE_CODE，自动创建邀请人根节点...');
            const phone     = generateRandomPhone(ENV_CONFIG.COUNTRY_CODE || '91');
            const adminData = { token: adminToken, envConfig: ENV_CONFIG };
            const urls = {
                frontUrl:    ENV_CONFIG.BASE_DESK_URL,
                adminUrl:    ENV_CONFIG.BASE_ADMIN_URL,
                registerUrl: ENV_CONFIG.BASE_DESK_URL,
            };
            const res   = phoneRegisterByInvite(phone, '', adminData, 'qwer1234', '', urls);
            const token = extractToken(res);
            sleep(1);
            const userInfo = getFrontUserInfo(token);
            if (userInfo && userInfo.inviteCode) {
                rootInviteCode = userInfo.inviteCode;
                console.log(`[Setup] ✅ 邀请人根节点创建成功 | 账号: ${phone} | 邀请码: ${rootInviteCode}`);
            } else {
                throw new Error('[Setup] 根节点创建失败，无法获取邀请码');
            }
        }
    }

    return {
        adminToken,
        envConfig: ENV_CONFIG,
        rootInviteCode,
        tenantId,
        matchMode,
        requiredFingerprint,
        requiredDevice
    };
}

// ================================================================
// VU 主逻辑
// ================================================================

export default function (data) {
    const { adminToken, envConfig, rootInviteCode, tenantId, matchMode, requiredFingerprint, requiredDevice } = data;
    const vuId = exec.vu.idInInstance;

    if (tenantId !== '3004') Object.assign(ENV_CONFIG, envConfig);
    const adminData = { token: adminToken, envConfig };

    // 本 VU 负责的用户数
    let myUsers = Math.floor(subUsers / computedVus);
    if (vuId === computedVus) myUsers += (subUsers % computedVus);

    const levelDist = distributePeople(myUsers, levels);
    const codesByLevel = Array.from({ length: levels }, () => []);

    console.log(`\n[VU ${vuId}] 负责 ${myUsers} 人，层级分布: ${JSON.stringify(levelDist)}`);

    // 团队总人数 < 5 时进入小团队模式：所有人必须充值+投注，无不活跃
    const smallTeam = subUsers < 5;

    const customUrls = {
        frontUrl: envConfig.BASE_DESK_URL,
        adminUrl: envConfig.BASE_ADMIN_URL,
        registerUrl: envConfig.BASE_DESK_URL,
    };

    /** @type {Array<PartnerBonusReport>} */
    const reports = [];

    for (let lv = 0; lv < levelDist.length; lv++) {
        const count = levelDist[lv];

        for (let i = 0; i < count; i++) {
            const parentCode = lv === 0
                ? rootInviteCode
                : (randomPick(codesByLevel[lv - 1]) || rootInviteCode);

            const phone = generateRandomPhone(envConfig.COUNTRY_CODE || '91');

            /** @type {PartnerBonusReport} */
            const report = {
                level: lv + 1,
                parentInviteCode: parentCode,
                account: phone,
                userId: null,
                inviteCode: '',
                rechargeCount: 0,
                rechargeAmounts: [],   // 每次充值金额，index 0=首充，1=二充...
                betCount: 0,
                betAmounts: [],
                totalBetAmount: 0,
                didWithdraw: false,
                withdrawAmount: 0,
                withdrawType: '',
                failReason: '',
                registerOk: false,
            };

            // ── 1. 注册 ──────────────────────────────────────────
            // 复制上级模式（FINGERPRINT/DEVICE/BOTH）：所有层级都用 requiredDevice/requiredFingerprint
            // 共享模式（SAME_DEVICE/SAME_FINGERPRINT/SAME_BOTH）：只有直属下级（lv===0）共享，其余层随机
            // 模式三（ROOT_*/SUB_*）：直属下级（lv===0）用 requiredDevice/requiredFingerprint，其余层随机
            let res;
            const isSameMode = matchMode === 'SAME_DEVICE' || matchMode === 'SAME_FINGERPRINT' || matchMode === 'SAME_BOTH';
            const isCopyMode = matchMode === 'FINGERPRINT' || matchMode === 'DEVICE' || matchMode === 'BOTH';
            // 模式三没有 matchMode，但 requiredDevice/requiredFingerprint 可能非空（来自 SUB_DEVICE/SUB_FINGERPRINT）
            const hasSubOverride = !matchMode && (requiredDevice || requiredFingerprint);

            if (isCopyMode) {
                // 复制上级模式：全层级使用上级的设备/指纹
                res = phoneRegisterBySource(phone, parentCode, 'qwer1234', customUrls, requiredDevice, requiredFingerprint);
            } else if ((isSameMode || hasSubOverride) && lv === 0) {
                // 共享/模式三：仅直属下级（lv=0）使用共享的设备/指纹，有值就用，没值就在函数内随机
                res = phoneRegisterByInvite(phone, parentCode, adminData, 'qwer1234', '', customUrls, requiredDevice, requiredFingerprint);
            } else {
                // 普通模式或非直属下级：各自随机设备/指纹
                res = phoneRegisterByInvite(phone, parentCode, adminData, 'qwer1234', '', customUrls);
            }
            const token = extractToken(res);

            if (!token) {
                report.failReason = '注册失败';
                reports.push(report);
                continue;
            }

            sleep(0.5);
            const userInfo = getFrontUserInfo(token);
            if (!userInfo || !userInfo.userId) {
                report.failReason = '获取用户信息失败';
                reports.push(report);
                continue;
            }

            report.registerOk = true;
            report.userId = userInfo.userId;
            report.inviteCode = userInfo.inviteCode || '';
            codesByLevel[lv].push(userInfo.inviteCode);

            //console.log(`[VU ${vuId}] ✅ 注册成功 | L${lv + 1} | 账号: ${phone} | UID: ${userInfo.userId} | 邀请码: ${userInfo.inviteCode}`);
            sleep(1);

            // ── 2. 充值（首充 / 二充 / 三充 / 四充） ────────────
            const rechargeCount = decideRechargeCount(smallTeam);
            report.rechargeCount = rechargeCount;

            if (rechargeCount === 0) {
                console.log(`[VU ${vuId}] ⏭️  用户 ${phone} 不充值（10% 不活跃）`);
                reports.push(report);
                continue;
            }

            const slotLabels = ['首充', '二充', '三充', '四充'];

            for (let slot = 0; slot < rechargeCount; slot++) {
                if (slot > 0) sleep(2);
                const amount = getConfigRechargeAmount();
                const label = slotLabels[slot];

                console.log(`[VU ${vuId}] 💰 ${label} | ${phone} | 金额: ${amount}`);

                const result = hybridRecharge({
                    userToken: token,
                    adminToken: adminToken,
                    userId: userInfo.userId,
                    amount: amount,
                    frontendFirst: true,
                    remark: `PartnerBonus-${label}`,
                });

                if (result.success) {
                    report.rechargeAmounts.push(result.amount);
                    console.log(`[VU ${vuId}] ✅ ${label}成功 | ${phone} | 金额: ${result.amount}`);
                } else {
                    console.warn(`[VU ${vuId}] ❌ ${label}失败 | ${phone}`);
                    // 某次充值失败则停止后续充值档，记录实际成功次数
                    report.rechargeCount = report.rechargeAmounts.length;
                    break;
                }
            }

            if (report.rechargeAmounts.length === 0) {
                report.failReason = '所有充值失败';
                reports.push(report);
                continue;
            }

            sleep(1);

            // ── 3. 投注（小团队必投1次以上，大团队随机0-3次） ───
            const betCount = decideBetCount(smallTeam);
            report.betCount = betCount;

            if (betCount > 0) {
                for (let b = 0; b < betCount; b++) {
                    if (b > 0) sleep(1);
                    console.log(`[VU ${vuId}] 🎲 投注 ${b + 1}/${betCount} | ${phone}`);
                    const betRes = betRun(token, phone);
                    if (betRes) {
                        const betAmt = (typeof betRes === 'object' && betRes.amount) ? betRes.amount : 0;
                        report.betAmounts.push(betAmt);
                        report.totalBetAmount += betAmt;
                        console.log(`[VU ${vuId}] ✅ 投注成功 | ${phone} | 金额: ${betAmt}`);
                    } else {
                        console.warn(`[VU ${vuId}] ❌ 投注失败 | ${phone}`);
                    }
                }
            } else {
                console.log(`[VU ${vuId}] ⏭️  ${phone} 充值后不投注（0次）`);
            }

            sleep(1);

            // ── 4. 提现（80% 概率，充值用户才能提现） ────────────
            const doWithdraw = Math.random() < 0.80;

            if (doWithdraw) {
                console.log(`[VU ${vuId}] 💳 开始提现流程 | ${phone}`);

                // 4a. 绑定提现信息（addAllWallets = 绑定所有类型钱包）
                addAllWallets(adminToken, userInfo.userId);
                sleep(1);

                // 4b. 设置提现密码
                setWithdrawPassword(token, '123456');
                sleep(0.5);

                // 4c. 获取提现信息并发起提现
                const withdrawInfo = getWithdrawBasicInfo(token);
                if (withdrawInfo && withdrawInfo.balance > 0) {
                    const wRes = executeWithdrawCase(token, withdrawInfo.balance, withdrawInfo);
                    if (wRes && wRes.withDrawaAmont) {
                        report.didWithdraw = true;
                        report.withdrawAmount = wRes.withDrawaAmont;
                        report.withdrawType = wRes.withDrawaType || '';
                        console.log(`[VU ${vuId}] ✅ 提现申请成功 | ${phone} | 金额: ${wRes.withDrawaAmont}`);

                        // 4d. 后台自动审核（机审）
                        sleep(2);
                        runBackendWithdrawApproval(adminToken, userInfo.userId, wRes.withDrawaType, wRes.withDrawaAmont);
                    } else {
                        console.warn(`[VU ${vuId}] ⚠️  提现未通过条件检查 | ${phone}`);
                    }
                } else {
                    console.warn(`[VU ${vuId}] ⚠️  余额不足或获取提现信息失败 | ${phone}`);
                }

                sleep(1);
            } else {
                console.log(`[VU ${vuId}] ⏭️  ${phone} 不发起提现（20% 概率）`);
            }

            reports.push(report);
        } // end for i
    } // end for lv

    // ── 打印本 VU 报表 ──────────────────────────────────────────
    printVuReport(reports, rootInviteCode, vuId);
}

// ================================================================
// 报表打印
// ================================================================

/**
 * @typedef {Object} PartnerBonusReport
 * @property {number}   level            - 层级
 * @property {string}   parentInviteCode - 上级邀请码
 * @property {string}   account          - 账号
 * @property {number|null} userId        - 用户ID
 * @property {string}   inviteCode       - 本人邀请码
 * @property {number}   rechargeCount    - 实际充值次数
 * @property {number[]} rechargeAmounts  - 每次充值金额
 * @property {number}   betCount         - 投注次数
 * @property {number[]} betAmounts       - 每次投注金额
 * @property {number}   totalBetAmount   - 投注总额
 * @property {boolean}  didWithdraw      - 是否发起提现
 * @property {number}   withdrawAmount   - 提现金额
 * @property {string}   withdrawType     - 提现通道
 * @property {string}   failReason       - 失败原因
 * @property {boolean}  registerOk       - 是否注册成功
 */

function getDisplayWidth(str) {
    let w = 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) w += s.charCodeAt(i) > 255 ? 2 : 1;
    return w;
}

function padStr(str, width) {
    const s = String(str);
    const w = getDisplayWidth(s);
    return w >= width ? s : s + ' '.repeat(width - w);
}

function printVuReport(reports, rootInviteCode, vuId) {
    if (!reports || reports.length === 0) return;

    const sep = '='.repeat(120);
    const line = '-'.repeat(120);

    console.log(`\n${sep}`);
    console.log(`[VU ${vuId}] 📊 合伙人奖励执行报表`);
    console.log(`${sep}`);

    const headers = [
        '层级', '账号', '注册', '充值次数',
        '首充金额', '二充金额', '三充金额', '四充金额',
        '投注次数', '投注总额',
        '绑定提现', '提现金额', '提现通道',
        '失败原因',
    ];

    const rows = reports.map(r => [
        `L${r.level}`,
        r.account,
        r.registerOk ? '✅' : '❌',
        String(r.rechargeCount),
        r.rechargeAmounts[0] != null ? String(r.rechargeAmounts[0]) : '-',
        r.rechargeAmounts[1] != null ? String(r.rechargeAmounts[1]) : '-',
        r.rechargeAmounts[2] != null ? String(r.rechargeAmounts[2]) : '-',
        r.rechargeAmounts[3] != null ? String(r.rechargeAmounts[3]) : '-',
        String(r.betCount),
        r.totalBetAmount > 0 ? String(r.totalBetAmount) : '-',
        r.didWithdraw ? '✅' : '-',
        r.withdrawAmount > 0 ? String(r.withdrawAmount) : '-',
        r.withdrawType || '-',
        r.failReason || '-',
    ]);

    // 计算列宽
    const colW = headers.map(h => getDisplayWidth(h));
    for (const row of rows) {
        for (let c = 0; c < row.length; c++) {
            const w = getDisplayWidth(row[c]);
            if (w > colW[c]) colW[c] = w;
        }
    }
    for (let c = 0; c < colW.length; c++) colW[c] += 2;

    // 构建表格
    let table = '';

    // 每列格式：| 空格 + 内容(右填充到colW) + 空格 |
    // 分隔线：  |---( colW+2 个 - )---|
    // 三者完全统一，表头/分隔线/数据行每格占用 colW+2 个字符

    let headerLine = '|';
    for (let c = 0; c < headers.length; c++) {
        headerLine += ` ${padStr(headers[c], colW[c])} |`;
    }
    table += headerLine + '\n';

    let divider = '|';
    for (let c = 0; c < colW.length; c++) {
        divider += `${'-'.repeat(colW[c] + 2)}|`;
    }
    table += divider + '\n';

    for (const row of rows) {
        let r = '|';
        for (let c = 0; c < row.length; c++) {
            r += ` ${padStr(row[c], colW[c])} |`;
        }
        table += r + '\n';
    }

    console.log(table);

    // 汇总统计
    const totalUsers = reports.length;
    const regOk = reports.filter(r => r.registerOk).length;
    const recharged = reports.filter(r => r.rechargeAmounts.length > 0).length;
    const totalRecharge = reports.reduce((s, r) => s + r.rechargeAmounts.reduce((a, v) => a + v, 0), 0);
    const bettors = reports.filter(r => r.betCount > 0).length;
    const totalBet = reports.reduce((s, r) => s + r.totalBetAmount, 0);
    const withdrawers = reports.filter(r => r.didWithdraw).length;
    const totalWithdraw = reports.reduce((s, r) => s + r.withdrawAmount, 0);

    // 充值档分布
    const rechargeSlotCounts = [0, 0, 0, 0];
    for (const r of reports) {
        for (let s = 0; s < r.rechargeAmounts.length && s < 4; s++) {
            rechargeSlotCounts[s]++;
        }
    }

    console.log(`${line}`);
    console.log(`📌 汇总 | VU ${vuId} | 根邀请码: ${rootInviteCode}`);
    console.log(`   注册人数       : ${regOk}/${totalUsers}`);
    console.log(`   充值人数       : ${recharged} (首充: ${rechargeSlotCounts[0]}, 二充: ${rechargeSlotCounts[1]}, 三充: ${rechargeSlotCounts[2]}, 四充: ${rechargeSlotCounts[3]})`);
    console.log(`   充值总额       : ${totalRecharge}`);
    console.log(`   投注人数       : ${bettors}`);
    console.log(`   投注总额       : ${totalBet}`);
    console.log(`   绑定提现并提现 : ${withdrawers}`);
    console.log(`   提现总额       : ${totalWithdraw}`);
    console.log(`${sep}\n`);
}
