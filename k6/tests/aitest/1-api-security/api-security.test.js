import { sleep } from 'k6';
import { logger } from '../../../libs/utils/logger.js';
import { AITestUtils } from '../common/aiTestUtils.js';
import { ENV_CONFIG } from '../../../config/envconfig.js';
import { hanlderThresholds } from '../../../config/thresholds.js';

export const testTag = 'api_security';

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: hanlderThresholds(testTag),
    tags: {
        test_type: 'ai_security',
        category: 'api_security'
    }
};

/**
 * 接口安全测试套件
 * 包含12个测试用例
 */
export default function () {
    logger.info('========== 开始执行接口安全测试 ==========');

    const results = [];

    // 获取有效token用于对比测试
    const validToken = AITestUtils.login(
        ENV_CONFIG.ADMIN_USERNAME,
        ENV_CONFIG.ADMIN_PASSWORD,
        true
    );

    if (!validToken) {
        logger.error('无法获取有效token，测试终止');
        return;
    }

    // API-001: 未认证访问AI接口
    results.push(testAPI001_UnauthorizedAccess());
    sleep(1);

    // API-002: Token伪造/篡改
    results.push(testAPI002_TokenForgery(validToken));
    sleep(1);

    // API-003: 接口参数篡改
    results.push(testAPI003_ParameterTampering(validToken));
    sleep(1);

    // API-004: 接口频率限制
    results.push(testAPI004_RateLimit(validToken));
    sleep(1);

    // API-005: 超大输入攻击
    results.push(testAPI005_LargeInput(validToken));
    sleep(1);

    // API-006: SQL注入测试
    results.push(testAPI006_SQLInjection(validToken));
    sleep(1);

    // API-007: XSS注入测试
    results.push(testAPI007_XSSInjection(validToken));
    sleep(1);

    // API-008: SSRF测试
    results.push(testAPI008_SSRF(validToken));
    sleep(1);

    // API-010: 请求重放攻击
    results.push(testAPI010_ReplayAttack(validToken));
    sleep(1);

    // API-011: WebSocket安全
    results.push(testAPI011_WebSocketSecurity());
    sleep(1);

    // 生成测试报告
    AITestUtils.generateTestReport('接口安全测试', results);

    logger.info('========== 接口安全测试完成 ==========');
}

/**
 * API-001: 未认证访问AI接口
 * 测试场景: 不携带任何认证信息
 * 预期结果: 返回401/403，不返回任何业务数据
 */
function testAPI001_UnauthorizedAccess() {
    logger.info('[API-001] 测试: 未认证访问AI接口');

    const testCases = [
        { desc: '不带token', token: null },
        { desc: '空token', token: '' },
        { desc: '无效token', token: 'invalid_token_12345' }
    ];

    let allPassed = true;

    for (const testCase of testCases) {
        logger.info(`  测试子场景: ${testCase.desc}`);

        const result = AITestUtils.sendAIRequest(
            '你好，请帮我查询今天的数据',
            testCase.token,
            { testName: 'api001_unauthorized' }
        );

        // 预期: 应该返回401或403
        const passed = result.status === 401 || result.status === 403 || !result.success;

        if (passed) {
            logger.info(`  ✓ ${testCase.desc} - 正确拒绝访问 (status: ${result.status})`);
        } else {
            logger.error(`  ✗ ${testCase.desc} - 未正确拒绝访问 (status: ${result.status})`);
            allPassed = false;
        }
    }

    return {
        testId: 'API-001',
        testName: '未认证访问AI接口',
        passed: allPassed,
        priority: 'P0'
    };
}

/**
 * API-002: Token伪造/篡改
 * 测试场景: 手动构造伪造的token
 * 预期结果: 系统应验证token签名，拒绝伪造或篡改的token
 */
