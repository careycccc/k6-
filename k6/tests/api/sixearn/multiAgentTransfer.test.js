import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { getAgentHierarchyList } from '../invite/agentApi.js';
import { batchGetUserAccounts, autoLoginByUserId } from '../user/userAccountApi.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { mobileAutoLoginFlow } from '../login/MobileAutoLogin.test.js';
import { emailAutoLoginFlow } from '../login/EmailAutoLogin.test.js';
import { hybridRecharge, getConfigRechargeAmount } from '../recharge/rechargeService.js';
import { betRun } from '../runbet/betRun.js';
import { getAccountBalance } from '../balance/balance.test.js';
import { addAllWallets } from '../withdraw/addWalletApi.js';
import { getWithdrawBasicInfo, setWithdrawPassword, getUserWithdrawWallet, withdrawApply } from '../withdraw/withdrawApi.js';
import { runBackendWithdrawApproval } from '../withdraw/backendWithdrawApi.js';
import { sendRequest } from '../common/request.js';
import { generateRandomPhone } from '../../utils/accountGenerator.js';
import { phoneRegister } from '../login/register.test.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const ROOT_UIDS = (__ENV.ROOT_UIDS || '').split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);
const ENABLE_BACKEND_APPROVAL = (__ENV.ENABLE_BACKEND_APPROVAL || '').toLowerCase() === 'true';
const TAG = 'MultiAgentTransfer';

export const options = {
    setupTimeout: '4h',
    scenarios: {
        multi_agent_transfer: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '6h' }
    }
};

const BEHAVIORS = [
    'recharge_then_transfer', 'recharge_bet_then_transfer',
    'transfer_then_recharge', 'transfer_then_recharge_bet',
    'transfer_then_recharge_bet_withdraw'
];
function randomBehavior() { return BEHAVIORS[Math.floor(Math.random() * BEHAVIORS.length)]; }

const reportRecords = [];
function addRecord(rec) { reportRecords.push(rec); }

function loginByAccount(account, adminToken) {
    const adminData = { token: adminToken };
    if (account.includes('@')) return emailAutoLoginFlow(account, adminData);
    return mobileAutoLoginFlow(account, adminData);
}

function selectByHierarchy(memberList, excludeUid) {
    const eligible = memberList.filter(m => m.userId !== excludeUid);
    if (eligible.length === 0) return null;
    const byHier = {};
    eligible.forEach(m => { if (!byHier[m.hierarchy]) byHier[m.hierarchy] = []; byHier[m.hierarchy].push(m); });
    const hiers = Object.keys(byHier).map(Number);
    const randHier = hiers[Math.floor(Math.random() * hiers.length)];
    const pool = byHier[randHier];
    return pool[Math.floor(Math.random() * pool.length)];
}

function doRecharge(userToken, userId, adminToken) {
    const rand = Math.random();
    const count = rand < 0.6 ? 1 : rand < 0.9 ? 2 : 3;
    let totalAmt = 0, times = 0;
    for (let i = 0; i < count; i++) {
        if (i > 0) sleep(2);
        const r = hybridRecharge({ userToken, adminToken, userId, amount: getConfigRechargeAmount(), frontendFirst: true });
        if (r.success) { totalAmt += r.amount; times++; } else break;
    }
    return { totalAmt, times };
}

function doBet(userToken, account) {
    const count = Math.random() < 0.5 ? 1 : 2;
    let totalAmt = 0, times = 0;
    for (let b = 0; b < count; b++) {
        if (b > 0) sleep(3);
        const r = betRun(userToken, account);
        if (r) { totalAmt += r.amount || 0; times++; }
    }
    return { totalAmt, times };
}

function calcWithdrawAmount(balance) {
    if (balance <= 300) return 0;
    if (balance <= 1000) return Math.floor(balance * 0.3);
    if (balance <= 10000) return Math.floor(balance * 0.1);
    return Math.floor(200 + Math.random() * 4800);
}

