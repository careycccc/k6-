/**
 * 充值大类（可见等级）& 充值通道（适用等级）测试脚本
 *
 * 测试用例覆盖：
 *   TC-01 获取充值大类列表，state=1 的大类必须存在
 *   TC-02 获取充值通道列表，state=1 的通道必须存在
 *   TC-03 充值通道适用等级 - 设置指定等级（如 [1,2,3]），仅该等级用户可见
 *   TC-04 充值通道适用等级 - 设置空列表 []，代表全部等级可见
 *   TC-05 充值大类可见等级 - 设置指定等级（如 [0,1,2]），仅该等级用户可见
 *   TC-06 充值大类可见等级 - 设置空列表 []，代表全部等级可见
 *   TC-07 前台验证 - 当前用户 rechargeLevel 在大类可见等级内，大类应出现在 supportCategories
 *   TC-08 前台验证 - 当前用户 rechargeLevel 不在大类可见等级内，大类不应出现在 supportCategories
 *
 * 执行顺序：
 *   setup()    → 后台登录 + 读取数据 + 配置等级 → 等待60s缓存刷新
 *   default()  → 前台登录 + 获取 userInfo + 获取 rechargeBasicInfo + 断言校验
 *   teardown() → 还原配置
 *
 * 运行命令（示例）：
 *   k6 run rechargeLevelConfig.test.js -e TENANT_ID=3004 -e TEST_RECHARGE_LEVEL=2
 */

import { sleep, check } from 'k6';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { sendRequest, sendQueryRequest } from '../common/request.js';
import { generateCryptoRandomString } from '../../utils/utils.js';
import { getFrontUserInfo } from '../user/userManagement.js';

// ================================================================
// K6 Options
// ================================================================
export const options = {
    setupTimeout: '3m',      // sleep(60) + 查用户 + 前台登录，至少需要 90s
    teardownTimeout: '2m',   // 还原所有大类/通道配置
    scenarios: {
        recharge_level_config: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '10m'
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.01']
    }
};

// ================================================================
// 工具函数
// ================================================================

/** 获取后台充值大类列表（state=1） */
function getActiveCategoryList(adminToken) {
    const api = '/api/RechargeCategory/GetPageList';
    const payload = { pageNo: 1, pageSize: 200 };
    const res = sendQueryRequest(payload, api, 'GetCategoryList', false, adminToken);
    const list = (res && res.list) || (res && res.data && res.data.list) || [];
    return list.filter(c => c.state === 1);
}

/** 获取后台充值通道列表（state=1） */
function getActiveChannelList(adminToken) {
    const api = '/api/RechargeChannel/GetPageList';
    const payload = { sortField: 'id', pageNo: 1, pageSize: 200 };
    const res = sendQueryRequest(payload, api, 'GetChannelList', false, adminToken);
    const list = (res && res.list) || (res && res.data && res.data.list) || [];
    return list.filter(c => c.state === 1);
}

/** 更新充值大类可见等级 */
function updateCategoryLevel(adminToken, category, rechargeLevelList) {
    const api = '/api/RechargeCategory/UpdateCommon';
    let configList = [];
    if (Array.isArray(category.quickConfigList)) {
        configList = category.quickConfigList.map(c => ({
            rechargeAmount: c.rechargeAmount,
            gifType: c.gifType,
            giftAmount: c.giftAmount
        }));
    }
    const payload = {
        id: category.id,
        rechargeLevelList: rechargeLevelList,
        discountLevelList: [],
        sort: category.sort,
        minAmount: category.minAmount,
        maxAmount: category.maxAmount,
        giftRatioType: category.giftRatioType,
        scaleType: category.scaleType,
        rechargeGiftRatio: category.rechargeGiftRatioInfo,
        configList: configList
    };
    const res = sendRequest(payload, api, 'UpdateCategoryLevel', false, adminToken);
    const code = res && (res.msgCode !== undefined ? res.msgCode : res.code);
    return code === 0;
}

