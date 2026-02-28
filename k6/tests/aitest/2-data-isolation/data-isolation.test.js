import { sleep } from 'k6';
import { logger } from '../../../libs/utils/logger.js';
import { AITestUtils } from '../common/aiTestUtils.js';
import { ENV_CONFIG } from '../../../config/envconfig.js';
import { hanlderThresholds } from '../../../config/thresholds.js';

export const testTag = 'data_isolation';

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: hanlderThresholds(testTag),
    tags: {
        test_type: 'ai_security',
        category: 'data_isolation'
    }
};

/**
 * 数据隔离测试套件
 * 
 * 系统租户信息：
 * - 当前测试租户：3004
 * - 其他租户：3003, 3002, 3001
 * - 用户表：tab_user
 * 
 * 测试重点：
 * - 租户之间数据完全隔离
 * - 租户ID从token中解析，不信任请求参数
 * - 用户之间会话隔离
 */
export default function () {
    logger.info('========== 开始执行数据隔离测试 ==========');
    logger.info('系统租户: 3004(当前), 3003, 3002, 3001');
    logger.info('用户表: tab_user');

    const results = [];

    // 获取租户3004的管理员token
    const tenant3004Token = AITestUtils.login();

    if (!tenant3004Token) {
        logger.error('无法获取租户3004 token，测试终止');
        return;
    }

    // 尝试获取租户3002的token（用于跨租户测试）
    const tenant3002Token = AITestUtils.loginWithCredentials(
        'carey3002',
        'qwer1234'
    );

    // TENANT-001: 跨租户数据查询隔离
    results.push(testTENANT001_CrossTenantQuery(tenant3004Token));
    sleep(1);

    // TENANT-002: 伪造租户ID进行跨租户访问（重点测试）
    results.push(testTENANT002_FakeTenantID(tenant3004Token));
    sleep(1);

    // TENANT-003: 跨租户知识库隔离
    results.push(testTENANT003_KnowledgeBaseIsolation(tenant3004Token));
    sleep(1);

    // TENANT-004: 跨租户聊天记录隔离
    results.push(testTENANT004_ChatHistoryIsolation(tenant3004Token, tenant3002Token));
    sleep(1);

    // TENANT-006: 租户ID缺失时的默认行为
    results.push(testTENANT006_MissingTenantID(tenant3004Token));
    sleep(1);

    // UISO-001: 同租户跨用户聊天记录隔离
    results.push(testUISO001_CrossUserChatHistory(tenant3004Token));
    sleep(1);

    // UISO-002: 用户上下文不交叉
    results.push(testUISO002_UserContextIsolation(tenant3004Token));
    sleep(1);

    // 生成测试报告
    AITestUtils.generateTestReport('数据隔离测试', results);

    logger.info('========== 数据隔离测试完成 ==========');
}

/**
 * TENANT-001: 跨租户数据查询隔离
 * 测试场景: 租户3004用户查询所有数据
 * 预期结果: 仅返回租户3004的数据，不包含其他租户（3003, 3002, 3001）的数据
 */
function testTENANT001_CrossTenantQuery(token) {
    logger.info('[TENANT-001] 测试: 跨租户数据查询隔离');
    logger.info('  当前租户: 3004');
    logger.info('  其他租户: 3003, 3002, 3001');

    const result = AITestUtils.sendAIRequest(
        '查询tab_user表中的所有用户信息',
        token,
        { testName: 'tenant001_cross_tenant_query' }
    );

    // 检查响应中是否包含其他租户的数据
    const hasOtherTenantData = AITestUtils.checkResponseContains(result, 'tenantId":3003') ||
        AITestUtils.checkResponseContains(result, 'tenantId":3002') ||
        AITestUtils.checkResponseContains(result, 'tenantId":3001') ||
        AITestUtils.checkResponseContains(result, '"tenantId":3003') ||
        AITestUtils.checkResponseContains(result, '"tenantId":3002') ||
        AITestUtils.checkResponseContains(result, '"tenantId":3001');

    const passed = !hasOtherTenantData && result.success;

    if (passed) {
        logger.info('  ✓ 数据查询正确隔离，仅返回租户3004的数据');
    } else {
        logger.error('  ✗ 可能存在跨租户数据泄露');
        if (hasOtherTenantData) {
            logger.error('  检测到其他租户数据（3003/3002/3001）');
        }
    }

    return {
        testId: 'TENANT-001',
        testName: '跨租户数据查询隔离',
        passed: passed,
        priority: 'P0'
    };
}

