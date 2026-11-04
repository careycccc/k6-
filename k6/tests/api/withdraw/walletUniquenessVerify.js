/**
 * 钱包绑定唯一性验证（银行卡 / USDT / 电子钱包）
 *
 * 验证后台"绑定唯一性"开关（IsBindBankUnique / IsBindUSDTUnique / IsBindEWalletUnique）
 * 的真实行为。业务前提（截图提示文案）："开启后记录过绑定的记录删除后无法重新添加"；
 * 用户确认过唯一性判断维度是会员账号(userId)，不是持卡人姓名。
 *
 * 每种类型都跑同一套测试矩阵：
 *   TC1 开关开启：A 绑定→删除→A 自己重新绑定同一个值        → 预期失败（截图提示文案直接对应）
 *   TC2 开关开启：A 绑定→删除→B(不同userId)绑定同一个值      → 待实测的真实行为，不预设对错
 *   TC3 对照组，开关关闭：A 绑定→删除→A 自己重新绑定          → 预期成功
 *   TC4 用例C，开关开启时删除→切到关闭→等待1分钟→重新绑定    → 验证开关状态是否实时生效，
 *       还是历史删除记录的限制会在开关关闭后持续存在
 *
 * 2026-11-03 银行卡这套矩阵已经独立验证通过（4个TC全部符合预期），结论：
 *   - 唯一性限制是对"这个值"本身的永久拉黑，不区分是原用户自己还是全新用户来绑
 *   - 开关状态是实时生效的（每次绑定动态检查，不是删除那一刻写死的静态标记）
 * 这次把 USDT/电子钱包也接入同一套矩阵，确认是否同样的行为。
 *
 * 每个场景都用 phoneRegister 现场注册全新会员账号，不依赖任何预先采集的账号池文件，
 * 保证测试独立、可重复运行、不受历史测试数据污染。
 *
 * 运行方式：
 *   k6p -e TENANT_ID=3004 walletUniquenessVerify.js                     # 三种类型全跑
 *   k6p -e TENANT_ID=3004 -e TYPES=usdt,ewallet walletUniquenessVerify.js # 只跑指定类型
 */
import { sleep, check } from 'k6';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { tenantRequest } from '../../../libs/http/tenantRequest.js';
import { phoneRegister } from '../login/register.test.js';
import { generateRandomPhone } from '../../utils/accountGenerator.js';
import { getEnvByTenantId } from '../../../config/envconfig.js';
import { addFrontBankCard, addFrontUsdt, addFrontEWallet, generateTRONAddress } from './addWalletApi.js';
import { randomDigits } from '../../../libs/common/random.js';
import { submitDeleteBankCardOrder, approveAndExecuteDeleteBankCard } from './deleteBankCardOrder.js';
import { submitDeleteUsdtOrder, approveAndExecuteDeleteUsdt } from './deleteUsdtOrder.js';
import { submitDeleteEWalletOrder, approveAndExecuteDeleteEWallet } from './deleteEWalletOrder.js';
import { setBankUniqueness, setUsdtUniqueness, setEWalletUniqueness } from './rechargeWithdrawSetting.js';

export const options = { vus: 1, iterations: 1 };

const tenantId = __ENV.TENANT_ID || '3004';
const ENABLED_TYPES = (__ENV.TYPES || 'bank,usdt,ewallet').split(',').map((s) => s.trim());

/**
 * 现场注册一个全新会员账号
 * @param {object} adminData - { token, envConfig, tenantId }
 * @returns {{token: string, phone: string}|null}
 */
function registerFreshMember(adminData) {
    const countryCode = adminData.envConfig.COUNTRY_CODE || '91';
    const phone = generateRandomPhone(countryCode);
    const res = phoneRegister(phone, adminData, 'qwer1234', '');
    const token = res && res.data && res.data.token;
    if (!token) {
        console.error(`[UniquenessVerify] ❌ 注册会员失败: ${phone} res=${JSON.stringify(res)}`);
        return null;
    }
    console.log(`[UniquenessVerify] ✅ 新会员注册成功: ${phone}`);
    return { token, phone };
}

/**
 * 按手机号查后台 userId，带重试——新注册账号不会立即出现在 GetPageList 查询结果里，
 * 紧跟着注册成功就查一次经常查不到（返回 undefined），必须重试等索引同步。
 */
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
 * 查用户钱包详情，带重试——网络抖动/接口瞬时异常偶尔会导致 tenantRequest 返回
 * 不含 data 字段的响应，不重试直接用会让整条长流程因为一次偶发故障而崩溃退出。
 */
function getWalletDetailSafe(adminToken, userId, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        const detail = tenantRequest('/api/Users/GetWallet', { userId }, { token: adminToken, isDesk: false });
        if (detail && detail.data) return detail;
        console.warn(`[GetWallet] 查询异常(第${i + 1}次)，2s后重试: ${JSON.stringify(detail)}`);
        sleep(2);
    }
    console.error(`[GetWallet] 连续${retries + 1}次查询都失败，放弃`);
    return null;
}

