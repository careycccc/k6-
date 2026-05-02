/**
 * 多级邀请服务
 * 实现多层级用户邀请注册、充值和投注
 */

import { sleep } from 'k6';
import { phoneRegisterByInvite, emailRegisterByInvite } from '../login/register.test.js';
import { generateRandomPhones, generateRandomEmails } from '../../utils/accountGenerator.js';
import { betRun } from '../runbet/betRun.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { hybridRecharge, getConfigRechargeAmount } from '../recharge/rechargeService.js';
import { ENV_CONFIG, getEnvByTenantId } from '../../../config/envconfig.js';
import { updateUserAgentRebateMode } from './agentApi.js';

/**
 * 随机执行 1~3 次充值（首充 + 随机二充/三充）
 * 60% 概率1次，30% 概率2次，10% 概率3次
 * @param {object} userDetail  - UserDetail 实例（含 token, userId, userAccount）
 * @param {string} adminToken
 * @param {string} [tag]       - 日志前缀，默认 ProcessUsers
 * @returns {{ recharged: boolean, totalAmount: number }}
 */
function multiRecharge(userDetail, adminToken, tag = 'ProcessUsers') {
    const rand = Math.random();
    const rechargeCount = rand < 0.6 ? 1 : rand < 0.9 ? 2 : 3;
    console.log(`[${tag}] 本次充值次数: ${rechargeCount} 次`);

    let totalAmount = 0;
    let anySuccess = false;

    for (let i = 0; i < rechargeCount; i++) {
        if (i > 0) sleep(2);

        const rechargeAmount = getConfigRechargeAmount();
        const label = i === 0 ? '首充' : i === 1 ? '二充' : '三充';
        console.log(`[${tag}] ${label}: ${userDetail.userAccount}, 金额: ${rechargeAmount}`);

        const rechargeResult = hybridRecharge({
            userToken: userDetail.token,
            adminToken: adminToken,
            userId: userDetail.userId,
            amount: rechargeAmount,
            frontendFirst: true,
            remark: `Invite - ${label}`
        });

        if (rechargeResult.success) {
            anySuccess = true;
            totalAmount += rechargeResult.amount;
            console.log(`[${tag}] ✅ ${label}成功: ${userDetail.userAccount}, 金额: ${rechargeResult.amount}, 方式: ${rechargeResult.method}`);
        } else {
            console.error(`[${tag}] ❌ ${label}失败: ${userDetail.userAccount}, 原因: ${rechargeResult.message}`);
            break;
        }
    }

    return { recharged: anySuccess, totalAmount };
}

// ========== 数据结构定义 ==========

/**
 * 用户结构
 */
class User {
    constructor(inviteCode) {
        this.inviteCode = inviteCode;      // 用户的邀请码
        this.subordinates = [];            // 直接下级的邀请码列表
    }
}

/**
 * 用户详细信息
 */
class UserDetail {
    constructor(userAccount, token, accountType, userId = null, inviteCode = null, parentInviteCode = null) {
        this.userAccount = userAccount;    // 用户账号（手机号或邮箱）
        this.token = token;                // 用户登录token
        this.accountType = accountType;    // 账号类型：'phone' 或 'email'
        this.userId = userId;              // 用户ID（从前台接口获取）
        this.inviteCode = inviteCode;      // 用户邀请码（从前台接口获取）
        this.parentInviteCode = parentInviteCode; // 上级邀请码
        this.recharged = false;            // 是否已充值成功
        this.rechargeAmount = 0;           // 充值金额
        this.betSuccess = false;           // 是否投注成功
        this.betAmount = 0;                // 投注金额
        this.failedReason = "";            // 失败原因（如果有）
    }
}

// ========== 全局变量 ==========

let userDetails = [];                      // 所有用户详情列表
let userDB = new Map();                    // 用户数据库：inviteCode -> User
let currentTenantConfig = null;            // 当前租户配置

// ========== 核心功能函数 ==========

/**
 * 处理新用户的后续操作（充值和投注）
 * 使用混合充值策略：优先前台充值，失败则后台充值兜底
 * @param {object} adminData - 管理员登录数据
 * @param {number} rebateChance - 设置特殊/锁定返佣的几率
 * @returns {Promise<void>}
 */