function doWithdraw(userToken, userId, adminToken) {
    const balInfo = getAccountBalance(userToken);
    if (!balInfo) return { totalAmt: 0, times: 0 };
    const amt = calcWithdrawAmount(balInfo.balance || 0);
    if (amt <= 0) return { totalAmt: 0, times: 0 };
    addAllWallets(adminToken, userId);
    sleep(1);
    setWithdrawPassword(userToken, '123456');
    const wInfo = getWithdrawBasicInfo(userToken);
    if (!wInfo || wInfo.userTodayWithdrawCount === 0 || wInfo.amountCoding !== 0) return { totalAmt: 0, times: 0 };
    const cats = (wInfo.withdrawCategoryList || []).filter(c => c.withdrawType !== 'UPI');
    if (cats.length === 0) return { totalAmt: 0, times: 0 };
    const cat = cats[Math.floor(Math.random() * cats.length)];
    const walletId = getUserWithdrawWallet(userToken, cat.withdrawType);
    if (!walletId) return { totalAmt: 0, times: 0 };
    const ok = withdrawApply(userToken, amt, walletId, cat.id, cat.withdrawType, '123456');
    if (!ok) return { totalAmt: 0, times: 0 };
    if (ENABLE_BACKEND_APPROVAL) { sleep(2); runBackendWithdrawApproval(adminToken, userId, cat.withdrawType, amt); }
    return { totalAmt: amt, times: 1 };
}

function transferMember(adminToken, userId, targetInviteCode) {
    sendRequest({ userId }, '/api/Agent/UserInviteUnBind', TAG, false, adminToken);
    sleep(2);
    sendRequest({ userId, inviteCode: targetInviteCode }, '/api/Agent/UserInviteBind', TAG, false, adminToken);
    sleep(2);
    console.log('[Transfer] userId=' + userId + ' 转线到 inviteCode=' + targetInviteCode);
}

function executeTransfer(adminToken, fromMember, toInviteCode, fromRootUid) {
    const { userId, hierarchy, account, token: userToken } = fromMember;
    if (!userToken) { console.warn('[Transfer] userId=' + userId + ' 无 token，跳过'); return; }
    const behavior = randomBehavior();
    const isTransFirst = behavior.startsWith('transfer_');
    const transferTiming = isTransFirst ? '转线前' : '充值前';
    console.log('\n[Transfer] userId=' + userId + ' 层级=' + hierarchy + ' 行为=' + behavior);
    const rec = {
        userId, hierarchy, account, isNewUser: false, opType: '转线',
        rechargeAmt: 0, rechargeTimes: 0, betAmt: 0, betTimes: 0, withdrawAmt: 0, withdrawTimes: 0,
        transferFrom: '总代' + fromRootUid, transferFromMember: userId, transferTiming, belongToRoot: fromRootUid
    };
    if (behavior === 'recharge_then_transfer') {
        const r = doRecharge(userToken, userId, adminToken); rec.rechargeAmt = r.totalAmt; rec.rechargeTimes = r.times;
        sleep(1); transferMember(adminToken, userId, toInviteCode);
    } else if (behavior === 'recharge_bet_then_transfer') {
        const r = doRecharge(userToken, userId, adminToken); rec.rechargeAmt = r.totalAmt; rec.rechargeTimes = r.times;
        if (r.times > 0) { sleep(2); const b = doBet(userToken, account); rec.betAmt = b.totalAmt; rec.betTimes = b.times; }
        sleep(1); transferMember(adminToken, userId, toInviteCode);
    } else if (behavior === 'transfer_then_recharge') {
        transferMember(adminToken, userId, toInviteCode); sleep(2);
        const r = doRecharge(userToken, userId, adminToken); rec.rechargeAmt = r.totalAmt; rec.rechargeTimes = r.times;
    } else if (behavior === 'transfer_then_recharge_bet') {
        transferMember(adminToken, userId, toInviteCode); sleep(2);
        const r = doRecharge(userToken, userId, adminToken); rec.rechargeAmt = r.totalAmt; rec.rechargeTimes = r.times;
        if (r.times > 0) { sleep(2); const b = doBet(userToken, account); rec.betAmt = b.totalAmt; rec.betTimes = b.times; }
    } else {
        transferMember(adminToken, userId, toInviteCode); sleep(2);
        const r = doRecharge(userToken, userId, adminToken); rec.rechargeAmt = r.totalAmt; rec.rechargeTimes = r.times;
        if (r.times > 0) {
            sleep(2); const b = doBet(userToken, account); rec.betAmt = b.totalAmt; rec.betTimes = b.times;
            sleep(2); const w = doWithdraw(userToken, userId, adminToken); rec.withdrawAmt = w.totalAmt; rec.withdrawTimes = w.times;
        }
    }
    addRecord(rec);
}