/**
 * 对某个钱包类型跑完整的唯一性矩阵（TC1-TC4）
 * @param {string} adminToken
 * @param {object} adminData
 * @param {object} cfg
 *   typeLabel      - 日志里显示的类型名，如 '银行卡'
 *   bindFn         - (memberToken, fixedValue) => boolean
 *   generateValueFn- () => string，生成"实际值"（卡号/USDT地址/电子钱包账号）。
 *       必须由调用方预先生成、显式传给 bindFn，不能依赖提交后从 GetWallet 反查——
 *       电子钱包这个类型，查询接口返回的 electronicName 固定是渠道类型名(如
 *       'ceshiyong')，不是提交时传的那个账号，账号本身在查询结果里是脱敏显示
 *       的(mobileNo字段，形如 7*******79)，反查不到完整原始值。银行卡/USDT虽然
 *       原样返回不脱敏，但统一用"预先生成"模式更一致、也不依赖这个假设继续成立。
 *   listKey        - GetWallet 响应里对应类型的数组字段名（仅用于反查 recordId）
 *   submitDeleteFn - (userToken, adminToken, recordId, value) => boolean
 *   executeDeleteFn- (adminToken, userId) => boolean
 *   setUniquenessFn- (adminToken, enabled) => boolean
 * @returns {Array}
 */
function runUniquenessMatrix(adminToken, adminData, cfg) {
    const { typeLabel, bindFn, generateValueFn, listKey, submitDeleteFn, executeDeleteFn, setUniquenessFn } = cfg;
    const results = [];

    function bindAndDelete(memberToken, userId, tag) {
        const value = generateValueFn();
        const addOk = bindFn(memberToken, value);
        if (!addOk) { console.error(`[${tag}] 绑定失败 value=${value}`); return null; }
        sleep(2);

        const detail = getWalletDetailSafe(adminToken, userId);
        if (!detail) { console.error(`[${tag}] 查钱包详情失败，中止`); return null; }
        const listBefore = detail.data[listKey] || [];
        const record = listBefore[0];
        if (!record) { console.error(`[${tag}] 查不到刚绑的记录`); return null; }
        console.log(`[${tag}] 绑定成功: value=${value} recordId=${record.id}`);

        const submitOk = submitDeleteFn(memberToken, adminToken, record.id, value);
        sleep(2);
        const execOk = executeDeleteFn(adminToken, userId);
        sleep(2);
        if (!submitOk || !execOk) {
            console.error(`[${tag}] ⚠️ 删除流程未完全成功 submitOk=${submitOk} execOk=${execOk}`);
        }

        // 用数量变化判断删除是否生效，不依赖具体字段是否可比对——电子钱包的账号
        // 在查询结果里是脱敏的，没法用"值是否还在列表里"这种精确匹配方式核实
        const detailAfter = getWalletDetailSafe(adminToken, userId);
        const countAfter = detailAfter ? (detailAfter.data[listKey] || []).length : null;
        console.log(`[${tag}] 删除后实查: 删除前数量=${listBefore.length} 删除后数量=${countAfter}`);

        return value;
    }

    // ============ TC1 ============
    console.log(`\n========== [${typeLabel}] TC1: 开关开启，原用户重新绑定已删除的记录 ==========`);
    setUniquenessFn(adminToken, true);
    sleep(3);
    const memberA1 = registerFreshMember(adminData);
    const userIdA1 = memberA1 && getUserId(adminToken, memberA1.phone);
    if (memberA1 && userIdA1) {
        const valueA1 = bindAndDelete(memberA1.token, userIdA1, `${typeLabel}-TC1`);
        if (valueA1) {
            const retryResult = bindFn(memberA1.token, valueA1);
            const pass = check(null, {
                [`${typeLabel} TC1: 开关开启时，原用户重新绑定已删除的记录应该失败`]: () => retryResult === false
            });
            results.push({ case: `${typeLabel}-TC1`, pass, detail: `重新绑定结果=${retryResult}` });
            console.log(`${typeLabel} TC1结果: ${pass ? '✅通过' : '❌不符合预期'} (重新绑定返回${retryResult})`);
        }
    }

    // ============ TC2 ============
    console.log(`\n========== [${typeLabel}] TC2: 开关开启，新用户绑定原用户已删除的记录 ==========`);
    const memberA2 = registerFreshMember(adminData);
    const userIdA2 = memberA2 && getUserId(adminToken, memberA2.phone);
    if (memberA2 && userIdA2) {
        const valueA2 = bindAndDelete(memberA2.token, userIdA2, `${typeLabel}-TC2-A`);
        if (valueA2) {
            const memberB2 = registerFreshMember(adminData);
            if (memberB2) {
                const bindResult = bindFn(memberB2.token, valueA2);
                console.log(`${typeLabel} TC2结果: 新用户绑定原用户已删除的记录 → ${bindResult}（不预设对错）`);
                results.push({ case: `${typeLabel}-TC2`, pass: null, detail: `新用户绑定结果=${bindResult}` });
            }
        }
    }

    // ============ TC3 ============
    console.log(`\n========== [${typeLabel}] TC3: 对照组-开关关闭，原用户重新绑定已删除的记录 ==========`);
    setUniquenessFn(adminToken, false);
    sleep(3);
    const memberA3 = registerFreshMember(adminData);
    const userIdA3 = memberA3 && getUserId(adminToken, memberA3.phone);
    if (memberA3 && userIdA3) {
        const valueA3 = bindAndDelete(memberA3.token, userIdA3, `${typeLabel}-TC3`);
        if (valueA3) {
            const retryResult3 = bindFn(memberA3.token, valueA3);
            const pass = check(null, {
                [`${typeLabel} TC3: 开关关闭时，原用户重新绑定已删除的记录应该成功`]: () => retryResult3 === true
            });
            results.push({ case: `${typeLabel}-TC3`, pass, detail: `重新绑定结果=${retryResult3}` });
            console.log(`${typeLabel} TC3结果: ${pass ? '✅通过' : '❌不符合预期'} (重新绑定返回${retryResult3})`);
        }
    }

    // ============ TC4(用例C) ============
    console.log(`\n========== [${typeLabel}] TC4(用例C): 开启时删除，切到关闭，等待1分钟后重新绑定 ==========`);
    setUniquenessFn(adminToken, true);
    sleep(3);
    const memberA4 = registerFreshMember(adminData);
    const userIdA4 = memberA4 && getUserId(adminToken, memberA4.phone);
    if (memberA4 && userIdA4) {
        const valueA4 = bindAndDelete(memberA4.token, userIdA4, `${typeLabel}-TC4`);
        if (valueA4) {
            const beforeSwitchResult = bindFn(memberA4.token, valueA4);
            console.log(`${typeLabel} 切换开关前，重新绑定结果: ${beforeSwitchResult}（预期false，和TC1一致，作为对比基线）`);

            setUniquenessFn(adminToken, false);
            console.log(`${typeLabel} 开关已切换为关闭，等待1分钟...`);
            sleep(60);

            const afterSwitchResult = bindFn(memberA4.token, valueA4);
            const pass = check(null, {
                [`${typeLabel} TC4: 开关切到关闭后，之前被限制的记录应该可以重新绑定`]: () => afterSwitchResult === true
            });
            results.push({ case: `${typeLabel}-TC4`, pass, detail: `切换前=${beforeSwitchResult} 切换后=${afterSwitchResult}` });
            console.log(`${typeLabel} TC4结果: ${pass ? '✅通过' : '❌不符合预期'} (切换前=${beforeSwitchResult}, 切换后=${afterSwitchResult})`);
        }
    }

    // 恢复开关为开启状态，不污染测试环境（截图确认过默认是开启的）
    setUniquenessFn(adminToken, true);

    return results;
}