export async function processNewUsers(adminData, rebateChance = 0.2) {
    if (userDetails.length === 0) {
        console.error('[ProcessUsers] 用户详情列表为空，无法处理');
        throw new Error('用户详情列表为空');
    }

    console.log(`[ProcessUsers] 开始处理 ${userDetails.length} 个用户的充值和投注`);

    let rechargeSuccessCount = 0;
    let betSuccessCount = 0;

    for (let i = 0; i < userDetails.length; i++) {
        const userDetail = userDetails[i];
        console.log(`\n[ProcessUsers] [${i + 1}/${userDetails.length}] 处理用户: ${userDetail.userAccount}`);

        try {
            // 步骤1 - 使用已保存的 userId（注册时已获取）
            const userId = userDetail.userId;
            if (!userId) {
                console.error(`[ProcessUsers] 用户ID为空: ${userDetail.userAccount}`);
                continue;
            }

            console.log(`[ProcessUsers] 用户ID: ${userId}, 邀请码: ${userDetail.inviteCode}`);
            
            // 步骤1.5 - 随机设置返佣模式 (特殊/锁定)
            if (Math.random() < rebateChance) {
                const rebateMode = Math.floor(Math.random() * 2) + 1;
                const rebateLevel = Math.floor(Math.random() * 6) + 1;
                updateUserAgentRebateMode(adminData.token, userId, rebateMode, rebateLevel);
                sleep(0.5);
            }
            
            sleep(2);

            // 步骤2 - 充值（随机 1~3 次）
            console.log(`[ProcessUsers] 开始充值: ${userDetail.userAccount}`);

            const { recharged, totalAmount } = multiRecharge(userDetail, adminData.token, 'ProcessUsers');

            if (recharged) {
                userDetail.recharged = true;
                userDetail.rechargeAmount = totalAmount;
                rechargeSuccessCount++;
                console.log(`[ProcessUsers] ✅ 充值完成: ${userDetail.userAccount}, 累计金额: ${totalAmount}`);
            } else {
                userDetail.recharged = false;
                userDetail.failedReason = "充值失败";
                console.error(`[ProcessUsers] ❌ 充值失败: ${userDetail.userAccount}`);
                continue; // 充值失败，跳过投注
            }

            sleep(2);

            // 步骤3 - 投注（只有充值成功的用户才能投注）
            if (!userDetail.recharged) {
                console.log(`[ProcessUsers] ⏭️  跳过投注（充值未成功）: ${userDetail.userAccount}`);
                continue;
            }

            console.log(`[ProcessUsers] 开始投注: ${userDetail.userAccount}`);
            const betResult = betRun(userDetail.token, userDetail.userAccount);

            if (betResult) {
                betSuccessCount++;
                userDetail.betSuccess = true;
                userDetail.betAmount = betResult.amount || 0;
                console.log(`[ProcessUsers] ✅ 投注成功: ${userDetail.userAccount}`);
            } else {
                userDetail.betSuccess = false;
                userDetail.failedReason = "投注失败";
                console.error(`[ProcessUsers] ❌ 投注失败: ${userDetail.userAccount}`);
            }

        } catch (error) {
            console.error(`[ProcessUsers] 处理用户异常: ${userDetail.userAccount}, 错误: ${error.message}`);
        }

        sleep(1);
    }

    console.log('\n========== 处理结果统计 ==========');
    console.log(`总用户数: ${userDetails.length}`);
    console.log(`充值成功: ${rechargeSuccessCount}`);
    console.log(`投注成功: ${betSuccessCount}`);
    console.log(`充值失败: ${userDetails.length - rechargeSuccessCount}`);
    console.log(`投注失败: ${rechargeSuccessCount - betSuccessCount}`);
    console.log('===================================\n');

    console.log('[ProcessUsers] 所有用户处理完成');
}

/**
 * 尝试注册用户（手机号优先，失败则尝试邮箱）
 * @param {string} account - 账号（手机号或邮箱）
 * @param {string} accountType - 账号类型：'phone' 或 'email'
 * @param {string} parentInviteCode - 父级邀请码
 * @param {object} adminData - 管理员登录数据
 * @returns {object|null} {token, inviteCode, userId, accountType, account} 或 null
 */