// 普通会员随机行为：随机充值、投注、提现（不涉及转线）
const NORMAL_BEHAVIORS = ['recharge', 'recharge_bet', 'recharge_bet_withdraw', 'none'];
function executeNormal(adminToken, memberInfo) {
    const { userId, hierarchy, account, token: userToken, belongToRoot } = memberInfo;
    if (!userToken) return;
    const behavior = NORMAL_BEHAVIORS[Math.floor(Math.random() * NORMAL_BEHAVIORS.length)];
    if (behavior === 'none') return; // 随机跳过，模拟不活跃用户
    console.log('[Normal] userId=' + userId + ' 层级=' + hierarchy + ' 行为=' + behavior);
    const rec = {
        userId, hierarchy, account, isNewUser: false, opType: '普通',
        rechargeAmt: 0, rechargeTimes: 0, betAmt: 0, betTimes: 0, withdrawAmt: 0, withdrawTimes: 0,
        transferFrom: '─', transferTiming: '─', belongToRoot
    };
    if (behavior === 'recharge') {
        const r = doRecharge(userToken, userId, adminToken); rec.rechargeAmt = r.totalAmt; rec.rechargeTimes = r.times;
    } else if (behavior === 'recharge_bet') {
        const r = doRecharge(userToken, userId, adminToken); rec.rechargeAmt = r.totalAmt; rec.rechargeTimes = r.times;
        if (r.times > 0) { sleep(2); const b = doBet(userToken, account); rec.betAmt = b.totalAmt; rec.betTimes = b.times; }
    } else if (behavior === 'recharge_bet_withdraw') {
        const r = doRecharge(userToken, userId, adminToken); rec.rechargeAmt = r.totalAmt; rec.rechargeTimes = r.times;
        if (r.times > 0) {
            sleep(2); const b = doBet(userToken, account); rec.betAmt = b.totalAmt; rec.betTimes = b.times;
            sleep(2); const w = doWithdraw(userToken, userId, adminToken); rec.withdrawAmt = w.totalAmt; rec.withdrawTimes = w.times;
        }
    }
    // 只记录有实际操作的
    if (rec.rechargeTimes > 0 || rec.betTimes > 0 || rec.withdrawTimes > 0) {
        addRecord(rec);
    }
}