export function setup() {
    const envConfig = getEnvByTenantId(tenantId);
    const adminToken = tenantAdminLogin(tenantId);
    if (!adminToken) throw new Error('[UniquenessVerify] 管理员登录失败');
    return { adminToken, adminData: { token: adminToken, envConfig, tenantId } };
}

export default function (data) {
    const { adminToken, adminData } = data;
    let allResults = [];

    if (ENABLED_TYPES.includes('bank')) {
        allResults = allResults.concat(runUniquenessMatrix(adminToken, adminData, {
            typeLabel: '银行卡',
            bindFn: (token, fixedValue) => addFrontBankCard(token, 'INR10125', '', fixedValue),
            generateValueFn: () => randomDigits(18, true),
            listKey: 'usersWalletbankList',
            submitDeleteFn: submitDeleteBankCardOrder,
            executeDeleteFn: approveAndExecuteDeleteBankCard,
            setUniquenessFn: setBankUniqueness
        }));
    }

    if (ENABLED_TYPES.includes('usdt')) {
        allResults = allResults.concat(runUniquenessMatrix(adminToken, adminData, {
            typeLabel: 'USDT',
            bindFn: (token, fixedValue) => addFrontUsdt(token, fixedValue),
            generateValueFn: () => generateTRONAddress(),
            listKey: 'usersWalletVirtualCurrencyList',
            submitDeleteFn: submitDeleteUsdtOrder,
            executeDeleteFn: approveAndExecuteDeleteUsdt,
            setUniquenessFn: setUsdtUniqueness
        }));
    }

    if (ENABLED_TYPES.includes('ewallet')) {
        allResults = allResults.concat(runUniquenessMatrix(adminToken, adminData, {
            typeLabel: '电子钱包',
            bindFn: (token, fixedValue) => addFrontEWallet(token, 'ceshiyong', '', fixedValue),
            generateValueFn: () => randomDigits(10, true),
            listKey: 'usersWalletElectronicWalletList',
            submitDeleteFn: submitDeleteEWalletOrder,
            executeDeleteFn: approveAndExecuteDeleteEWallet,
            setUniquenessFn: setEWalletUniqueness
        }));
    }

    console.log(`\n========== 全部验证结果汇总 ==========`);
    allResults.forEach((r) => {
        const mark = r.pass === null ? '📋记录(无预设对错)' : r.pass ? '✅通过' : '❌不符合预期';
        console.log(`${r.case}: ${mark} - ${r.detail}`);
    });
}