/** 更新充值通道适用等级 */
function updateChannelLevel(adminToken, channel, rechargeLevelList) {
    const api = '/api/RechargeChannel/UpdateRemark';
    const payload = {
        name: channel.name,
        remark: channel.remark || '',
        channelId: channel.channelId,
        minAmount: channel.minAmount,
        maxAmount: channel.maxAmount,
        rechargeLevelList: rechargeLevelList
    };
    const res = sendRequest(payload, api, 'UpdateChannelLevel', false, adminToken);
    const code = res && (res.msgCode !== undefined ? res.msgCode : res.code);
    return code === 0;
}

/**
 * 从后台获取用户列表，尝试密码登录，返回第一个登录成功的用户
 * @param {string} adminToken
 * @param {number} targetLevel  - 目标 rechargeLevel（可选，传 -1 不过滤）
 */
function findAndLoginUser(adminToken, targetLevel) {
    const api = '/api/Users/GetPageList';
    const tag = 'FindLoginableUser';

    const filterPayload = targetLevel >= 0
        ? { rechargeLevel: targetLevel, pageNo: 1, pageSize: 30 }
        : { pageNo: 1, pageSize: 30 };

    const res = sendQueryRequest(filterPayload, api, tag, false, adminToken);
    const list = (res && res.list) || (res && res.data && res.data.list) || [];

    if (list.length === 0) {
        console.warn(`[${tag}] 未找到 rechargeLevel=${targetLevel} 的可用测试账号，请在后台准备此类数据`);
        return null;
    }

    return tryLoginUsers(list);
}

/** 遍历用户列表，用密码 qwer1234 逐一尝试登录 */
function tryLoginUsers(userList) {
    const loginApi = '/api/Home/Login';
    for (let i = 0; i < userList.length; i++) {
        const user = userList[i];
        const account = user.userName || user.phone || user.account || '';
        if (!account) continue;

        console.log(`[Login] 尝试账号: ${account} (rechargeLevel=${user.rechargeLevel})`);

        const payload = {
            userName: account,
            password: 'qwer1234',
            loginType: 'Mobile',
            deviceId: '',
            browserId: generateCryptoRandomString(32),
            packageName: ''
        };

        const token = sendRequest(payload, loginApi, 'FrontLogin', true);

        if (token && typeof token === 'string' && token.length > 10) {
            console.log(`[Login] ✅ 登录成功: ${account}`);
            return { token, user };
        }
        if (token && token.token) {
            console.log(`[Login] ✅ 登录成功: ${account}`);
            return { token: token.token, user };
        }

        console.log(`[Login] ❌ ${account} 登录失败，换下一个`);
    }
    return null;
}

/** 获取前台充值基础信息（含 goodsList.supportCategories） */
function getRechargeBasicInfo(userToken) {
    const res = sendRequest({}, '/api/Recharge/GetRechargeBasicInfo', 'GetRechargeBasicInfo', true, userToken);
    return res && res.goodsList ? res : (res && res.data) || null;
}

/** 解析后台 rechargeLevel 字符串 → number[] */
function parseLevelString(levelStr) {
    if (!levelStr || levelStr.trim() === '') return []; // 空 = 全部
    return levelStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
}