function printReport(adminToken, originalRootMembersMap) {
    const dispW = (s) => [...String(s)].reduce((w, c) => w + (c.charCodeAt(0) > 127 ? 2 : 1), 0);
    const padW = (s, n) => { const w = dispW(s); return String(s) + ' '.repeat(Math.max(0, n - w)); };
    const opMap = {};
    reportRecords.forEach(r => {
        r._opType = r.opType || (r.isNewUser ? '新注册' : '转线');
        r._rechargeAmt = typeof r.rechargeAmt === 'number' ? r.rechargeAmt.toFixed(2) : '0.00';
        r._betAmt = typeof r.betAmt === 'number' ? r.betAmt.toFixed(2) : '0.00';
        r._withdrawAmt = typeof r.withdrawAmt === 'number' ? r.withdrawAmt.toFixed(2) : '0.00';
        opMap[r.userId] = r;
    });
    const cols = [
        { label: 'userId', key: 'userId' }, { label: '层级', key: 'hierarchy' },
        { label: '本次操作', key: '_opType' }, { label: '充值额', key: '_rechargeAmt' },
        { label: '充次', key: 'rechargeTimes' }, { label: '投注额', key: '_betAmt' },
        { label: '投次', key: 'betTimes' }, { label: '提现额', key: '_withdrawAmt' },
        { label: '提次', key: 'withdrawTimes' }, { label: '转线来源', key: 'transferFrom' },
        { label: '转线时机', key: 'transferTiming' }
    ];
    console.log('\n' + '='.repeat(80));
    console.log('  📊 多代理转线报表 | 租户: ' + TENANT_ID + ' | 总代: ' + ROOT_UIDS.join(',') + ' | 本次操作: ' + reportRecords.length + ' 条');
    console.log('='.repeat(80));
    ROOT_UIDS.forEach(rootUid => {
        const members = (originalRootMembersMap[rootUid] || []).filter(m => m.userId !== rootUid);
        if (!members || members.length === 0) { console.warn('  总代 ' + rootUid + ' 无成员数据'); return; }
        const rows = members.map(m => {
            const op = opMap[m.userId];
            return {
                userId: m.userId, hierarchy: m.hierarchy,
                _opType: op ? op._opType : '─',
                _rechargeAmt: op ? op._rechargeAmt : '─',
                rechargeTimes: op ? op.rechargeTimes : '─',
                _betAmt: op ? op._betAmt : '─',
                betTimes: op ? op.betTimes : '─',
                _withdrawAmt: op ? op._withdrawAmt : '─',
                withdrawTimes: op ? op.withdrawTimes : '─',
                transferFrom: op ? op.transferFrom : '─',
                transferTiming: op ? op.transferTiming : '─'
            };
        });
        const groupCols = cols.map(c => ({ ...c }));
        groupCols.forEach(col => {
            let w = dispW(col.label) + 2;
            rows.forEach(r => { const v = dispW(String(r[col.key] ?? '')); if (v + 2 > w) w = v + 2; });
            col.width = w;
        });
        const sep = '+' + groupCols.map(c => '-'.repeat(c.width + 2)).join('+') + '+';
        const opRows = rows.filter(r => r._opType !== '─');
        console.log('\n  -- 总代 ' + rootUid + '  共 ' + members.length + ' 个成员  本次操作 ' + opRows.length + ' 人');
        console.log(sep);
        console.log('|' + groupCols.map(c => ' ' + padW(c.label, c.width) + ' ').join('|') + '|');
        console.log(sep);
        rows.forEach(r => { console.log('|' + groupCols.map(c => ' ' + padW(String(r[col.key] ?? ''), c.width) + ' ').join('|') + '|'); });
        console.log(sep);
        const gR = opRows.reduce((s, r) => s + (parseFloat(r._rechargeAmt) || 0), 0);
        const gB = opRows.reduce((s, r) => s + (parseFloat(r._betAmt) || 0), 0);
        const gW = opRows.reduce((s, r) => s + (parseFloat(r._withdrawAmt) || 0), 0);
        const transferCount = opRows.filter(r => r._opType === '转线').length;
        const normalCount = opRows.filter(r => r._opType === '普通').length;
        const newCount = opRows.filter(r => r._opType === '新注册').length;
        console.log('  小计: 转线' + transferCount + '人 普通' + normalCount + '人 新注册' + newCount + '人 | 充值:' + gR.toFixed(2) + ' 投注:' + gB.toFixed(2) + ' 提现:' + gW.toFixed(2));
    });
    const tR = reportRecords.reduce((s, r) => s + (r.rechargeAmt || 0), 0);
    const tB = reportRecords.reduce((s, r) => s + (r.betAmt || 0), 0);
    const tW = reportRecords.reduce((s, r) => s + (r.withdrawAmt || 0), 0);
    const totalTransfer = reportRecords.filter(r => r.opType === '转线').length;
    const totalNormal = reportRecords.filter(r => r.opType === '普通').length;
    const totalNew = reportRecords.filter(r => r.opType === '新注册').length;
    console.log('\n' + '='.repeat(80));
    console.log('  全局汇总: 转线' + totalTransfer + '人 | 普通' + totalNormal + '人 | 新注册' + totalNew + '人 | 充值:' + tR.toFixed(2) + ' | 投注:' + tB.toFixed(2) + ' | 提现:' + tW.toFixed(2));
    console.log('='.repeat(80) + '\n');
}