function tryRegister(account, accountType, parentInviteCode, adminData) {
    try {
        let response;

        // 从 envconfig 读取邀请注册专用地址（优先级最高）
        const tenantId = currentTenantConfig ? String(currentTenantConfig.tenantId) : null;
        const tenantEnv = tenantId ? getEnvByTenantId(tenantId) : null;
        const inviteRegisterUrl = tenantEnv && tenantEnv.INVITE_REGISTER_URL
            ? tenantEnv.INVITE_REGISTER_URL
            : null;

        console.log(`[Register] 邀请注册域名: ${inviteRegisterUrl || '未配置，将使用前台默认域名'}`);

        // 构建自定义URL配置对象
        // frontUrl: 发验证码的域名
        // registerUrl: 提交注册的域名
        // 邀请注册时两者都走 INVITE_REGISTER_URL
        const customUrls = {
            frontUrl: inviteRegisterUrl || (currentTenantConfig ? currentTenantConfig.frontUrl : null) || null,
            adminUrl: currentTenantConfig ? currentTenantConfig.adminUrl : null,
            registerUrl: inviteRegisterUrl || (currentTenantConfig ? currentTenantConfig.frontUrl : null) || null
        };

        console.log(`[Register] customUrls: frontUrl=${customUrls.frontUrl}, adminUrl=${customUrls.adminUrl}, registerUrl=${customUrls.registerUrl}`);

        // 获取当前环境的区号
        const countryCode = ENV_CONFIG.COUNTRY_CODE || '91';

        if (accountType === 'phone') {
            // 尝试手机号注册（传递区号）
            response = phoneRegisterByInvite(account, parentInviteCode, adminData, 'qwer1234', '', customUrls, countryCode);
        } else {
            // 尝试邮箱注册
            response = emailRegisterByInvite(account, parentInviteCode, adminData, 'qwer1234', '', customUrls);
        }

        if (!response || !response.data) {
            console.error(`[Register] ${accountType}注册失败: ${account}`);
            return null;
        }

        // 提取token
        const token = response.headers ? response.headers['Authorization'] || response.headers['authorization'] : null;

        if (!token) {
            console.error(`[Register] 注册响应缺少token: ${account}`);
            return null;
        }

        const cleanToken = token.replace(/^Bearer\s+/i, '');

        // ✅ 先检查注册响应中是否已包含 userId 和 inviteCode
        if (response.data.userId && response.data.inviteCode) {
            console.log(`[Register] 从注册响应获取用户信息: userId=${response.data.userId}, inviteCode=${response.data.inviteCode}`);
            return {
                token: cleanToken,
                inviteCode: response.data.inviteCode,
                userId: response.data.userId,
                accountType: accountType,
                account: account
            };
        }

        // 如果注册响应中没有，再调用前台接口获取用户信息
        console.log(`[Register] 注册响应中无用户信息，调用 GetUserInfo 获取...`);
        sleep(1);
        const userInfo = getFrontUserInfo(cleanToken);

        if (!userInfo || !userInfo.userId || !userInfo.inviteCode) {
            console.error(`[Register] 获取用户信息失败: ${account}`);
            return null;
        }

        console.log(`[Register] 获取用户信息成功: userId=${userInfo.userId}, inviteCode=${userInfo.inviteCode}`);

        return {
            token: cleanToken,
            inviteCode: userInfo.inviteCode,
            userId: userInfo.userId,
            accountType: accountType,
            account: account
        };

    } catch (error) {
        console.error(`[Register] ${accountType}注册异常: ${account}, 错误: ${error.message}`);
        return null;
    }
}

/**
 * 注册单个用户（手机号优先，失败则尝试邮箱）
 * @param {string} phoneNumber - 手机号
 * @param {string} email - 邮箱（备用）
 * @param {string} parentInviteCode - 父级邀请码
 * @param {object} adminData - 管理员登录数据
 * @returns {object|null} {token, inviteCode, userId, accountType, account} 或 null
 */
function registerUser(phoneNumber, email, parentInviteCode, adminData) {
    // 优先尝试手机号注册
    console.log(`[Register] 尝试手机号注册: ${phoneNumber} -> ${parentInviteCode}`);
    let result = tryRegister(phoneNumber, 'phone', parentInviteCode, adminData);

    if (result) {
        console.log(`[Register] ✅ 手机号注册成功: ${phoneNumber}, userId: ${result.userId}, 邀请码: ${result.inviteCode}`);
        return result;
    }

    // 手机号失败，尝试邮箱注册
    console.log(`[Register] 手机号注册失败，尝试邮箱注册: ${email} -> ${parentInviteCode}`);
    result = tryRegister(email, 'email', parentInviteCode, adminData);

    if (result) {
        console.log(`[Register] ✅ 邮箱注册成功: ${email}, userId: ${result.userId}, 邀请码: ${result.inviteCode}`);
        return result;
    }

    // 两种方式都失败
    console.error(`[Register] ❌ 注册失败（手机号和邮箱都失败）: ${phoneNumber} / ${email}`);
    return null;
}

