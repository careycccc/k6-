/**
 * 批量提现测试脚本 (动态获取用户版本)
 *
 * 提现次数与概率可手动传入（WITHDRAW_COUNT_DIST）：
 *   格式 "次数:权重,次数:权重,..."，权重会自动归一化为概率；次数可为 0 表示"不提现"。
 *   例：-e WITHDRAW_COUNT_DIST="1:50,2:30,3:20"  → 1次50% / 2次30% / 3次20%
 *       -e WITHDRAW_COUNT_DIST="0:20,1:80"       → 20% 不提现 / 80% 提现1次
 *   不传时默认 "1:50,2:17,3:33"（沿用原脚本行为）。
 *
 * 运行方式：
 * k6 run -e TENANT_ID=3004 -e FETCH_COUNT=10 batchWithdraw.test.js
 * k6 run -e TENANT_ID=3101 -e FETCH_COUNT=15 -e WITHDRAW_COUNT_DIST="1:100,2:80,3:50,4:50" batchWithdraw.test.js
 *
 * 参数说明：
 * FETCH_COUNT:          要凑够多少个余额达标的用户来提现，默认10（不够会分页继续找）
 * MIN_BALANCE:          用户余额下限，仅 balance > 此值的用户才参与，默认2000（余额太少无法提现）
 * PAGE_SIZE:            每页拉取用户数(分页扫描凑够 FETCH_COUNT 个达标用户)，默认 max(FETCH_COUNT*5, 100)
 * MAX_PAGES:            翻页安全上限，默认100
 * SKIP_RECHARGE:        true=不充值直接用已有余额提现；默认false(先充值top-up)
 * WITHDRAW_COUNT_DIST:  提现次数分布(次数:权重)，默认 "1:50,2:17,3:33"
 */

import { sleep } from 'k6';
import { tenantAdminLogin, tenantRequest } from '../../../libs/http/tenantRequest.js';
import { batchGetUserAccounts, autoLoginByAccount } from '../user/userAccountApi.js';
import { backendRecharge } from '../recharge/rechargeService.js';
import { getAccountBalance } from '../balance/balance.test.js';
import { addAllWallets } from './addWalletApi.js';
import { sendRequest } from '../common/request.js';
import {
    getWithdrawBasicInfo,
    setWithdrawPassword,
    getUserWithdrawWallet,
    withdrawApply
} from './withdrawApi.js';

// 获取环境变量
const FETCH_COUNT = __ENV.FETCH_COUNT ? parseInt(__ENV.FETCH_COUNT) : 10;
const tenantId = __ENV.TENANT_ID || '3004';

// 只挑选余额 > MIN_BALANCE 的用户（余额太少无法提现）：分页扫描、跳过不达标的，凑够 FETCH_COUNT 个为止
const MIN_BALANCE = __ENV.MIN_BALANCE ? parseFloat(__ENV.MIN_BALANCE) : 2000;
const PAGE_SIZE = __ENV.PAGE_SIZE ? parseInt(__ENV.PAGE_SIZE) : Math.max(FETCH_COUNT * 5, 100); // 每页拉取数量
const MAX_PAGES = __ENV.MAX_PAGES ? parseInt(__ENV.MAX_PAGES) : 100; // 翻页安全上限
// 是否跳过充值：true=不充值，纯用已有余额提现（配合 MIN_BALANCE 过滤后已保证余额充足）
const SKIP_RECHARGE = __ENV.SKIP_RECHARGE === 'true';

// 提现次数分布：WITHDRAW_COUNT_DIST="次数:权重,..."（权重自动归一化为概率；次数可为0=不提现）
// 默认 "1:50,2:17,3:33" 沿用原脚本行为（1次50% / 2次17% / 3次33%）
const WITHDRAW_COUNT_DIST_RAW = __ENV.WITHDRAW_COUNT_DIST || '1:50,2:17,3:33';