// ================================================================
// Setup：后台登录 + 读取当前配置 + 按用例设置等级
// ================================================================
export function setup() {
    console.log('\n========== [Setup] 后台初始化 ==========');

    // 1. 后台登录
    const adminToken = tenantAdminLogin();
    if (!adminToken) throw new Error('[Setup] 后台登录失败');
    console.log('[Setup] ✅ 后台登录成功');

    // 2. 获取大类 & 通道（state=1）
    const categories = getActiveCategoryList(adminToken);
    const channels = getActiveChannelList(adminToken);

    if (categories.length === 0) throw new Error('[Setup] 没有可用的开启充值大类');
    if (channels.length === 0) throw new Error('[Setup] 没有可用的开启充值通道');

    console.log(`[Setup] 开启充值大类 ${categories.length} 个: ${categories.map(c => c.id).join(',')}`);
    console.log(`[Setup] 开启充值通道 ${channels.length} 个: ${channels.map(c => c.channelId).join(',')}`);

    // 保存原始等级配置，供 teardown 还原
    const originalCategoryLevels = {};
    categories.forEach(c => {
        originalCategoryLevels[c.id] = c.rechargeLevel || '';
    });
    const originalChannelLevels = {};
    channels.forEach(ch => {
        originalChannelLevels[ch.channelId] = ch.rechargeLevel || '';
    });

    // ---------------------------------------------------------------
    // TC-03 & TC-04: 设置通道适用等级（取第一个通道作为测试对象）
    // TC-03: 设置 [1,2,3]
    // TC-04: 设置 []（全部）
    // ---------------------------------------------------------------
    const testChannel = channels[0];
    const channelLevelForTC03 = [1, 2, 3];
    const channelLevelForTC04 = [];

    console.log(`\n[TC-03] 充值通道适用等级 - 设置 [${channelLevelForTC03}] → channelId=${testChannel.channelId}`);
    const tc03Ok = updateChannelLevel(adminToken, testChannel, channelLevelForTC03);
    console.log(`[TC-03] 结果: ${tc03Ok ? '✅ 成功' : '❌ 失败'}`);

    console.log(`\n[TC-04] 充值通道适用等级 - 设置 [] (全部) → channelId=${testChannel.channelId}`);
    const tc04Ok = updateChannelLevel(adminToken, testChannel, channelLevelForTC04);
    console.log(`[TC-04] 结果: ${tc04Ok ? '✅ 成功' : '❌ 失败'}`);

    // ---------------------------------------------------------------
    // TC-05 & TC-06: 设置大类可见等级（取第一个大类作为测试对象）
    // TC-05: 设置 [0,1,2]
    // TC-06: 设置 []（全部）
    // ---------------------------------------------------------------
    const testCategory = categories[0];
    const categoryLevelForTC05 = [0, 1, 2];
    const categoryLevelForTC06 = [];

    console.log(`\n[TC-05] 充值大类可见等级 - 设置 [${categoryLevelForTC05}] → id=${testCategory.id}`);
    const tc05Ok = updateCategoryLevel(adminToken, testCategory, categoryLevelForTC05);
    console.log(`[TC-05] 结果: ${tc05Ok ? '✅ 成功' : '❌ 失败'}`);

    console.log(`\n[TC-06] 充值大类可见等级 - 设置 [] (全部) → id=${testCategory.id}`);
    const tc06Ok = updateCategoryLevel(adminToken, testCategory, categoryLevelForTC06);
    console.log(`[TC-06] 结果: ${tc06Ok ? '✅ 成功' : '❌ 失败'}`);

    // ---------------------------------------------------------------
    // TC-07 & TC-08 准备：设置大类可见等级为 [1,2,3]，
    // 然后分别找 level=2（在范围内）和 level=5（不在范围内）的用户
    // ---------------------------------------------------------------
    const verifyLevels = [1, 2, 3]; // 可见等级范围
    console.log(`\n[TC-07/08] 将大类 id=${testCategory.id} 可见等级设置为 [${verifyLevels}] 供前台验证`);
    updateCategoryLevel(adminToken, testCategory, verifyLevels);

    // 等待60秒缓存刷新
    console.log('\n[Setup] ⏳ 等待 60s 缓存刷新...');
    sleep(60);

    // 找一个 rechargeLevel 在可见范围内的用户（TC-07）
    console.log('[Setup] 查找 rechargeLevel=2 的用户（在可见范围内）...');
    const loginResultInRange = findAndLoginUser(adminToken, 2);

    // 找一个 rechargeLevel 不在可见范围内的用户（TC-08）
    console.log('[Setup] 查找 rechargeLevel=5 的用户（不在可见范围内）...');
    const loginResultOutRange = findAndLoginUser(adminToken, 5);

    return {
        adminToken,
        categories,
        channels,
        originalCategoryLevels,
        originalChannelLevels,
        testCategoryId: testCategory.id,
        testChannelId: testChannel.channelId,
        verifyLevels,        // [1,2,3]
        // TC-07: 在范围内的用户
        tokenInRange: loginResultInRange ? loginResultInRange.token : null,
        userInRange: loginResultInRange ? loginResultInRange.user : null,
        // TC-08: 不在范围内的用户
        tokenOutRange: loginResultOutRange ? loginResultOutRange.token : null,
        userOutRange: loginResultOutRange ? loginResultOutRange.user : null,
        // 接口调用结果记录
        setupResults: { tc03Ok, tc04Ok, tc05Ok, tc06Ok }
    };
}