/**
 * 绑定一层用户
 * @param {string[]} parentInviteCodes - 父级邀请码列表
 * @param {number} count - 要生成的下级数量
 * @param {number} level - 当前层级（从0开始）
 * @param {object} adminData - 管理员登录数据
 * @returns {string[]} 新用户的邀请码列表
 */
export function bindOneLevel(parentInviteCodes, count, level, adminData) {
    if (!parentInviteCodes || parentInviteCodes.length === 0) {
        throw new Error('父级邀请码列表不能为空');
    }

    console.log(`\n🔗 [层级${level + 1}] 父级${parentInviteCodes.length}人 -> 生成${count}个下级...`);

    // 步骤1: 生成账号（使用当前环境的区号）
    // 注意：k6的VU环境是独立的，直接读 ENV_CONFIG 可能读到默认值，优先从 adminData 提取动态配置
    let countryCode = '91';
    if (adminData && adminData.envConfig && adminData.envConfig.COUNTRY_CODE) {
        countryCode = adminData.envConfig.COUNTRY_CODE;
    } else if (typeof __ENV !== 'undefined' && __ENV.TENANT_ID) {
        countryCode = getEnvByTenantId(__ENV.TENANT_ID).COUNTRY_CODE || '91';
    } else if (ENV_CONFIG && ENV_CONFIG.COUNTRY_CODE) {
        countryCode = ENV_CONFIG.COUNTRY_CODE;
    }
    
    console.log(`📱 使用区号: ${countryCode}`);
    const phoneNumbers = generateRandomPhones(count, countryCode);
    const emails = generateRandomEmails(count);

    console.log(`📱 生成账号: ${phoneNumbers.slice(0, Math.min(2, phoneNumbers.length))}...`);

    // 步骤2: 注册所有用户
    const newInviteCodes = [];
    const errors = [];

    for (let i = 0; i < count; i++) {
        sleep(1); // 避免请求过快

        // 随机选择一个父级邀请码
        const parentInviteCode = parentInviteCodes[Math.floor(Math.random() * parentInviteCodes.length)];

        // ====== 新增混合模式逻辑 ======
        let inviteIdentifier = parentInviteCode;
        let parentUserId = null;
        let useUserId = false;
        
        // 尝试从已注册的详情中找到这个父级的 userId
        const parentDetail = userDetails.find(u => u.inviteCode === parentInviteCode);
        if (parentDetail && parentDetail.userId) {
            parentUserId = parentDetail.userId;
            // 50%概率使用 userId
            useUserId = Math.random() < 0.5;
        }

        if (useUserId) {
            inviteIdentifier = String(parentUserId);
            console.log(`[BindLevel] 🔀 混合邀请: 使用上级 userId (${parentUserId}) 代替 inviteCode`);
        } else {
            console.log(`[BindLevel] 🔀 混合邀请: 使用上级 inviteCode (${parentInviteCode})`);
        }

        // 注册用户（手机号优先，失败则邮箱），传入的是选定的 inviteIdentifier
        const registerResult = registerUser(phoneNumbers[i], emails[i], inviteIdentifier, adminData);

        if (!registerResult) {
            const errorMsg = `注册失败: ${phoneNumbers[i]} / ${emails[i]} -> ${inviteIdentifier} (原码: ${parentInviteCode})`;
            console.error(`[BindLevel] ${errorMsg}`);
            errors.push(errorMsg);
            // 两种方式都失败，立即停止
            throw new Error(`注册失败，停止邀请流程: ${errorMsg}`);
        }

        sleep(2);

        // 保存用户详情（包含 userId 和 inviteCode）
        const userDetail = new UserDetail(
            registerResult.account,
            registerResult.token,
            registerResult.accountType,
            registerResult.userId,
            registerResult.inviteCode,
            parentInviteCode
        );
        userDetails.push(userDetail);

        // 保存邀请码
        newInviteCodes.push(registerResult.inviteCode);

        // 更新数据库
        if (!userDB.has(registerResult.inviteCode)) {
            userDB.set(registerResult.inviteCode, new User(registerResult.inviteCode));
        }

        const invStr = useUserId ? `userId:${parentUserId}` : `code:${parentInviteCode}`;
        console.log(`✅ [${i + 1}/${count}] ${registerResult.account} -> ${invStr} (新邀请码: ${registerResult.inviteCode})`);
    }

    // 检查是否有错误
    if (errors.length > 0) {
        throw new Error(`绑定层级失败，错误数: ${errors.length}`);
    }

    // 检查数量
    if (newInviteCodes.length !== count) {
        throw new Error(`绑定数量不匹配: 期望${count}, 实际${newInviteCodes.length}`);
    }

    // 更新父级的下级列表
    for (const parentCode of parentInviteCodes) {
        if (!userDB.has(parentCode)) {
            userDB.set(parentCode, new User(parentCode));
        }
    }

    console.log(`🎯 [层级${level + 1}] 完成: ${newInviteCodes.length}人 -> ${newInviteCodes.slice(0, Math.min(2, newInviteCodes.length))}...`);

    return newInviteCodes;
}