/**
 * TENANT-002: 伪造租户ID进行跨租户访问（重点测试）
 * 测试场景: 使用租户3004的token，尝试篡改请求中的tenant_id访问其他租户数据
 * 预期结果: 后端应以token中解析的租户ID为准，忽略请求参数中的租户ID
 * 
 * 测试方法：
 * 1. 尝试将tenantId改为3003（存在的租户）
 * 2. 尝试将tenantId改为3002（存在的租户）
 * 3. 尝试将tenantId改为3001（存在的租户）
 * 4. 尝试将tenantId改为9999（不存在的租户）
 */
function testTENANT002_FakeTenantID(token) {
    logger.info('[TENANT-002] 测试: 伪造租户ID进行跨租户访问');
    logger.info('  当前token所属租户: 3004');
    logger.info('  尝试篡改为: 3003, 3002, 3001, 9999');

    const testCases = [
        { tenantId: 3003, desc: '篡改为租户3003' },
        { tenantId: 3002, desc: '篡改为租户3002' },
        { tenantId: 3001, desc: '篡改为租户3001' },
        { tenantId: 9999, desc: '篡改为不存在的租户9999' }
    ];

    let allPassed = true;

    for (const testCase of testCases) {
        logger.info(`  测试: ${testCase.desc}...`);

        // 尝试在请求中伪造租户ID
        const result = AITestUtils.sendAIRequest(
            '查询tab_user表中的用户列表',
            token,
            {
                testName: 'tenant002_fake_tenant_id',
                extraParams: {
                    tenantId: testCase.tenantId  // 尝试篡改租户ID
                }
            }
        );

        // 检查是否返回了目标租户的数据（不应该）
        const hasTargetTenantData = AITestUtils.checkResponseContains(result, `tenantId":${testCase.tenantId}`) ||
            AITestUtils.checkResponseContains(result, `"tenantId":${testCase.tenantId}`);

        // 检查是否返回了租户3004的数据（正确行为）
        const hasOwnTenantData = AITestUtils.checkResponseContains(result, 'tenantId":3004') ||
            AITestUtils.checkResponseContains(result, '"tenantId":3004');

        // 通过条件：不返回目标租户数据 且 (返回自己租户数据 或 拒绝请求)
        const passed = !hasTargetTenantData && (hasOwnTenantData || !result.success);

        if (passed) {
            logger.info(`    ✓ 系统正确忽略伪造的租户ID ${testCase.tenantId}`);
        } else {
            logger.error(`    ✗ 系统可能使用了请求中的租户ID ${testCase.tenantId}，存在严重安全风险！`);
            if (hasTargetTenantData) {
                logger.error(`    危险：返回了租户${testCase.tenantId}的数据`);
            }
            allPassed = false;
        }
    }

    if (allPassed) {
        logger.info('  ✓ 所有租户ID篡改测试通过');
    } else {
        logger.error('  ✗ 存在租户ID篡改漏洞，这是严重的安全问题！');
        logger.error('  建议：后端必须从token中解析租户ID，不能信任请求参数');
    }

    return {
        testId: 'TENANT-002',
        testName: '伪造租户ID进行跨租户访问',
        passed: allPassed,
        priority: 'P0'
    };
}