/**
 * 解析 "次数:权重,..." → 累积概率分布 [{count, prob, cum}]
 */
function parseWithdrawDist(raw) {
    const items = [];
    for (const pair of String(raw).split(',')) {
        const kv = pair.split(':');
        const count = parseInt((kv[0] || '').trim(), 10);
        const weight = parseFloat((kv[1] || '').trim());
        if (Number.isInteger(count) && count >= 0 && isFinite(weight) && weight > 0) {
            items.push({ count, weight });
        }
    }
    if (items.length === 0) items.push({ count: 1, weight: 1 }); // 解析失败兜底：全 1 次
    const total = items.reduce((s, it) => s + it.weight, 0);
    let acc = 0;
    return items.map((it) => {
        const prob = it.weight / total;
        acc += prob;
        return { count: it.count, prob, cum: acc };
    });
}

const WITHDRAW_DIST = parseWithdrawDist(WITHDRAW_COUNT_DIST_RAW);

/** 按分布加权随机选出本次提现次数 */
function pickWithdrawCount() {
    const r = Math.random();
    for (const it of WITHDRAW_DIST) {
        if (r <= it.cum) return it.count;
    }
    return WITHDRAW_DIST[WITHDRAW_DIST.length - 1].count; // 浮点误差兜底
}

/** 分布的可读文本，用于日志 */
function withdrawDistText() {
    return WITHDRAW_DIST.map((d) => `${d.count}次=${(d.prob * 100).toFixed(1)}%`).join(' | ');
}

export const options = {
    scenarios: {
        batch_withdraw: {
            executor: 'shared-iterations',
            vus: 1,
            iterations: FETCH_COUNT,
            maxDuration: '1h'
        }
    }
};

/**
 * Setup 阶段：获取用户列表并转换账号
 */