/**
 * 执行多层级邀请绑定
 * @param {string} rootInviteCode - 总代邀请码
 * @param {number[]} subordinates - 每层的人数，例如 [2, 3, 5] 表示第1层2人，第2层3人，第3层5人
 * @param {object} adminData - 管理员登录数据
 * @param {object} tenantConfig - 租户配置（可选）
 * @param {boolean} withRecharge - 是否进行充值投注，默认true
 * @param {number} rebateChance - 设置特殊/锁定返佣的几率
 * @returns {Promise<void>}
 */
export async function runMultiLevelInvite(rootInviteCode, subordinates, adminData, tenantConfig = null, withRecharge = true, rebateChance = 0.2) {
    if (!subordinates || subordinates.length === 0) {
        throw new Error('层级人数列表不能为空');
    }

    console.log(`🎯 开始多层级邀请绑定到总代: ${rootInviteCode}, 层级: ${subordinates}`);
    console.log(`💰 充值投注: ${withRecharge ? '是' : '否'}`);

    // 保存租户配置到全局变量
    currentTenantConfig = tenantConfig;

    if (tenantConfig) {
        if (tenantConfig.frontUrl) {
            console.log(`🔧 使用租户前台域名: ${tenantConfig.frontUrl}`);
        }
        if (tenantConfig.adminUrl) {
            console.log(`🔧 使用租户后台域名: ${tenantConfig.adminUrl}`);
        }
        if (tenantConfig.registerApiUrl) {
            console.log(`🔧 使用租户注册域名: ${tenantConfig.registerApiUrl}`);
        }
    }

    // 重置全局变量
    userDetails = [];
    userDB = new Map();

    const layers = [];

    // 第1层：绑定到总代
    console.log(`\n🚀 === 开始第1层绑定到总代 [${rootInviteCode}] (${subordinates[0]}人) ===`);
    const firstLayer = bindOneLevel([rootInviteCode], subordinates[0], 0, adminData);
    layers.push(firstLayer);
    console.log(`✅ 第1层完成: ${firstLayer.length}人 -> ${firstLayer.slice(0, Math.min(2, firstLayer.length))}`);

    // 后续层级
    let currentParentCodes = firstLayer;
    for (let level = 1; level < subordinates.length; level++) {
        const count = subordinates[level];
        console.log(`\n🚀 === 开始第${level + 1}层绑定 (${count}人) ===`);

        const newLayer = bindOneLevel(currentParentCodes, count, level, adminData);
        layers.push(newLayer);
        currentParentCodes = newLayer;

        console.log(`✅ 第${level + 1}层完成: ${newLayer.length}人 -> ${newLayer.slice(0, Math.min(2, newLayer.length))}`);
    }

    // 处理所有新用户（充值和投注）- 根据参数决定是否执行
    if (withRecharge) {
        console.log('\n🚀 === 开始处理所有用户的充值和投注 ===');
        await processNewUsers(adminData, rebateChance);
    } else {
        console.log('\n⏭️  跳过充值和投注步骤');
    }

    console.log('\n🎉 多层级邀请绑定完成！');

    // ========== 生成最终测试报表 ==========
    console.log('\n========== 最终测试报表 ==========');
    
    // 构建映射: inviteCode -> userAccount
    const codeToAccountMap = new Map();
    codeToAccountMap.set(rootInviteCode, "总代(Root)");
    for (const ud of userDetails) {
        codeToAccountMap.set(ud.inviteCode, ud.userAccount);
    }

    // 计算每个用户的下级数量
    const childrenCountMap = new Map();
    for (const ud of userDetails) {
        if (ud.parentInviteCode) {
            const current = childrenCountMap.get(ud.parentInviteCode) || 0;
            childrenCountMap.set(ud.parentInviteCode, current + 1);
        }
    }

    // 辅助函数：计算字符串打印宽度 (中文字符算2个宽度)
    const getDisplayWidth = (str) => {
        let width = 0;
        const stringVal = String(str);
        for (let i = 0; i < stringVal.length; i++) {
            width += stringVal.charCodeAt(i) > 255 ? 2 : 1;
        }
        return width;
    };

    // 辅助函数：按显示宽度填充空格对齐
    const padString = (str, targetWidth) => {
        const stringVal = String(str);
        const width = getDisplayWidth(stringVal);
        return width >= targetWidth ? stringVal : stringVal + ' '.repeat(targetWidth - width);
    };

    // 定义表头
    const headers = ['上级账号', '下级账号', '是否邀请成功', '充值金额', '投注金额', '失败原因备注', '当前会员下级数'];
    
    // 收集所有行数据
    const rows = [];
    for (const ud of userDetails) {
        const parentAccount = codeToAccountMap.get(ud.parentInviteCode) || ud.parentInviteCode;
        const childAccount = ud.userAccount;
        const inviteSuccess = (ud.recharged && ud.betSuccess) ? "是" : "否";
        const rechargeAmt = ud.rechargeAmount || "-";
        const betAmt = ud.betAmount || "-";
        const failedReason = ud.failedReason || "-";
        const childCount = childrenCountMap.get(ud.inviteCode) || 0;

        rows.push([parentAccount, childAccount, inviteSuccess, rechargeAmt, betAmt, failedReason, childCount]);
    }

    // 计算各列最大宽度
    const colWidths = headers.map(h => getDisplayWidth(h));
    for (const row of rows) {
        for (let i = 0; i < row.length; i++) {
            const w = getDisplayWidth(row[i]);
            if (w > colWidths[i]) colWidths[i] = w;
        }
    }

    // 为了美观，列宽最小追加2个空格宽裕度
    for (let i = 0; i < colWidths.length; i++) {
        colWidths[i] += 2;
    }

    // 拼装表格
    let reportTable = "";
    
    // 渲染表头
    let headerStr = "|";
    for (let i = 0; i < headers.length; i++) {
        headerStr += ` ${padString(headers[i], colWidths[i])}|`;
    }
    reportTable += headerStr + "\n";

    // 渲染分隔线
    let separatorStr = "|";
    for (let i = 0; i < headers.length; i++) {
        separatorStr += `${'-'.repeat(colWidths[i] + 2)}|`;
    }
    reportTable += separatorStr + "\n";

    // 渲染数据行
    for (const row of rows) {
        let rowStr = "|";
        for (let i = 0; i < row.length; i++) {
            rowStr += ` ${padString(row[i], colWidths[i])}|`;
        }
        reportTable += rowStr + "\n";
    }

    // 将报表输出为单条日志以避免格式错乱
    console.log(reportTable);
    console.log('===================================\n');
}

