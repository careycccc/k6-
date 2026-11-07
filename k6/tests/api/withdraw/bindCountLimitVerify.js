/**
 * 「绑定数量上限」配置验证（银行卡 / USDT / 电子钱包 / UPI）
 *
 * 新上线到 UAT 的后台配置页「绑定银行卡数 / USDT地址绑定数 / 电子钱包绑定数量 /
 * Upi绑定数量」（截图默认都是 2，一个会员账号最多只能绑定这么多张/个）。之前
 * addWalletApi.js 的 addFrontXxx 系列只把 10030(银行卡)/10031(电子钱包)/
 * 10032(USDT)/10039(UPI，文案不同"please contact customer service to modify")
 * 这几个「已绑满」错误码当成功处理（沿用现有钱包），从未
 * 专门验证过"绑到第 N+1 个真的会被拒绝、且后台实查数量不会超过配置值"这件事。
 *
 * 这次用新增的 Raw 版本（addFrontBankCardRaw 等，保留 alreadyFull 字段不简化成
 * boolean）精确验证：
 *   对每种类型，全新会员账号连续绑 LIMIT+2 次（每次用不同卡号/地址，避免撞到
 *   "唯一性"判断）：
 *     第 1..LIMIT 次  → 预期 ok=true  alreadyFull=false，后台实查数量递增
 *     第 LIMIT+1 次起 → 预期 alreadyFull=true（10030/10031/10032/10039），
 *                        后台实查数量应该停在 LIMIT，不再增长
 *
 * 不修改任何后台配置，只用测试账号自身的绑定操作验证"当前生效的上限值"（默认
 * 从截图读到的 2，可用 -e LIMIT= 覆盖，如果后台已经手工改过配置）。
 *
 * 运行方式：
 *   k6p -e TENANT_ID=3101 bindCountLimitVerify.js                     # 四种类型全跑，LIMIT=2
 *   k6p -e TENANT_ID=3101 -e LIMIT=3 -e TYPES=bank,usdt bindCountLimitVerify.js
 */
import { sleep, check } from 'k6';
import { tenantAdminLogin, tenantRequest } from '../../../libs/http/tenantRequest.js';
import { phoneRegister } from '../login/register.test.js';
import { generateRandomPhone } from '../../utils/accountGenerator.js';
import { getEnvByTenantId } from '../../../config/envconfig.js';
import {
    addFrontBankCardRaw, addFrontUsdtRaw, addFrontEWalletRaw, addFrontUpiRaw,
    generateTRONAddress, getUserWalletCount, getBankCode
} from './addWalletApi.js';
import { randomDigits } from '../../../libs/common/random.js';

export const options = { vus: 1, iterations: 1 };

const tenantId = __ENV.TENANT_ID || '3004';
const LIMIT = parseInt(__ENV.LIMIT || '2', 10);
const ENABLED_TYPES = (__ENV.TYPES || 'bank,usdt,ewallet,upi').split(',').map((s) => s.trim());

function registerFreshMember(adminData) {
    const countryCode = adminData.envConfig.COUNTRY_CODE || '91';
    const phone = generateRandomPhone(countryCode);
    const res = phoneRegister(phone, adminData, 'qwer1234', '');
    const token = res && res.data && res.data.token;
    if (!token) {
        console.error(`[BindCountLimit] ❌ 注册会员失败: ${phone} res=${JSON.stringify(res)}`);
        return null;
    }
    console.log(`[BindCountLimit] ✅ 新会员注册成功: ${phone}`);
    return { token, phone };
}

function getUserId(adminToken, account, retries = 4) {
    for (let i = 0; i <= retries; i++) {
        const pageResp = tenantRequest('/api/Users/GetPageList', { account, pageNo: 1, pageSize: 10 }, { token: adminToken, isDesk: false });
        const userId = pageResp && pageResp.data && pageResp.data.list && pageResp.data.list[0] && pageResp.data.list[0].userId;
        if (userId) return userId;
        console.warn(`[GetUserId] 账号${account}暂时查不到userId(第${i + 1}次)，2s后重试`);
        sleep(2);
    }
    console.error(`[GetUserId] 账号${account}连续${retries + 1}次都查不到userId，放弃`);
    return null;
}

/**
 * 对某个类型跑"连续绑 LIMIT+2 次"的验证
 * @param {object} cfg
 *   typeLabel - 日志显示名，如 '银行卡'
 *   rawBindFn - (memberToken, fixedValue) => {ok, alreadyFull, msgCode, msg}
 *   generateValueFn - () => string，每次生成不同的卡号/地址
 *   countKey  - getUserWalletCount 返回对象里对应的字段名，如 'bank'
 * @returns {Array}
 */