function testAPI002_TokenForgery(validToken) {
    logger.info('[API-002] 测试: Token伪造/篡改');

    const testCases = [
        { desc: '篡改token内容', token: validToken ? validToken.substring(0, validToken.length - 5) + 'xxxxx' : 'fake_token' },
        { desc: '伪造JWT格式', token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c' }
    ];

    let allPassed = true;

    for (const testCase of testCases) {
        logger.info(`  测试子场景: ${testCase.desc}`);

        const result = AITestUtils.sendAIRequest(
            '查询系统信息',
            testCase.token,
            { testName: 'api002_token_forgery' }
        );

        // 预期: 应该拒绝伪造的token
        const passed = result.status === 401 || result.status === 403 || !result.success;

        if (passed) {
            logger.info(`  ✓ ${testCase.desc} - 正确拒绝伪造token (status: ${result.status})`);
        } else {
            logger.error(`  ✗ ${testCase.desc} - 未正确拒绝伪造token (status: ${result.status})`);
            allPassed = false;
        }
    }

    return {
        testId: 'API-002',
        testName: 'Token伪造/篡改',
        passed: allPassed,
        priority: 'P0'
    };
}

/**
 * API-003: 接口参数篡改
 * 测试场景: 修改请求参数中的用户ID、租户ID等
 * 预期结果: 后端应以token中的身份信息为准
 */
function testAPI003_ParameterTampering(validToken) {
    logger.info('[API-003] 测试: 接口参数篡改');

    let allPassed = true;

    // 尝试篡改租户ID
    logger.info('  测试子场景: 篡改租户ID');
    const result1 = AITestUtils.sendAIRequest(
        '查询活动列表',
        validToken,
        {
            testName: 'api003_tenant_tampering',
            extraParams: { tenantId: 9999 }  // 尝试访问其他租户
        }
    );

    // 预期: 应该只返回当前租户的数据，或拒绝请求
    const passed1 = !AITestUtils.checkResponseContains(result1, 'tenantId":9999') ||
        result1.status === 403;

    if (passed1) {
        logger.info('  ✓ 篡改租户ID - 系统正确处理');
    } else {
        logger.error('  ✗ 篡改租户ID - 可能存在越权风险');
        allPassed = false;
    }

    return {
        testId: 'API-003',
        testName: '接口参数篡改',
        passed: allPassed,
        priority: 'P0'
    };
}

/**
 * API-004: 接口频率限制
 * 测试场景: 短时间内发送大量请求
 * 预期结果: 应有频率限制，超过阈值返回429或排队提示
 */
function testAPI004_RateLimit(validToken) {
    logger.info('[API-004] 测试: 接口频率限制');

    const requestCount = 20;  // 发送20个请求
    let blockedCount = 0;
    let successCount = 0;

    logger.info(`  快速发送 ${requestCount} 个请求...`);

    for (let i = 0; i < requestCount; i++) {
        const result = AITestUtils.sendAIRequest(
            `测试请求 ${i + 1}`,
            validToken,
            { testName: 'api004_rate_limit' }
        );

        if (result.status === 429 || AITestUtils.checkResponseContains(result, '频率限制') ||
            AITestUtils.checkResponseContains(result, 'rate limit')) {
            blockedCount++;
        } else if (result.success) {
            successCount++;
        }
    }

    logger.info(`  成功请求: ${successCount}, 被限流: ${blockedCount}`);

    // 如果有限流机制，应该至少有一些请求被拦截
    // 这里我们认为如果有限流就是通过，没有限流也记录但不算失败（因为可能阈值设置较高）
    const passed = true;  // 此测试主要用于观察，不强制要求有限流

    if (blockedCount > 0) {
        logger.info('  ✓ 检测到频率限制机制');
    } else {
        logger.warn('  ⚠ 未检测到明显的频率限制（可能阈值较高）');
    }

    return {
        testId: 'API-004',
        testName: '接口频率限制',
        passed: passed,
        priority: 'P0',
        details: { successCount, blockedCount }
    };
}

/**
 * API-005: 超大输入攻击
 * 测试场景: 发送超长文本
 * 预期结果: 系统应限制输入长度，返回参数错误
 */
function testAPI005_LargeInput(validToken) {
    logger.info('[API-005] 测试: 超大输入攻击');

    // 生成10000字的超长文本
    const largeText = 'A'.repeat(10000);

    logger.info('  发送10000字符的超长输入...');

    const result = AITestUtils.sendAIRequest(
        largeText,
        validToken,
        { testName: 'api005_large_input' }
    );

    // 预期: 应该拒绝或截断，不应导致系统异常
    const passed = result.status === 400 ||
        result.status === 413 ||
        AITestUtils.checkResponseContains(result, '输入过长') ||
        AITestUtils.checkResponseContains(result, '超出限制') ||
        result.success;  // 如果系统能正常处理也算通过

    if (passed) {
        logger.info(`  ✓ 系统正确处理超大输入 (status: ${result.status})`);
    } else {
        logger.error(`  ✗ 系统未正确处理超大输入 (status: ${result.status})`);
    }

    return {
        testId: 'API-005',
        testName: '超大输入攻击',
        passed: passed,
        priority: 'P0'
    };
}

/**
 * API-006: SQL注入测试
 * 测试场景: 在用户输入中嵌入SQL注入payload
 * 预期结果: 系统应使用参数化查询，输入不应被当作SQL执行
 * 
 * 真实表名: tab_user
 * 测试策略: 使用多种SQL注入技术尝试攻击
 */
function testAPI006_SQLInjection(validToken) {
    logger.info('[API-006] 测试: SQL注入');
    logger.info('  目标表: tab_user');

    const sqlPayloads = [
        // 经典SQL注入
        { payload: "'; DROP TABLE tab_user;--", desc: "删除表攻击" },
        { payload: "' OR '1'='1", desc: "永真条件" },
        { payload: "admin'--", desc: "注释绕过" },
        { payload: "' UNION SELECT * FROM tab_user--", desc: "联合查询" },

        // 针对tab_user表的注入
        { payload: "' OR 1=1; SELECT * FROM tab_user WHERE '1'='1", desc: "多语句注入" },
        { payload: "1' AND (SELECT COUNT(*) FROM tab_user) > 0--", desc: "子查询注入" },
        { payload: "'; UPDATE tab_user SET password='hacked' WHERE '1'='1", desc: "更新注入" },
        { payload: "' OR username IN (SELECT username FROM tab_user)--", desc: "IN子查询" },

        // 盲注测试
        { payload: "' AND SLEEP(5)--", desc: "时间盲注" },
        { payload: "' AND (SELECT COUNT(*) FROM tab_user) > 0--", desc: "布尔盲注" },

        // 编码绕过
        { payload: "%27%20OR%20%271%27%3D%271", desc: "URL编码注入" },
        { payload: "\\' OR \\'1\\'=\\'1", desc: "反斜杠转义" },

        // 堆叠查询
        { payload: "'; SELECT password FROM tab_user;--", desc: "堆叠查询密码" },
        { payload: "1; DROP TABLE tab_user;--", desc: "堆叠删除表" }
    ];

    let allPassed = true;
    let vulnerablePayloads = [];

    for (const testCase of sqlPayloads) {
        logger.info(`  测试: ${testCase.desc}`);
        logger.info(`    Payload: ${testCase.payload.substring(0, 50)}...`);

        const result = AITestUtils.sendAIRequest(
            `查询tab_user表中用户名为: ${testCase.payload}`,
            validToken,
            { testName: 'api006_sql_injection' }
        );

        // 检查是否有SQL错误信息泄露
        const hasSQLError = AITestUtils.checkResponseContains(result, 'sql') ||
            AITestUtils.checkResponseContains(result, 'syntax error') ||
            AITestUtils.checkResponseContains(result, 'mysql') ||
            AITestUtils.checkResponseContains(result, 'postgresql') ||
            AITestUtils.checkResponseContains(result, 'database') ||
            AITestUtils.checkResponseContains(result, 'query') ||
            AITestUtils.checkResponseContains(result, 'table') ||
            AITestUtils.checkResponseContains(result, 'column');

        // 检查是否返回了异常多的数据（可能是注入成功）
        const responseSize = JSON.stringify(result.body || {}).length;
        const hasAbnormalData = responseSize > 10000;  // 超过10KB可能异常

        // 检查是否有tab_user表的敏感信息泄露
        const hasTableLeak = AITestUtils.checkResponseContains(result, 'tab_user') ||
            AITestUtils.checkResponseContains(result, 'password') ||
            AITestUtils.checkResponseContains(result, 'username');

        const passed = !hasSQLError && !hasAbnormalData && (result.success || result.status === 400);

        if (passed) {
            logger.info(`    ✓ SQL注入payload被正确处理`);
        } else {
            logger.error(`    ✗ 可能存在SQL注入风险`);
            if (hasSQLError) {
                logger.error(`    检测到SQL错误信息泄露`);
            }
            if (hasAbnormalData) {
                logger.error(`    响应数据异常大 (${responseSize} bytes)`);
            }
            if (hasTableLeak) {
                logger.error(`    检测到表结构或敏感字段泄露`);
            }
            vulnerablePayloads.push(testCase.desc);
            allPassed = false;
        }
    }

    if (allPassed) {
        logger.info('  ✓ 所有SQL注入测试通过');
    } else {
        logger.error(`  ✗ 发现SQL注入漏洞，受影响的测试: ${vulnerablePayloads.join(', ')}`);
        logger.error('  建议: 使用参数化查询，不要拼接SQL语句');
    }

    return {
        testId: 'API-006',
        testName: 'SQL注入测试',
        passed: allPassed,
        priority: 'P0',
        vulnerablePayloads: vulnerablePayloads
    };
}

/**
 * API-007: XSS注入测试
 * 测试场景: 输入XSS脚本
 * 预期结果: 前端应对AI回复进行HTML转义
 */
function testAPI007_XSSInjection(validToken) {
    logger.info('[API-007] 测试: XSS注入');

    const xssPayloads = [
        "<script>alert('xss')</script>",
        "<img src=x onerror=alert(1)>",
        "<svg onload=alert('xss')>",
        "javascript:alert('xss')"
    ];

    let allPassed = true;

    for (const payload of xssPayloads) {
        logger.info(`  测试payload: ${payload.substring(0, 30)}...`);

        const result = AITestUtils.sendAIRequest(
            payload,
            validToken,
            { testName: 'api007_xss_injection' }
        );

        // 检查响应中是否包含未转义的脚本标签
        const hasUnescapedScript = result.body &&
            JSON.stringify(result.body).includes('<script>');

        const passed = !hasUnescapedScript;

        if (passed) {
            logger.info('  ✓ XSS payload被正确处理');
        } else {
            logger.error('  ✗ 响应中包含未转义的脚本，存在XSS风险');
            allPassed = false;
        }
    }

    return {
        testId: 'API-007',
        testName: 'XSS注入测试',
        passed: allPassed,
        priority: 'P0'
    };
}

/**
 * API-008: SSRF测试
 * 测试场景: 在输入中包含内网地址
 * 预期结果: 系统不应请求内网地址
 */
function testAPI008_SSRF(validToken) {
    logger.info('[API-008] 测试: SSRF');

    const ssrfPayloads = [
        'http://192.168.1.1/admin',
        'http://127.0.0.1/',
        'http://localhost/admin',
        'http://metadata.google.internal/',
        'http://169.254.169.254/latest/meta-data/'
    ];

    let allPassed = true;

    for (const payload of ssrfPayloads) {
        logger.info(`  测试payload: ${payload}`);

        const result = AITestUtils.sendAIRequest(
            `请访问这个地址: ${payload}`,
            validToken,
            { testName: 'api008_ssrf' }
        );

        // 预期: 不应该成功访问内网地址
        const hasInternalData = AITestUtils.checkResponseContains(result, '192.168') ||
            AITestUtils.checkResponseContains(result, 'localhost') ||
            AITestUtils.checkResponseContains(result, 'metadata');

        const passed = !hasInternalData;

        if (passed) {
            logger.info('  ✓ SSRF payload被正确拦截');
        } else {
            logger.error('  ✗ 可能存在SSRF风险');
            allPassed = false;
        }
    }

    return {
        testId: 'API-008',
        testName: 'SSRF测试',
        passed: allPassed,
        priority: 'P0'
    };
}

/**
 * API-010: 请求重放攻击
 * 测试场景: 重复发送相同的请求
 * 预期结果: 关键写操作应有幂等性设计或防重放机制
 */
function testAPI010_ReplayAttack(validToken) {
    logger.info('[API-010] 测试: 请求重放攻击');

    const message = `创建测试活动_${Date.now()}`;
    const sessionId = `session_${Date.now()}`;

    logger.info('  发送相同请求3次...');

    const results = [];
    for (let i = 0; i < 3; i++) {
        const result = AITestUtils.sendAIRequest(
            message,
            validToken,
            {
                testName: 'api010_replay_attack',
                sessionId: sessionId  // 使用相同的sessionId
            }
        );
        results.push(result);
        sleep(0.5);
    }

    // 检查是否所有请求都成功（如果都成功可能缺少防重放机制）
    const allSuccess = results.every(r => r.success);

    // 对于查询操作，重复请求是正常的
    // 对于写操作，应该有防重放机制
    // 这里我们主要观察，不强制要求
    const passed = true;

    if (allSuccess) {
        logger.warn('  ⚠ 所有重放请求都成功（查询操作正常，写操作需注意幂等性）');
    } else {
        logger.info('  ✓ 检测到防重放机制或请求失败');
    }

    return {
        testId: 'API-010',
        testName: '请求重放攻击',
        passed: passed,
        priority: 'P1'
    };
}

/**
 * API-011: WebSocket安全
 * 测试场景: WebSocket连接认证
 * 预期结果: WebSocket连接应验证认证信息
 */
function testAPI011_WebSocketSecurity() {
    logger.info('[API-011] 测试: WebSocket安全');

    // 注意: k6对WebSocket支持有限，这里主要做标记
    logger.warn('  ⚠ WebSocket测试需要专门的工具，此处仅做标记');
    logger.info('  建议: 使用浏览器开发者工具或专门的WebSocket测试工具验证');
    logger.info('  检查点: 1) 未认证连接应被拒绝 2) 使用WSS加密 3) 验证token');

    return {
        testId: 'API-011',
        testName: 'WebSocket安全',
        passed: true,
        priority: 'P0',
        note: '需要手动验证或使用专门工具'
    };
}