export function setup() {
    console.log(`\n[Setup] 开始准备批量提现用户数据 (目标数量: ${FETCH_COUNT})...`);
    console.log(`[Setup] 提现次数分布 (WITHDRAW_COUNT_DIST="${WITHDRAW_COUNT_DIST_RAW}"): ${withdrawDistText()}`);

    // 1. 管理员登录
    const adminToken = tenantAdminLogin(tenantId);
    if (!adminToken) {
        throw new Error('[Setup] ❌ 管理员登录失败，无法继续');
    }

    // 2. 分页扫描用户，跳过余额不达标的，一直找到凑够 FETCH_COUNT 个（余额 > MIN_BALANCE）为止。
    //    例：第1个余额不够就跳过、看下一个……直到累积满 FETCH_COUNT 个，或翻完所有用户。
    const userPageApi = '/api/Users/GetPageList';
    const picked = [];
    let pageNo = 1;
    let scanned = 0;

    while (picked.length < FETCH_COUNT && pageNo <= MAX_PAGES) {
        const payload = { userType: 0, state: 1, pageNo, pageSize: PAGE_SIZE, orderBy: 'Desc' };
        const response = sendRequest(payload, userPageApi, 'GetUserPageList', false, adminToken);

        if (!response || !response.list) {
            if (pageNo === 1) {
                console.error(`[Setup] 获取列表失败，响应内容:`, JSON.stringify(response));
                throw new Error('[Setup] ❌ 获取用户列表失败');
            }
            break; // 后续页拉取失败：用已累积的
        }

        const pageUsers = response.list;
        if (pageUsers.length === 0) break; // 没有更多用户
        scanned += pageUsers.length;

        for (const u of pageUsers) {
            if (Number(u.balance) > MIN_BALANCE) {
                picked.push(u);
                if (picked.length >= FETCH_COUNT) break; // 凑够了
            }
        }

        console.log(`[Setup] 第 ${pageNo} 页扫描 ${pageUsers.length} 人，累计达标 ${picked.length}/${FETCH_COUNT}（累计扫描 ${scanned} 人）`);

        if (picked.length >= FETCH_COUNT) break;                       // 已凑够
        if (pageUsers.length < PAGE_SIZE) break;                       // 不足一页 → 已是最后一页
        if (response.totalPage && pageNo >= response.totalPage) break; // 翻到最后一页
        pageNo++;
    }

    if (picked.length === 0) {
        throw new Error(`[Setup] ❌ 扫描 ${scanned} 人后仍无余额 > ${MIN_BALANCE} 的用户；降低 -e MIN_BALANCE，或确认租户有高余额用户`);
    }
    if (picked.length < FETCH_COUNT) {
        console.warn(`[Setup] ⚠️ 全部用户已扫完(${scanned}人)，余额达标仅 ${picked.length} 个 < 目标 ${FETCH_COUNT}（可降低 MIN_BALANCE 或先给用户充值）`);
    }

    const userIds = picked.map((u) => u.userId);
    console.log(`[Setup] ✅ 凑够 ${userIds.length} 个余额 > ${MIN_BALANCE} 的用户（共扫描 ${scanned} 人）`);

    // 3. 将 userId 转换为真实账号
    const userAccounts = batchGetUserAccounts(adminToken, userIds, 500);

    if (userAccounts.length === 0) {
        throw new Error('[Setup] ❌ 无法转换任何用户的真实账号');
    }

    console.log(`[Setup] ✅ 准备就绪，共 ${userAccounts.length} 个账号进入测试流程`);

    return {
        accounts: userAccounts,
        adminToken: adminToken
    };
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export default function (data) {
    const { accounts, adminToken } = data;

    const index = __ITER;
    if (index >= accounts.length) {
        console.warn(`[Iteration ${index}] 超出账号列表范围，跳过`);
        return;
    }

    const userEntry = accounts[index];
    const account = userEntry.account;
    const userId = userEntry.userId;

    // 按配置分布随机确定本用户提现次数（0 次则整体跳过，不登录/不充值，省资源）
    const withdrawCount = pickWithdrawCount();

    console.log(`\n===========================================`);
    console.log(`[BatchWithdraw] 正在处理 [${index + 1}/${accounts.length}]: ${account} (ID: ${userId}) | 本次提现 ${withdrawCount} 次（分布 ${withdrawDistText()}）`);
    console.log(`===========================================`);

    if (withdrawCount <= 0) {
        console.log(`[BatchWithdraw] 用户 ${account} 命中 0 次提现，跳过该用户`);
        return;
    }

    // 1. 登录会话获取 userToken（自动识别手机号/邮箱，调用对应登录方式）
    console.log(`[BatchWithdraw] 正在执行验证码登录流程: ${account}...`);
    const userToken = autoLoginByAccount(String(account), adminToken);

    if (!userToken) {
        console.error(`[BatchWithdraw] ❌ 用户 ${account} 验证码登录失败`);
        return;
    }

    console.log(`[BatchWithdraw] ✅ 登录成功，Token 已获取`);

    // 2. 充值加码(top-up)。用户已按 balance>MIN_BALANCE 过滤，故充值失败不致命，仍用已有余额提现；
    //    SKIP_RECHARGE=true 则完全跳过充值，纯用已有余额。
    if (!SKIP_RECHARGE) {
        const rechargeAmount = getRandomInt(2000, 5000);
        console.log(`[BatchWithdraw] 正在为用户充值(top-up)，金额: ${rechargeAmount}...`);
        const rechargeRes = backendRecharge(adminToken, userId, rechargeAmount, 'Batch Withdraw Recharge');
        if (!rechargeRes || !rechargeRes.success) {
            console.warn(`[BatchWithdraw] ⚠️ 用户 ${account} 充值失败，改用已有余额继续提现`);
        } else {
            console.log(`[BatchWithdraw] ✅ 用户 ${account} 充值成功: ${rechargeAmount}`);
        }
        sleep(1);
    } else {
        console.log(`[BatchWithdraw] SKIP_RECHARGE=true，跳过充值，直接用已有余额提现`);
    }

    // 3. 绑卡
    console.log(`[BatchWithdraw] 正在尝试绑定钱包 (Admin 操作)...`);
    addAllWallets(adminToken, userId);
    sleep(1);

    // 4. 设置/重置提现密码
    console.log(`[BatchWithdraw] 正在设置提现密码...`);
    setWithdrawPassword(userToken, '123456');
    sleep(1);

    // 5. 循环执行提现（次数已在顶部按 WITHDRAW_COUNT_DIST 随机确定）
    for (let i = 0; i < withdrawCount; i++) {
        console.log(`\n[BatchWithdraw] [${account}] --- 第 ${i + 1}/${withdrawCount} 次提现 ---`);

        const balanceInfo = getAccountBalance(userToken);
        if (!balanceInfo || balanceInfo.balance <= 0) {
            console.error(`[BatchWithdraw] ❌ 用户 ${account} 余额不足或查询失败`);
            break;
        }

        const currentBalance = balanceInfo.balance;
        const withdrawInfo = getWithdrawBasicInfo(userToken);
        if (!withdrawInfo || !withdrawInfo.withdrawCategoryList || withdrawInfo.withdrawCategoryList.length === 0) {
            console.error(`[BatchWithdraw] ❌ 用户 ${account} 获取提现通道失败`);
            break;
        }

        let category = withdrawInfo.withdrawCategoryList[0];
        for (let c of withdrawInfo.withdrawCategoryList) {
            if (c.withdrawType !== "UPI") {
                category = c;
                break;
            }
        }

        const walletId = getUserWithdrawWallet(userToken, category.withdrawType);
        if (!walletId) {
            console.error(`[BatchWithdraw] ❌ 用户 ${account} 未找到通道 ${category.withdrawType} 的钱包`);
            break;
        }

        let amount = getRandomInt(100, 500);
        if (amount > currentBalance) {
            amount = Math.floor(currentBalance);
        }

        if (amount < 10) {
            console.warn(`[BatchWithdraw] 用户 ${account} 余额太少 (${currentBalance})，无法满足最小提现需求`);
            break;
        }

        // 发起提现申请，带重试逻辑
        let retryCount = 0;
        const maxRetries = 3;

        while (retryCount <= maxRetries) {
            const response = withdrawApplyLocal(userToken, amount, walletId, category.id, category.withdrawType, '123456');

            if (response && response.msgCode === 0) {
                console.log(`[BatchWithdraw] ✅ 用户 ${account} 第 ${i + 1} 次提现申请成功: ${amount}`);
                break;
            } else if (response && response.msgCode === 13) {
                retryCount++;
                if (retryCount <= maxRetries) {
                    console.warn(`[BatchWithdraw] ⚠️ 访问太频繁 (msgCode: 13)，等待 3 秒后进行第 ${retryCount} 次重试...`);
                    sleep(3);
                } else {
                    console.error(`[BatchWithdraw] ❌ 访问太频繁，已达最大重试次数`);
                }
            } else {
                console.error(`[BatchWithdraw] ❌ 用户 ${account} 第 ${i + 1} 次提现申请失败: ${response ? response.msg : '未知错误'}`);
                break;
            }
        }

        sleep(2);
    }

    console.log(`[BatchWithdraw] 用户 ${account} 处理完毕`);
}

/**
 * 本地封装提现申请函数
 */
function withdrawApplyLocal(token, amount, walletId, withdrawCategoryId, withdrawType, withdrawPassword = '123456') {
    const api = '/api/Withdraw/WithdrawApply';
    const payload = {
        amount: amount,
        walletId: walletId,
        withdrawCategoryId: withdrawCategoryId,
        withdrawType: withdrawType,
        withdrawPassword: withdrawPassword
    };

    return tenantRequest(api, payload, { token, isDesk: true });
}
