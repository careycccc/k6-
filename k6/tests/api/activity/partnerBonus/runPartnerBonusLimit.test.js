import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { runMemberLimitAdapter } from '../memberLimitAdapter/adapter.js';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { ENV_CONFIG } from '../../../../config/envconfig.js';
import { autoLoginByUserId } from '../../user/userAccountApi.js';
import { phoneRegisterByInvite } from '../../login/register.test.js';
import { generateRandomPhone } from '../../../utils/accountGeneratorFaker.js';
import { hybridRecharge } from '../../recharge/rechargeService.js';
import { betRun } from '../../runbet/betRun.js';
import { getFrontUserInfo } from '../../user/userManagement.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';

export const options = {
    scenarios: {
        partner_limit_test: {
            executor: 'per-vu-iterations',
            vus: 1, 
            iterations: 1,
            maxDuration: '4h'
        },
    },
};

// --- 固定环境初始化辅助函数 ---
function getOrCreateGroup(adminToken, groupName) {
    const apiGet = '/api/Groups/GetPageList';
    const payloadGet = {sortField: "id", orderBy: "Desc", pageNo: 1, pageSize: 20};
    const res = sendQueryRequest(payloadGet, apiGet, 'GroupSetup', false, adminToken);
    let list = res?.data?.list || res?.list || [];
    let group = list.find(g => g.name === groupName);
    if (group) return group.id;

    logger.info(`[PartnerBonusLimit] 创建分组: ${groupName}`);
    const apiSubmit = '/api/Groups/SubmitGroups';
    const payloadSubmit = { tagId: null, name: groupName, remark: `自动化-${groupName}` };
    sendRequest(payloadSubmit, apiSubmit, 'GroupSetup', false, adminToken);
    sleep(1.5);
    
    const res2 = sendQueryRequest(payloadGet, apiGet, 'GroupSetup', false, adminToken);
    list = res2?.data?.list || res2?.list || [];
    group = list.find(g => g.name === groupName);
    return group ? group.id : null;
}

function getOrCreateBasicTag(adminToken, tagName, conditionType, color) {
    const apiGet = '/api/TagConfig/GetBasicTagPageList';
    const payloadGet = {pageNo: 1, pageSize: 100, orderBy: "Desc"};
    const res = sendQueryRequest(payloadGet, apiGet, 'TagSetup', false, adminToken);
    let list = res?.data || [];
    let tag = list.find(t => t.tagName === tagName);
    if (tag) return tag.id;

    logger.info(`[PartnerBonusLimit] 创建基础标签: ${tagName}`);
    const apiSubmit = '/api/TagConfig/SubmitBasicTag';
    const payloadSubmit = { tagName: tagName, conditionType: conditionType, conditionMin: 1, conditionMax: 100, color: color };
    sendRequest(payloadSubmit, apiSubmit, 'TagSetup', false, adminToken);
    sleep(1.5);

    const res2 = sendQueryRequest(payloadGet, apiGet, 'TagSetup', false, adminToken);
    list = res2?.data || [];
    tag = list.find(t => t.tagName === tagName);
    return tag ? tag.id : null;
}

function getOrCreateCompositeTag(adminToken, tagName, basicTagId, color) {
    const apiGet = '/api/TagConfig/GetCompositeTagPageData';
    const payloadGet = {pageNo: 1, pageSize: 100};
    const res = sendQueryRequest(payloadGet, apiGet, 'TagSetup', false, adminToken);
    let list = res?.data?.list || res?.data || [];
    let tag = list.find(t => t.tagName === tagName);
    if (tag) return tag.id;

    logger.info(`[PartnerBonusLimit] 创建组合标签: ${tagName}`);
    const apiSubmit = '/api/TagConfig/SubmitCompositeTag';
    const payloadSubmit = { tagName: tagName, color: color, packageIds: [], adGroupIds: [], conditionDetails: [{index: 0, basicTagIds: [basicTagId]}] };
    sendRequest(payloadSubmit, apiSubmit, 'TagSetup', false, adminToken);
    sleep(1.5);

    const res2 = sendQueryRequest(payloadGet, apiGet, 'TagSetup', false, adminToken);
    list = res2?.data?.list || res2?.data || [];
    tag = list.find(t => t.tagName === tagName);
    return tag ? tag.id : null;
}