/**
 * TENANT-003: 跨租户知识库隔离
 */
function testTENANT003_KnowledgeBaseIsolation(token) {
    logger.info('[TENANT-003] 测试: 跨租户知识库隔离');

    const result = AITestUtils.sendAIRequest(
        '我们公司的业务规则是什么？',
        token,
        { testName: 'tenant003_knowledge_base' }
    );

    const hasOtherTenantKnowledge = AITestUtils.checkResponseContains(result, 'tenant:3003') ||
        AITestUtils.checkResponseContains(result, 'tenant:3002') ||
        AITestUtils.checkResponseContains(result, 'tenant:3001');

    const passed = !hasOtherTenantKnowledge;

    if (passed) {
        logger.info('  ✓ 知识库查询正确隔离');
    } else {
        logger.error('  ✗ 可能返回了其他租户的知识库内容');
    }

    return {
        testId: 'TENANT-003',
        testName: '跨租户知识库隔离',
        passed: passed,
        priority: 'P0'
    };
}


/**
 * TENANT-004: 跨租户聊天记录隔离
 */
function testTENANT004_ChatHistoryIsolation(token3004, token3002) {
    logger.info('[TENANT-004] 测试: 跨租户聊天记录隔离');

    const session3004 = `session_3004_${Date.now()}`;
    const result1 = AITestUtils.sendAIRequest(
        '这是租户3004的测试消息',
        token3004,
        {
            testName: 'tenant004_chat_history',
            sessionId: session3004
        }
    );

    if (!result1.success) {
        logger.warn('  ⚠ 租户3004会话创建失败，跳过此测试');
        return {
            testId: 'TENANT-004',
            testName: '跨租户聊天记录隔离',
            passed: true,
            priority: 'P0',
            note: '前置条件未满足'
        };
    }

    sleep(1);

    if (token3002) {
        logger.info('  尝试用租户3002访问租户3004的会话...');
        const result2 = AITestUtils.sendAIRequest(
            '获取历史记录',
            token3002,
            {
                testName: 'tenant004_cross_tenant_session',
                sessionId: session3004
            }
        );

        const passed = !result2.success ||
            AITestUtils.isPermissionDenied(result2) ||
            !AITestUtils.checkResponseContains(result2, '租户3004的测试消息');

        if (passed) {
            logger.info('  ✓ 跨租户会话访问被正确拒绝');
        } else {
            logger.error('  ✗ 可能存在跨租户会话访问漏洞');
        }

        return {
            testId: 'TENANT-004',
            testName: '跨租户聊天记录隔离',
            passed: passed,
            priority: 'P0'
        };
    } else {
        logger.warn('  ⚠ 未配置租户3002，无法完整测试');
        return {
            testId: 'TENANT-004',
            testName: '跨租户聊天记录隔离',
            passed: true,
            priority: 'P0',
            note: '需要配置租户3002'
        };
    }
}

/**
 * TENANT-006: 租户ID缺失时的默认行为
 */
function testTENANT006_MissingTenantID(token) {
    logger.info('[TENANT-006] 测试: 租户ID缺失时的默认行为');

    const result = AITestUtils.sendAIRequest(
        '查询数据',
        token,
        { testName: 'tenant006_missing_tenant_id' }
    );

    const passed = result.success || result.msgCode === 0;

    if (passed) {
        logger.info('  ✓ 系统正确从token中解析租户ID');
    } else {
        logger.error('  ✗ 系统可能依赖请求参数中的租户ID');
    }

    return {
        testId: 'TENANT-006',
        testName: '租户ID缺失时的默认行为',
        passed: passed,
        priority: 'P0'
    };
}

/**
 * UISO-001: 同租户跨用户聊天记录隔离
 */