/**
 * 清理全局数据
 */
export function clearInviteData() {
    userDetails = [];
    userDB = new Map();
    currentTenantConfig = null;
    console.log('[Invite] 全局数据已清理');
}

// ============================================================
// V2：三段式行为分层（不改动上方任何现有逻辑）
// ============================================================

/**
 * 处理所有新注册用户的充值和投注 V2（三段式行为分层）
 *
 * 将用户按概率分为三组：
 *   - 不活跃（inactiveRate）：不充值，不投注
 *   - 半活跃（rechargeOnlyRate）：只充值，不投注
 *   - 活跃（剩余）：充值 + 投注（与现有 processNewUsers 行为一致）
 *
 * @param {object} adminData
 * @param {object} [rates]
 * @param {number} [rates.inactiveRate=0.2]      - 不活跃比例
 * @param {number} [rates.rechargeOnlyRate=0.2]  - 半活跃比例
 *
 * @example
 * // 默认分层
 * await processNewUsersV2(adminData);
 *
 * // 自定义分层
 * await processNewUsersV2(adminData, { inactiveRate: 0.3, rechargeOnlyRate: 0.1 });
 */
export async function processNewUsersV2(adminData, rates = {}) {
    const {
        inactiveRate     = 0.2,
        rechargeOnlyRate = 0.2,
        rebateChance     = 0.2
    } = rates;

    const activeRate = Math.max(0, 1 - inactiveRate - rechargeOnlyRate);

    if (userDetails.length === 0) {
        console.error('[ProcessUsersV2] 用户详情列表为空，无法处理');
        throw new Error('用户详情列表为空');
    }

    console.log(`\n[ProcessUsersV2] 开始处理 ${userDetails.length} 个用户（三段式分层）`);
    console.log(`  不活跃: ${(inactiveRate * 100).toFixed(0)}%  → 不充值，不投注`);
    console.log(`  半活跃: ${(rechargeOnlyRate * 100).toFixed(0)}%  → 只充值，不投注`);
    console.log(`  活跃  : ${(activeRate * 100).toFixed(0)}%  → 充值 + 投注\n`);

    // 按概率给每个用户分配行为标签
    const INACTIVE      = 'inactive';
    const RECHARGE_ONLY = 'rechargeOnly';
    const ACTIVE        = 'active';

    const behaviorMap = new Map(); // userAccount -> behavior
    const groupCount  = { inactive: 0, rechargeOnly: 0, active: 0 };

    for (const ud of userDetails) {
        const rand = Math.random();
        let behavior;
        if (rand < inactiveRate) {
            behavior = INACTIVE;
        } else if (rand < inactiveRate + rechargeOnlyRate) {
            behavior = RECHARGE_ONLY;
        } else {
            behavior = ACTIVE;
        }
        behaviorMap.set(ud.userAccount, behavior);
        groupCount[behavior]++;
    }

    console.log(`[ProcessUsersV2] 分组结果: 不活跃=${groupCount.inactive}, 半活跃=${groupCount.rechargeOnly}, 活跃=${groupCount.active}\n`);

    let rechargeSuccessCount = 0;
    let betSuccessCount      = 0;

    for (let i = 0; i < userDetails.length; i++) {
        const userDetail = userDetails[i];
        const behavior   = behaviorMap.get(userDetail.userAccount);

        console.log(`\n[ProcessUsersV2] [${i + 1}/${userDetails.length}] 用户: ${userDetail.userAccount} | 分组: ${behavior}`);

        // 不活跃：直接跳过
        if (behavior === INACTIVE) {
            console.log(`[ProcessUsersV2] ⏭️  跳过（不活跃）: ${userDetail.userAccount}`);
            sleep(0.5);
            continue;
        }

        try {
            const userId = userDetail.userId;
            if (!userId) {
                console.error(`[ProcessUsersV2] 用户ID为空: ${userDetail.userAccount}`);
                continue;
            }

            sleep(2);

            // 充值（半活跃和活跃都充值，随机 1~3 次）
            const { recharged: rechargeOk, totalAmount } = multiRecharge(userDetail, adminData.token, 'ProcessUsersV2');

            if (rechargeOk) {
                userDetail.recharged      = true;
                userDetail.rechargeAmount = totalAmount;
                rechargeSuccessCount++;
                console.log(`[ProcessUsersV2] ✅ 充值完成: ${userDetail.userAccount}, 累计金额: ${totalAmount}`);
                
                // 步骤1.5 - 随机设置返佣模式 (特殊/锁定)
                if (Math.random() < rebateChance) {
                    const rebateMode = Math.floor(Math.random() * 2) + 1;
                    const rebateLevel = Math.floor(Math.random() * 6) + 1;
                    updateUserAgentRebateMode(adminData.token, userId, rebateMode, rebateLevel);
                    sleep(0.5);
                }
            } else {
                userDetail.recharged    = false;
                userDetail.failedReason = '充值失败';
                console.error(`[ProcessUsersV2] ❌ 充值失败: ${userDetail.userAccount}`);
                continue;
            }

            // 半活跃：充值后跳过投注
            if (behavior === RECHARGE_ONLY) {
                console.log(`[ProcessUsersV2] ⏭️  跳过投注（半活跃）: ${userDetail.userAccount}`);
                sleep(1);
                continue;
            }

            sleep(2);

            // 活跃：投注
            console.log(`[ProcessUsersV2] 开始投注: ${userDetail.userAccount}`);
            const betResult = betRun(userDetail.token, userDetail.userAccount);

            if (betResult) {
                betSuccessCount++;
                userDetail.betSuccess = true;
                userDetail.betAmount  = betResult.amount || 0;
                console.log(`[ProcessUsersV2] ✅ 投注成功: ${userDetail.userAccount}`);
            } else {
                userDetail.betSuccess   = false;
                userDetail.failedReason = '投注失败';
                console.error(`[ProcessUsersV2] ❌ 投注失败: ${userDetail.userAccount}`);
            }

        } catch (error) {
            console.error(`[ProcessUsersV2] 处理异常: ${userDetail.userAccount}, 错误: ${error.message}`);
        }

        sleep(1);
    }

    console.log('\n========== [V2] 处理结果统计 ==========');
    console.log(`总用户数  : ${userDetails.length}`);
    console.log(`不活跃    : ${groupCount.inactive}`);
    console.log(`半活跃    : ${groupCount.rechargeOnly}`);
    console.log(`活跃      : ${groupCount.active}`);
    console.log(`充值成功  : ${rechargeSuccessCount}`);
    console.log(`投注成功  : ${betSuccessCount}`);
    console.log('========================================\n');
}