function initFixedEnv(adminToken) {
    const tuhaoGroupId = getOrCreateGroup(adminToken, '土豪组');
    const dageGroupId = getOrCreateGroup(adminToken, '大哥组');

    // 基础标签
    const chongzhiBasicId = getOrCreateBasicTag(adminToken, '充值一次以上', 5, 1);
    const tixianBasicId = getOrCreateBasicTag(adminToken, '提现一次以上', 7, 3);

    // 组合标签
    const chongzhiCompositeId = getOrCreateCompositeTag(adminToken, '充值一次以上', chongzhiBasicId, 1);
    const tixianCompositeId = getOrCreateCompositeTag(adminToken, '提现一次以上', tixianBasicId, 3);

    return { tuhaoGroupId, dageGroupId, chongzhiCompositeId, tixianCompositeId };
}

function extractToken(response) {
    if (!response) return null;
    if (response.data && response.data.token) return response.data.token;
    if (response.headers) {
        const auth = response.headers['Authorization'] || response.headers['authorization'];
        if (auth) return auth.replace(/^Bearer\s+/i, '').trim();
    }
    return null;
}

export function setup() {
    const adminToken = AdminLogin();
    if (!adminToken) throw new Error('管理员登录失败');
    
    // 初始化固定环境
    const fixedEnv = initFixedEnv(adminToken);
    logger.info(`[PartnerBonusLimit] 固定环境初始化完成: ${JSON.stringify(fixedEnv)}`);

    return { adminToken, fixedEnv };
}