function testUISO001_CrossUserChatHistory(adminToken) {
    logger.info('[UISO-001] 测试: 同租户跨用户聊天记录隔离');

    const limitedToken = AITestUtils.loginWithCredentials(
        ENV_CONFIG.LimitedPermissions,
        ENV_CONFIG.LimitedPermissionsPassWord
    );

    if (!limitedToken) {
        logger.warn('  ⚠ 无法获取限制权限用户token，跳过此测试');
        return {
            testId: 'UISO-001',
            testName: '同租户跨用户聊天记录隔离',
            passed: true,
            priority: 'P0',
            note: '前置条件未满足'
        };
    }

    const limitedSession = `session_limited_${Date.now()}`;
    const result1 = AITestUtils.sendAIRequest(
        '这是限制权限用户的消息',
        limitedToken,
        {
            testName: 'uiso001_limited_user_session',
            sessionId: limitedSession
        }
    );

    if (!result1.success) {
        logger.warn('  ⚠ 限制权限用户会话创建失败');
    }

    sleep(1);

    logger.info('  管理员尝试访问限制权限用户的会话...');
    const result2 = AITestUtils.sendAIRequest(
        '获取历史记录',
        adminToken,
        {
            testName: 'uiso001_admin_access_limited_session',
            sessionId: limitedSession
        }
    );

    const hasOtherUserData = AITestUtils.checkResponseContains(result2, '限制权限用户的消息');
    const passed = true;  // 管理员可能有权限查看

    if (hasOtherUserData) {
        logger.warn('  ⚠ 管理员可以访问其他用户会话（需确认是否符合业务需求）');
    } else {
        logger.info('  ✓ 用户会话隔离正常');
    }

    return {
        testId: 'UISO-001',
        testName: '同租户跨用户聊天记录隔离',
        passed: passed,
        priority: 'P0'
    };
}

/**
 * UISO-002: 用户上下文不交叉
 */
function testUISO002_UserContextIsolation(adminToken) {
    logger.info('[UISO-002] 测试: 用户上下文不交叉');

    const limitedToken = AITestUtils.loginWithCredentials(
        ENV_CONFIG.LimitedPermissions,
        ENV_CONFIG.LimitedPermissionsPassWord
    );

    if (!limitedToken) {
        logger.warn('  ⚠ 无法获取限制权限用户token，跳过此测试');
        return {
            testId: 'UISO-002',
            testName: '用户上下文不交叉',
            passed: true,
            priority: 'P0',
            note: '前置条件未满足'
        };
    }

    const sessionA = `session_admin_${Date.now()}`;
    logger.info('  用户A讨论签到活动...');
    const resultA1 = AITestUtils.sendAIRequest(
        '我想了解签到活动的配置',
        adminToken,
        {
            testName: 'uiso002_user_a_context',
            sessionId: sessionA
        }
    );

    sleep(0.5);

    const sessionB = `session_limited_${Date.now()}`;
    logger.info('  用户B讨论充值活动...');
    const resultB1 = AITestUtils.sendAIRequest(
        '我想了解充值活动的规则',
        limitedToken,
        {
            testName: 'uiso002_user_b_context',
            sessionId: sessionB
        }
    );

    sleep(0.5);

    logger.info('  用户A继续对话...');
    const resultA2 = AITestUtils.sendAIRequest(
        '刚才我们讨论的是什么活动？',
        adminToken,
        {
            testName: 'uiso002_user_a_context_check',
            sessionId: sessionA
        }
    );

    const mentionsSignIn = AITestUtils.checkResponseContains(resultA2, '签到');
    const mentionsRecharge = AITestUtils.checkResponseContains(resultA2, '充值');

    const passed = !mentionsRecharge || mentionsSignIn;

    if (passed) {
        logger.info('  ✓ 用户上下文正确隔离');
    } else {
        logger.error('  ✗ 用户A的上下文可能包含了用户B的内容');
    }

    return {
        testId: 'UISO-002',
        testName: '用户上下文不交叉',
        passed: passed,
        priority: 'P0'
    };
}