export function setup() {
    if (ROOT_UIDS.length < 2) throw new Error('ROOT_UIDS 至少需要2个总代');
    const envCfg = getEnvByTenantId(TENANT_ID);
    Object.assign(ENV_CONFIG, envCfg);
    console.log('\n[Setup] 租户: ' + TENANT_ID + ' | 总代: ' + ROOT_UIDS.join(','));
    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error('[Setup] 管理员登录失败');
    console.log('[Setup] 登录成功');

    const rootMembersMap = {};
    ROOT_UIDS.forEach(rootUid => {
        const members = getAgentHierarchyList(adminToken, rootUid, { isAll: true, isIncludeSelfAndParent: true, pageSize: 500 });
        rootMembersMap[rootUid] = members || [];
        console.log('[Setup] 总代 ' + rootUid + ': ' + (members ? members.length : 0) + ' 个成员');
    });

    const newUserRootUid = ROOT_UIDS[Math.floor(Math.random() * ROOT_UIDS.length)];
    const countryCode = envCfg.COUNTRY_CODE || '91';
    console.log('\n[Setup] 随机选中总代 ' + newUserRootUid + ' 进行新用户邀请');
    const existingMembers = rootMembersMap[newUserRootUid] || [];
    const byHier = {};
    existingMembers.forEach(m => { if (!byHier[m.hierarchy]) byHier[m.hierarchy] = []; byHier[m.hierarchy].push(m); });
    const newlyRegistered = [];
    Object.keys(byHier).forEach(hierStr => {
        const hier = Number(hierStr);
        const pool = byHier[hier];
        const parent = pool[Math.floor(Math.random() * pool.length)];
        const count = Math.floor(Math.random() * 5);
        if (count === 0) return;
        console.log('[Setup] 层级' + hier + ' 上级=' + parent.userId + ' 邀请 ' + count + ' 个新用户');
        for (let i = 0; i < count; i++) {
            sleep(1);
            const phone = generateRandomPhone(countryCode);
            const adminData = { token: adminToken, envConfig: envCfg };
            const regResult = phoneRegister(phone, adminData, 'qwer1234', String(parent.userId));
            if (!regResult || !regResult.data) { console.warn('[Setup] 注册失败: ' + phone); continue; }
            const regToken = regResult.data.token;
            if (!regToken) continue;
            sleep(1);
            const frontInfo = getFrontUserInfo(regToken);
            if (!frontInfo || !frontInfo.userId) continue;
            console.log('[Setup] 新用户注册成功: ' + phone + ' userId=' + frontInfo.userId);
            newlyRegistered.push({ userId: frontInfo.userId, hierarchy: hier + 1, account: phone, isNewUser: true, belongToRoot: newUserRootUid });
            rootMembersMap[newUserRootUid].push({ userId: frontInfo.userId, hierarchy: hier + 1, inviteCode: frontInfo.inviteCode || '' });
        }
    });

    const memberTokenMap = {};
    newlyRegistered.forEach(nr => {
        sleep(1);
        const token = loginByAccount(nr.account, adminToken);
        if (token) { memberTokenMap[nr.userId] = { ...nr, token }; console.log('[Setup] 新用户登录成功: ' + nr.account); }
    });

    ROOT_UIDS.forEach(rootUid => {
        const members = rootMembersMap[rootUid] || [];
        const nonRoot = members.filter(m => m.userId !== rootUid);
        const userIds = nonRoot.map(m => m.userId).filter(uid => !memberTokenMap[uid]);
        if (userIds.length === 0) return;
        console.log('\n[Setup] 总代 ' + rootUid + ': 批量获取 ' + userIds.length + ' 个成员账号...');
        const accounts = batchGetUserAccounts(adminToken, userIds, 300);
        accounts.forEach(({ userId, account }) => {
            sleep(0.5);
            const memberInfo = nonRoot.find(m => m.userId === userId);
            const token = loginByAccount(account, adminToken);
            if (token) {
                sleep(0.5);
                const frontInfo = getFrontUserInfo(token);
                const inviteCode = frontInfo ? (frontInfo.inviteCode || '') : '';
                memberTokenMap[userId] = { userId, account, token, inviteCode, hierarchy: memberInfo ? memberInfo.hierarchy : 0, belongToRoot: rootUid, isNewUser: false };
                console.log('[Setup] 登录成功: ' + account + ' userId=' + userId + ' inviteCode=' + inviteCode);
            } else {
                console.warn('[Setup] 登录失败: ' + account + ' userId=' + userId);
            }
        });
    });

    const inviteCodes = {};
    ROOT_UIDS.forEach(rootUid => {
        const token = autoLoginByUserId(adminToken, rootUid);
        if (token) {
            sleep(1);
            const info = getFrontUserInfo(token);
            if (info && info.inviteCode) { inviteCodes[rootUid] = info.inviteCode; console.log('[Setup] 总代 ' + rootUid + ' 邀请码: ' + info.inviteCode); }
        }
        if (!inviteCodes[rootUid]) { inviteCodes[rootUid] = String(rootUid); console.warn('[Setup] 总代 ' + rootUid + ' 使用 userId 兜底'); }
    });

    console.log('\n[Setup] 准备完成 | 成员登录: ' + Object.keys(memberTokenMap).length + ' 人');
    return { adminToken, rootMembersMap, memberTokenMap, inviteCodes };
}