/**
 * 执行多层级邀请绑定 V2（三段式行为分层版）
 *
 * 与 runMultiLevelInvite 完全相同的注册流程，
 * 仅将充值投注阶段替换为 processNewUsersV2。
 *
 * @param {string}   rootInviteCode
 * @param {number[]} subordinates
 * @param {object}   adminData
 * @param {object}   [tenantConfig]
 * @param {object}   [rates]
 * @param {number}   [rates.inactiveRate=0.2]
 * @param {number}   [rates.rechargeOnlyRate=0.2]
 *
 * @example
 * // 默认分层
 * await runMultiLevelInviteV2('ABC123', [3, 5, 10], adminData);
 *
 * // 自定义分层
 * await runMultiLevelInviteV2('ABC123', [3, 5], adminData, null, { inactiveRate: 0.3, rechargeOnlyRate: 0.1 });
 */
export async function runMultiLevelInviteV2(rootInviteCode, subordinates, adminData, tenantConfig = null, rates = {}) {
    if (!subordinates || subordinates.length === 0) {
        throw new Error('层级人数列表不能为空');
    }

    const { inactiveRate = 0.2, rechargeOnlyRate = 0.2, rebateChance = 0.2 } = rates;
    const activeRate = Math.max(0, 1 - inactiveRate - rechargeOnlyRate);

    console.log(`🎯 [V2] 开始多层级邀请绑定到总代: ${rootInviteCode}, 层级: ${subordinates}`);
    console.log(`  不活跃: ${(inactiveRate * 100).toFixed(0)}% | 半活跃: ${(rechargeOnlyRate * 100).toFixed(0)}% | 活跃: ${(activeRate * 100).toFixed(0)}%`);

    // 复用现有的注册流程（重置全局状态）
    currentTenantConfig = tenantConfig;
    userDetails = [];
    userDB      = new Map();

    const layers = [];

    console.log(`\n🚀 === 开始第1层绑定到总代 [${rootInviteCode}] (${subordinates[0]}人) ===`);
    const firstLayer = bindOneLevel([rootInviteCode], subordinates[0], 0, adminData);
    layers.push(firstLayer);

    let currentParentCodes = firstLayer;
    for (let level = 1; level < subordinates.length; level++) {
        const count = subordinates[level];
        console.log(`\n🚀 === 开始第${level + 1}层绑定 (${count}人) ===`);
        const newLayer = bindOneLevel(currentParentCodes, count, level, adminData);
        layers.push(newLayer);
        currentParentCodes = newLayer;
    }

    // 使用 V2 充值投注
    console.log('\n🚀 === [V2] 开始三段式充值和投注 ===');
    await processNewUsersV2(adminData, { inactiveRate, rechargeOnlyRate, rebateChance });

    console.log('\n🎉 [V2] 多层级邀请绑定完成！');
}