export default function(data) {
    const { adminToken, fixedEnv } = data;
    
    // --- 1. 修改活动的接口与基础 Payload ---
    const updateApi = '/api/PartnerReward/SaveConfig'; 
    const basePayload = {
        "requireBindWithdraw": 0,
        "registerCompleteDays": 7,
        "firstEnabled": 0,
        "firstRechargeBonusConfig": [],
        "secondEnabled": 1,
        "secondRechargeBonusConfig": [
            {"rechargeAmount": 112, "validBetAmount": 10, "bonusAmount": 20},
            {"rechargeAmount": 120, "validBetAmount": 15, "bonusAmount": 25}
        ],
        "thirdEnabled": 1,
        "thirdRechargeBonusConfig": [
            {"rechargeAmount": 123, "validBetAmount": 10, "bonusAmount": 25},
            {"rechargeAmount": 128, "validBetAmount": 15, "bonusAmount": 30}
        ],
        "state": 1
    };

    // --- 2. 自定义 Patch Payload 逻辑 ---
    const patchPayload = (base, context) => {
        let payload = Object.assign({}, base);
        payload.userLimit = 1;
        payload.limitGroups = "";

        switch(context.type) {
            case 'platform':
                payload.userLimit = 1;
                break;
            case 'group':
                payload.userLimit = 8;
                payload.limitGroups = String(context.groupId);
                break;
            case 'vip':
                payload.userLimit = 9;
                payload.limitGroups = String(context.vipLevel);
                break;
            case 'channel':
                payload.userLimit = 11;
                payload.limitGroups = String(context.packageId);
                break;
            case 'exclude':
                payload.userLimit = 1;
                let excludeObj = {};
                if (context.excludeGroup) excludeObj.Group = String(context.excludeGroup);
                if (context.excludeTag) excludeObj.TagComposite = String(context.excludeTag);
                payload.limitGroups = JSON.stringify(excludeObj);
                break;
            case 'new_member':
                payload.userLimit = 2;
                break;
            case 'recharge':
                payload.userLimit = 16;
                payload.limitGroups = `GreaterThanOrEqual,${context.rechargeCount}`;
                break;
            case 'tag':
                payload.userLimit = 17;
                payload.limitGroups = String(context.tagId);
                break;
        }
        return payload;
    };

    // 获取合伙人活动参与数据的 API
    const getPartnerDataList = (userId) => {
        const api = '/api/PartnerReward/GetDataPageList';
        const payload = {
            parentId: userId,
            timeType: 1,
            pageNo: 1,
            pageSize: 20
        };
        const res = sendQueryRequest(payload, api, 'PartnerData', false, adminToken);
        return res?.data?.totalCount || 0;
    };

    // --- 3. 定义触发器 ---
    const triggerActivity = (userId, expectedSuccess, testName) => {
        logger.info(`\n[Test: ${testName}] 🚀 开始验证用户: ${userId}`);
        
        // 1) 登录拿邀请码
        const userToken = autoLoginByUserId(adminToken, userId);
        if (!userToken) {
            logger.error(`[Test: ${testName}] ❌ 自动登录失败`);
            return false;
        }
        const userInfo = getFrontUserInfo(userToken);
        const inviteCode = userInfo?.inviteCode;
        if (!inviteCode) {
            logger.error(`[Test: ${testName}] ❌ 获取邀请码失败`);
            return false;
        }

        // 2) 记录执行前数据条数
        const beforeCount = getPartnerDataList(userId);
        logger.info(`[Test: ${testName}] 执行前 GetDataPageList totalCount = ${beforeCount}`);

        // 3) 邀请下级注册
        const countryCode = ENV_CONFIG.COUNTRY_CODE || '91';
        const childPhone = generateRandomPhone(countryCode);
        const adminData = { token: adminToken, envConfig: ENV_CONFIG };
        const urls = {
            frontUrl: ENV_CONFIG.BASE_DESK_URL,
            adminUrl: ENV_CONFIG.BASE_ADMIN_URL,
            registerUrl: ENV_CONFIG.BASE_DESK_URL,
        };
        
        const childRegRes = phoneRegisterByInvite(childPhone, inviteCode, adminData, 'qwer1234', '', urls);
        const childToken = extractToken(childRegRes);

        if (!childToken) {
            logger.error(`[Test: ${testName}] ❌ 下级注册失败`);
            return false;
        }
        const childUserId = childRegRes.data?.userId;
        logger.info(`[Test: ${testName}] ✅ 下级 ${childPhone} (UID: ${childUserId}) 注册成功`);

        // 4) 下级首充 (因为首充无奖励，随便充100)
        hybridRecharge({
            userToken: childToken,
            adminToken: adminToken,
            userId: childUserId,
            amount: 100,
            frontendFirst: true,
            remark: 'Test-First-Recharge'
        });
        sleep(2);

        // 5) 下级二充 (必须满足 112)
        hybridRecharge({
            userToken: childToken,
            adminToken: adminToken,
            userId: childUserId,
            amount: 112,
            frontendFirst: true,
            remark: 'Test-Second-Recharge'
        });
        sleep(2);

        // 6) 下级投注 (必须达到 validBetAmount: 10)
        // 循环3次打码，保证超过 10 的流水
        for (let i = 0; i < 3; i++) {
            betRun(childToken, childPhone);
            sleep(1);
        }
        logger.info(`[Test: ${testName}] ✅ 下级充值与投注已完成，等待系统结算...`);
        sleep(3); // 等待异步流水或派奖

        // 7) 记录执行后数据条数
        const afterCount = getPartnerDataList(userId);
        logger.info(`[Test: ${testName}] 执行后 GetDataPageList totalCount = ${afterCount}`);

        const actualSuccess = (afterCount > beforeCount);

        // 8) 断言
        if (actualSuccess === expectedSuccess) {
            logger.info(`[Test: ${testName}] ✅ 验证通过 (期望=${expectedSuccess}, 实际=${actualSuccess})`);
            return true;
        } else {
            logger.error(`[Test: ${testName}] ❌ 验证失败 (期望=${expectedSuccess}, 实际=${actualSuccess})`);
            return false;
        }
    };

    // --- 4. 执行测试框架 ---
    runMemberLimitAdapter(adminToken, {
        activityUpdateApi: updateApi,
        basePayload: basePayload,
        triggerActivity: triggerActivity,
        patchPayload: patchPayload,
        supplierOptions: {
            targetGroupId: fixedEnv.tuhaoGroupId,          // 准入分组：土豪组
            excludeGroupId: fixedEnv.dageGroupId,          // 剔除分组：大哥组
            targetTagId: fixedEnv.chongzhiCompositeId,     // 准入标签：充值一次以上
            excludeTagId: fixedEnv.tixianCompositeId       // 剔除标签：提现一次以上
        }
    });
}