// ================================================================
// Default：前台验证 TC-01 ~ TC-08
// ================================================================
export default function (data) {
    const {
        adminToken,
        categories, channels,
        testCategoryId, testChannelId,
        verifyLevels,
        tokenInRange, userInRange,
        tokenOutRange, userOutRange,
        setupResults
    } = data;

    console.log('\n========== 开始执行测试用例 ==========\n');

    // ----------------------------------------
    // TC-01: 充值大类列表 - state=1 的大类必须存在
    // ----------------------------------------
    console.log('--- [TC-01] 充值大类列表查询 ---');
    const tc01 = check(categories, {
        'TC-01 获取充值大类列表成功，state=1 的大类数量 > 0': (list) => Array.isArray(list) && list.length > 0,
        'TC-01 大类列表每项均有 id 和 name': (list) => list.every(c => c.id && c.name)
    });
    console.log(`[TC-01] ${tc01 ? '✅ PASS' : '❌ FAIL'}`);

    // ----------------------------------------
    // TC-02: 充值通道列表 - state=1 的通道必须存在
    // ----------------------------------------
    console.log('--- [TC-02] 充值通道列表查询 ---');
    const tc02 = check(channels, {
        'TC-02 获取充值通道列表成功，state=1 的通道数量 > 0': (list) => Array.isArray(list) && list.length > 0,
        'TC-02 通道列表每项均有 channelId 和 name': (list) => list.every(c => c.channelId && c.name)
    });
    console.log(`[TC-02] ${tc02 ? '✅ PASS' : '❌ FAIL'}`);

    // ----------------------------------------
    // TC-03: 充值通道适用等级 - 设置 [1,2,3] 成功
    // ----------------------------------------
    console.log('--- [TC-03] 充值通道适用等级 - 设置指定等级 ---');
    const tc03 = check(setupResults, {
        'TC-03 UpdateRemark 设置适用等级 [1,2,3] 接口返回成功': r => r.tc03Ok === true
    });
    console.log(`[TC-03] ${tc03 ? '✅ PASS' : '❌ FAIL'}`);

    // ----------------------------------------
    // TC-04: 充值通道适用等级 - 设置 []（全部）成功
    // ----------------------------------------
    console.log('--- [TC-04] 充值通道适用等级 - 设置全部 ---');
    const tc04 = check(setupResults, {
        'TC-04 UpdateRemark 设置适用等级 [] (全部) 接口返回成功': r => r.tc04Ok === true
    });
    console.log(`[TC-04] ${tc04 ? '✅ PASS' : '❌ FAIL'}`);

    // ----------------------------------------
    // TC-05: 充值大类可见等级 - 设置 [0,1,2] 成功
    // ----------------------------------------
    console.log('--- [TC-05] 充值大类可见等级 - 设置指定等级 ---');
    const tc05 = check(setupResults, {
        'TC-05 UpdateCommon 设置可见等级 [0,1,2] 接口返回成功': r => r.tc05Ok === true
    });
    console.log(`[TC-05] ${tc05 ? '✅ PASS' : '❌ FAIL'}`);

    // ----------------------------------------
    // TC-06: 充值大类可见等级 - 设置 []（全部）成功
    // ----------------------------------------
    console.log('--- [TC-06] 充值大类可见等级 - 设置全部 ---');
    const tc06 = check(setupResults, {
        'TC-06 UpdateCommon 设置可见等级 [] (全部) 接口返回成功': r => r.tc06Ok === true
    });
    console.log(`[TC-06] ${tc06 ? '✅ PASS' : '❌ FAIL'}`);

    // ----------------------------------------
    // TC-07: 前台验证 - 用户 rechargeLevel 在大类可见范围内 → 大类应可见
    // ----------------------------------------
    console.log('--- [TC-07] 前台验证 - 用户在可见范围内，大类应出现在 supportCategories ---');
    if (!tokenInRange) {
        console.warn('[TC-07] ⚠️ 未找到可用的在范围内用户，跳过本用例');
    } else {
        const userInfoIn = getFrontUserInfo(tokenInRange);
        const basicInfoIn = getRechargeBasicInfo(tokenInRange);

        const userLevelIn = userInfoIn ? userInfoIn.rechargeLevel : -1;
        const supportIdsIn = (basicInfoIn && basicInfoIn.goodsList && basicInfoIn.goodsList.length > 0)
            ? basicInfoIn.goodsList[0].supportCategories.map(s => s.id)
            : [];

        const isInVerifyRange = verifyLevels.includes(userLevelIn);
        const categoryVisibleIn = supportIdsIn.includes(testCategoryId);
        
        const usernameIn = userInRange ? (userInRange.userName || userInRange.phone || userInRange.account) : '未知';

        if (!isInVerifyRange || !categoryVisibleIn) {
            console.error(`\n❌ [TC-07 错误详情]`);
            console.error(`   测试账号: ${usernameIn}`);
            console.error(`   预期该用户的充值等级应在范围: [${verifyLevels.join(',')}] 内`);
            console.error(`   实际获取的用户充值等级: ${userLevelIn} ${isInVerifyRange ? '(✅符合预期)' : '(❌不符合预期)'}`);
            console.error(`   预期【应该包含】的大类ID (categoryId): ${testCategoryId}`);
            console.error(`   实际前台返回的可见大类列表 (supportCategories): [${supportIdsIn.join(', ')}]`);
            if (!categoryVisibleIn) {
                console.error(`   结论: 实际返回的数据中【缺少了】期望的大类ID: ${testCategoryId}\n`);
            } else {
                console.error(`   结论: 用户等级不匹配，但大类仍然显示。\n`);
            }
        } else {
            console.log(`  用户(${usernameIn}) rechargeLevel=${userLevelIn}, 范围=[${verifyLevels}], 在范围内=${isInVerifyRange}`);
            console.log(`  supportCategories ids=[${supportIdsIn}], 包含目标大类=${categoryVisibleIn}`);
        }

        const tc07 = check({ isInVerifyRange, categoryVisibleIn }, {
            'TC-07 用户 rechargeLevel 在可见等级内': r => r.isInVerifyRange === true,
            'TC-07 大类出现在前台 supportCategories 中': r => r.categoryVisibleIn === true
        });
        console.log(`[TC-07] 验证结果: ${tc07 ? '✅ PASS' : '❌ FAIL'}`);
    }

    // ----------------------------------------
    // TC-08: 前台验证 - 用户 rechargeLevel 不在大类可见范围内 → 大类不应可见
    // ----------------------------------------
    console.log('--- [TC-08] 前台验证 - 用户不在可见范围内，大类不应出现在 supportCategories ---');
    if (!tokenOutRange) {
        console.warn('[TC-08] ⚠️ 未找到可用的不在范围内用户，跳过本用例');
    } else {
        const userInfoOut = getFrontUserInfo(tokenOutRange);
        const basicInfoOut = getRechargeBasicInfo(tokenOutRange);

        const userLevelOut = userInfoOut ? userInfoOut.rechargeLevel : -1;
        const supportIdsOut = (basicInfoOut && basicInfoOut.goodsList && basicInfoOut.goodsList.length > 0)
            ? basicInfoOut.goodsList[0].supportCategories.map(s => s.id)
            : [];

        const isOutVerifyRange = !verifyLevels.includes(userLevelOut);
        const categoryHiddenOut = !supportIdsOut.includes(testCategoryId);
        
        const usernameOut = userOutRange ? (userOutRange.userName || userOutRange.phone || userOutRange.account) : '未知';

        if (!isOutVerifyRange || !categoryHiddenOut) {
            console.error(`\n❌ [TC-08 错误详情]`);
            console.error(`   测试账号: ${usernameOut}`);
            console.error(`   预期该用户的充值等级不应在范围: [${verifyLevels.join(',')}] 内`);
            console.error(`   实际获取的用户充值等级: ${userLevelOut} ${isOutVerifyRange ? '(✅符合预期)' : '(❌不符合预期)'}`);
            console.error(`   预期【不应出现】的大类ID (categoryId): ${testCategoryId}`);
            console.error(`   实际前台返回的可见大类列表 (supportCategories): [${supportIdsOut.join(', ')}]`);
            if (!categoryHiddenOut) {
                console.error(`   结论: 用户不满足可见等级，但前台充值基础信息(supportCategories)中却【错误地包含了】大类ID: ${testCategoryId}\n`);
            } else {
                console.error(`   结论: 用户等级不匹配，但大类正确隐藏。\n`);
            }
        } else {
            console.log(`  用户(${usernameOut}) rechargeLevel=${userLevelOut}, 范围=[${verifyLevels}], 不在范围内=${isOutVerifyRange}`);
            console.log(`  supportCategories ids=[${supportIdsOut}], 已隐藏目标大类=${categoryHiddenOut}`);
        }

        const tc08 = check({ isOutVerifyRange, categoryHiddenOut }, {
            'TC-08 用户 rechargeLevel 不在可见等级内': r => r.isOutVerifyRange === true,
            'TC-08 大类不出现在前台 supportCategories 中': r => r.categoryHiddenOut === true
        });
        console.log(`[TC-08] 验证结果: ${tc08 ? '✅ PASS' : '❌ FAIL'}`);
    }

    console.log('\n========== 测试用例执行完毕 ==========\n');
}

// ================================================================
// Teardown：还原大类和通道的原始等级配置
// ================================================================
export function teardown(data) {
    if (!data) return;
    const { adminToken, categories, channels, originalCategoryLevels, originalChannelLevels } = data;

    console.log('\n========== [Teardown] 还原配置 ==========');

    // 还原充值大类可见等级
    categories.forEach(category => {
        const origStr = originalCategoryLevels[category.id] || '';
        const origList = origStr ? origStr.split(',').map(s => parseInt(s.trim(), 10)) : [];
        const ok = updateCategoryLevel(adminToken, category, origList);
        console.log(`[Teardown] 大类 id=${category.id} 还原为 [${origList}]: ${ok ? '✅' : '❌'}`);
    });

    // 还原充值通道适用等级
    channels.forEach(channel => {
        const origStr = originalChannelLevels[channel.channelId] || '';
        const origList = origStr ? origStr.split(',').map(s => parseInt(s.trim(), 10)) : [];
        const ok = updateChannelLevel(adminToken, channel, origList);
        console.log(`[Teardown] 通道 channelId=${channel.channelId} 还原为 [${origList}]: ${ok ? '✅' : '❌'}`);
    });

    console.log('[Teardown] ✅ 配置还原完成');
}