export default function (data) {
    const { adminToken, rootMembersMap, memberTokenMap, inviteCodes } = data;
    const N = ROOT_UIDS.length;
    const envCfg = getEnvByTenantId(TENANT_ID);
    Object.assign(ENV_CONFIG, envCfg);

    console.log('\n' + '='.repeat(70));
    console.log('🚀 多代理转线测试开始  共 ' + N + ' 个总代');
    console.log('='.repeat(70) + '\n');

    const transferPlan = [];
    for (let i = 1; i < N; i++) transferPlan.push({ fromIdx: 0, toIdx: i });
    for (let i = 1; i < N; i++) transferPlan.push({ fromIdx: i, toIdx: (i - 1 + N) % N });

    console.log('[Plan] 转线计划 (共' + transferPlan.length + '次):');
    transferPlan.forEach((p, i) => { console.log('  ' + (i+1) + '. 总代' + ROOT_UIDS[p.fromIdx] + ' -> 总代' + ROOT_UIDS[p.toIdx]); });

    // 记录所有被选中转线的 userId，避免后续普通操作重复处理
    const transferredUserIds = new Set();

    transferPlan.forEach((plan, idx) => {
        const fromUid = ROOT_UIDS[plan.fromIdx];
        const toUid = ROOT_UIDS[plan.toIdx];
        const toCode = inviteCodes[toUid];
        console.log('\n' + '-'.repeat(60));
        console.log('[' + (idx+1) + '/' + transferPlan.length + '] 转线: 总代' + fromUid + ' -> 总代' + toUid + ' (邀请码: ' + toCode + ')');
        console.log('-'.repeat(60));

        const fromMembers = (rootMembersMap[fromUid] || []).filter(m => m.userId !== fromUid && !transferredUserIds.has(m.userId));
        const fromMember = selectByHierarchy(fromMembers, fromUid);
        if (!fromMember) { console.warn('[Transfer] 总代' + fromUid + ' 无可用成员，跳过'); return; }

        const fromInfo = memberTokenMap[fromMember.userId];
        if (!fromInfo || !fromInfo.token) { console.warn('[Transfer] userId=' + fromMember.userId + ' 无 token，跳过'); return; }

        const toMembers = (rootMembersMap[toUid] || []).filter(m => m.userId !== toUid);
        let finalToCode = toCode;
        if (toMembers.length > 0) {
            const toMember = selectByHierarchy(toMembers, toUid);
            if (toMember) {
                const toMemberInfo = memberTokenMap[toMember.userId];
                if (toMemberInfo && toMemberInfo.inviteCode) {
                    finalToCode = toMemberInfo.inviteCode;
                    console.log('[Transfer] 接收方: userId=' + toMember.userId + ' 层级=' + toMember.hierarchy + ' inviteCode=' + finalToCode);
                } else {
                    console.log('[Transfer] 接收方: userId=' + toMember.userId + ' 无邀请码，使用总代邀请码兜底');
                }
            }
        }

        transferredUserIds.add(fromMember.userId);
        executeTransfer(adminToken, { ...fromInfo, hierarchy: fromMember.hierarchy }, finalToCode, fromUid);
        sleep(2);
    });

    // 对所有未被转线的成员执行普通随机充值/投注/提现
    console.log('\n' + '='.repeat(60));
    console.log('💰 开始普通会员随机操作（未转线成员）');
    console.log('='.repeat(60));
    const allMemberIds = Object.keys(memberTokenMap).map(Number);
    const normalMembers = allMemberIds.filter(uid => !transferredUserIds.has(uid));
    console.log('[Normal] 共 ' + normalMembers.length + ' 个普通会员待操作');
    normalMembers.forEach(uid => {
        const info = memberTokenMap[uid];
        if (!info || info.isNewUser) return; // 新注册用户单独处理，不走普通流程
        sleep(1);
        executeNormal(adminToken, info);
    });

    // 新注册用户：也做一次普通充值/投注
    const newUsers = allMemberIds.filter(uid => memberTokenMap[uid] && memberTokenMap[uid].isNewUser);
    if (newUsers.length > 0) {
        console.log('\n[NewUser] 共 ' + newUsers.length + ' 个新注册用户执行首次充值/投注');
        newUsers.forEach(uid => {
            const info = memberTokenMap[uid];
            sleep(1);
            const rec = {
                userId: info.userId, hierarchy: info.hierarchy, account: info.account,
                isNewUser: true, opType: '新注册',
                rechargeAmt: 0, rechargeTimes: 0, betAmt: 0, betTimes: 0, withdrawAmt: 0, withdrawTimes: 0,
                transferFrom: '─', transferTiming: '─', belongToRoot: info.belongToRoot
            };
            const r = doRecharge(info.token, info.userId, adminToken);
            rec.rechargeAmt = r.totalAmt; rec.rechargeTimes = r.times;
            if (r.times > 0) {
                sleep(2);
                const b = doBet(info.token, info.account);
                rec.betAmt = b.totalAmt; rec.betTimes = b.times;
            }
            if (rec.rechargeTimes > 0 || rec.betTimes > 0) addRecord(rec);
        });
    }

    printReport(adminToken, rootMembersMap);
}