function runCountLimitCase(adminToken, adminData, cfg) {
    const { typeLabel, rawBindFn, generateValueFn, countKey } = cfg;
    const results = [];

    const member = registerFreshMember(adminData);
    if (!member) { console.error(`[${typeLabel}] 注册账号失败，跳过本类型`); return results; }
    const userId = getUserId(adminToken, member.phone);
    if (!userId) { console.error(`[${typeLabel}] 查不到userId，跳过本类型`); return results; }

    console.log(`\n========== [${typeLabel}] 账号=${member.phone} userId=${userId} 配置上限=${LIMIT} ==========`);

    const totalAttempts = LIMIT + 2;
    for (let i = 1; i <= totalAttempts; i++) {
        const value = generateValueFn();
        const raw = rawBindFn(member.token, value);
        sleep(2);
        const actual = getUserWalletCount(adminToken, userId);
        const actualCount = actual ? actual[countKey] : null;
        const expectFull = i > LIMIT;

        console.log(`[${typeLabel}] 第${i}次绑定: value=${value} ok=${raw.ok} alreadyFull=${raw.alreadyFull} msgCode=${raw.msgCode} | 后台实查数量=${actualCount}`);

        const pass = check(null, {
            [`${typeLabel} 第${i}次: alreadyFull应为${expectFull}`]: () => raw.alreadyFull === expectFull,
            [`${typeLabel} 第${i}次: 后台实查数量应${expectFull ? `停在${LIMIT}` : `等于${i}`}`]: () => actualCount === (expectFull ? LIMIT : i)
        });
        results.push({
            case: `${typeLabel}-第${i}次`,
            pass,
            detail: `ok=${raw.ok} alreadyFull=${raw.alreadyFull}(预期${expectFull}) msgCode=${raw.msgCode} 实查数量=${actualCount}(预期${expectFull ? LIMIT : i})`
        });
    }

    return results;
}

export function setup() {
    const envConfig = getEnvByTenantId(tenantId);
    const adminToken = tenantAdminLogin(tenantId);
    if (!adminToken) throw new Error('[BindCountLimit] 管理员登录失败');
    return { adminToken, adminData: { token: adminToken, envConfig, tenantId } };
}

export default function (data) {
    const { adminToken, adminData } = data;
    let allResults = [];

    if (ENABLED_TYPES.includes('bank')) {
        // bankCode 按租户的银行字典走，不同租户可用代码不一样（UAT 上硬编码的
        // 3004 测试代码 'INR10125' 会报 10010 The bank code not exists）
        const bankCode = getBankCode(adminToken, '1') || 'INR10125';
        console.log(`[BindCountLimit] 银行卡 bankCode=${bankCode}`);
        allResults = allResults.concat(runCountLimitCase(adminToken, adminData, {
            typeLabel: '银行卡',
            rawBindFn: (token, value) => addFrontBankCardRaw(token, bankCode, '', value),
            generateValueFn: () => randomDigits(18, true),
            countKey: 'bank'
        }));
    }

    if (ENABLED_TYPES.includes('usdt')) {
        allResults = allResults.concat(runCountLimitCase(adminToken, adminData, {
            typeLabel: 'USDT',
            rawBindFn: (token, value) => addFrontUsdtRaw(token, value),
            generateValueFn: () => generateTRONAddress(),
            countKey: 'usdt'
        }));
    }

    if (ENABLED_TYPES.includes('ewallet')) {
        const ewalletCode = getBankCode(adminToken, '2') || 'ceshiyong';
        console.log(`[BindCountLimit] 电子钱包 bankCode=${ewalletCode}`);
        allResults = allResults.concat(runCountLimitCase(adminToken, adminData, {
            typeLabel: '电子钱包',
            rawBindFn: (token, value) => addFrontEWalletRaw(token, ewalletCode, '', value),
            generateValueFn: () => randomDigits(10, true),
            countKey: 'ewallet'
        }));
    }

    if (ENABLED_TYPES.includes('upi')) {
        allResults = allResults.concat(runCountLimitCase(adminToken, adminData, {
            typeLabel: 'UPI',
            // UPI 账号格式固定"手机号@银行名称"由 generateUPIFormat() 内部生成，
            // 不支持外部指定固定值，所以这里不传 value，依赖函数内部每次生成不同值
            rawBindFn: (token) => addFrontUpiRaw(token),
            generateValueFn: () => null,
            countKey: 'upi'
        }));
    }

    console.log(`\n========== 全部验证结果汇总（LIMIT=${LIMIT}） ==========`);
    allResults.forEach((r) => {
        console.log(`${r.case}: ${r.pass ? '✅通过' : '❌不符合预期'} - ${r.detail}`);
    });
    const failCount = allResults.filter((r) => !r.pass).length;
    console.log(`\n[BindCountLimit] 总计 ${allResults.length} 项，失败 ${failCount} 项`);
}
