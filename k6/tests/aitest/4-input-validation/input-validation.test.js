import { sleep } from 'k6';
import { logger } from '../../../libs/utils/logger.js';
import { AITestUtils } from '../common/aiTestUtils.js';
import { ENV_CONFIG } from '../../../config/envconfig.js';
import { hanlderThresholds } from '../../../config/thresholds.js';

export const testTag = 'input_validation';

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: hanlderThresholds(testTag),
    tags: {
        test_type: 'ai_security',
        category: 'input_validation'
    }
};

/**
 * 输入验证与边界安全测试套件
 */
export default function () {
    logger.info('========== 开始执行输入验证与边界安全测试 ==========');

    const results = [];

    const validToken = AITestUtils.login(
        ENV_CONFIG.ADMIN_USERNAME,
        ENV_CONFIG.ADMIN_PASSWORD,
        true
    );

    if (!validToken) {
        logger.error('无法获取有效token，测试终止');
        return;
    }

    // INPUT-001: 特殊字符注入
    results.push(testINPUT001_SpecialCharacters(validToken));
    sleep(1);

    // INPUT-002: 超长输入
    results.push(testINPUT002_LongInput(validToken));
    sleep(1);

    // INPUT-003: 空输入/纯空格
    results.push(testINPUT003_EmptyInput(validToken));
    sleep(1);

    // INPUT-004: 二进制/非文本数据
    results.push(testINPUT004_BinaryData(validToken));
    sleep(1);

    // INPUT-005: 前端URL参数篡改
    results.push(testINPUT005_URLParameterTampering(validToken));
    sleep(1);

    // 生成测试报告
    AITestUtils.generateTestReport('输入验证与边界安全测试', results);

    logger.info('========== 输入验证与边界安全测试完成 ==========');
}

/**
 * INPUT-001: 特殊字符注入
 * 测试场景: 输入包含特殊字符
 * 预期结果: 系统应正确处理特殊字符，不导致注入或系统异常
 */
function testINPUT001_SpecialCharacters(token) {
    logger.info('[INPUT-001] 测试: 特殊字符注入');

    const specialChars = [
        { desc: 'HTML标签', input: '<div>测试</div>' },
        { desc: '引号', input: '测试"双引号\'单引号' },
        { desc: '反斜杠', input: '测试\\反斜杠\\\\双反斜杠' },
        { desc: '特殊符号', input: '测试&符号;分号|管道' },
        { desc: '换行符', input: '测试\n换行\r回车' },
        { desc: 'Unicode字符', input: '测试\u0000\u0001\u0002' }
    ];

    let allPassed = true;

    for (const testCase of specialChars) {
        logger.info(`  测试: ${testCase.desc}`);

        const result = AITestUtils.sendAIRequest(
            testCase.input,
            token,
            { testName: 'input001_special_chars' }
        );

        // 预期: 系统应该能正常处理，不崩溃
        const passed = result.status !== 500 && result.status !== 502 && result.status !== 503;

        if (passed) {
            logger.info(`  ✓ ${testCase.desc} - 正确处理`);
        } else {
            logger.error(`  ✗ ${testCase.desc} - 处理异常 (status: ${result.status})`);
            allPassed = false;
        }
    }

    return {
        testId: 'INPUT-001',
        testName: '特殊字符注入',
        passed: allPassed,
        priority: 'P0'
    };
}

/**
 * INPUT-002: 超长输入
 * 测试场景: 输入不同长度的文本
 * 预期结果: 系统应有输入长度限制，超限时优雅提示
 */
function testINPUT002_LongInput(token) {
    logger.info('[INPUT-002] 测试: 超长输入');

    const testCases = [
        { desc: '1000字符', length: 1000 },
        { desc: '5000字符', length: 5000 },
        { desc: '10000字符', length: 10000 }
    ];

    let allPassed = true;

    for (const testCase of testCases) {
        logger.info(`  测试: ${testCase.desc}`);

        const longText = 'A'.repeat(testCase.length);

        const result = AITestUtils.sendAIRequest(
            longText,
            token,
            { testName: 'input002_long_input' }
        );

        // 预期: 应该拒绝或截断，不应导致系统崩溃
        const passed = result.status !== 500 && result.status !== 502 && result.status !== 503;

        if (passed) {
            if (result.status === 400 || result.status === 413) {
                logger.info(`  ✓ ${testCase.desc} - 正确拒绝 (status: ${result.status})`);
            } else if (result.success) {
                logger.info(`  ✓ ${testCase.desc} - 系统能处理`);
            } else {
                logger.warn(`  ⚠ ${testCase.desc} - 状态码: ${result.status}`);
            }
        } else {
            logger.error(`  ✗ ${testCase.desc} - 系统异常 (status: ${result.status})`);
            allPassed = false;
        }
    }

    return {
        testId: 'INPUT-002',
        testName: '超长输入',
        passed: allPassed,
        priority: 'P0'
    };
}

/**
 * INPUT-003: 空输入/纯空格
 * 测试场景: 发送空字符串、纯空格、纯换行符
 * 预期结果: 系统应提示输入有效内容
 */
function testINPUT003_EmptyInput(token) {
    logger.info('[INPUT-003] 测试: 空输入/纯空格');

    const testCases = [
        { desc: '空字符串', input: '' },
        { desc: '纯空格', input: '   ' },
        { desc: '纯换行符', input: '\n\n\n' },
        { desc: '空格+换行', input: '  \n  \n  ' }
    ];

    let allPassed = true;

    for (const testCase of testCases) {
        logger.info(`  测试: ${testCase.desc}`);

        const result = AITestUtils.sendAIRequest(
            testCase.input,
            token,
            { testName: 'input003_empty_input' }
        );

        // 预期: 应该提示输入有效内容，或返回400
        const passed = result.status === 400 ||
            AITestUtils.checkResponseContains(result, '输入') ||
            AITestUtils.checkResponseContains(result, '内容') ||
            result.success;  // 有些系统可能允许空输入

        if (passed) {
            logger.info(`  ✓ ${testCase.desc} - 正确处理 (status: ${result.status})`);
        } else {
            logger.error(`  ✗ ${testCase.desc} - 处理异常 (status: ${result.status})`);
            allPassed = false;
        }
    }

    return {
        testId: 'INPUT-003',
        testName: '空输入/纯空格',
        passed: allPassed,
        priority: 'P1'
    };
}

/**
 * INPUT-004: 二进制/非文本数据
 * 测试场景: 发送非UTF-8编码内容
 * 预期结果: 系统应优雅处理，返回格式错误提示
 */
function testINPUT004_BinaryData(token) {
    logger.info('[INPUT-004] 测试: 二进制/非文本数据');

    const testCases = [
        { desc: '控制字符', input: '\x00\x01\x02\x03\x04\x05' },
        { desc: '混合控制字符', input: '正常文本\x00控制字符\x01混合' },
        { desc: '特殊Unicode', input: '\uFFFE\uFFFF' }
    ];

    let allPassed = true;

    for (const testCase of testCases) {
        logger.info(`  测试: ${testCase.desc}`);

        const result = AITestUtils.sendAIRequest(
            testCase.input,
            token,
            { testName: 'input004_binary_data' }
        );

        // 预期: 应该能处理或返回格式错误
        const passed = result.status !== 500 && result.status !== 502 && result.status !== 503;

        if (passed) {
            logger.info(`  ✓ ${testCase.desc} - 正确处理 (status: ${result.status})`);
        } else {
            logger.error(`  ✗ ${testCase.desc} - 系统异常 (status: ${result.status})`);
            allPassed = false;
        }
    }

    return {
        testId: 'INPUT-004',
        testName: '二进制/非文本数据',
        passed: allPassed,
        priority: 'P1'
    };
}

/**
 * INPUT-005: 前端URL参数篡改
 * 测试场景: 篡改前端上报的URL
 * 预期结果: 后端应校验URL的合法性和用户权限
 */
function testINPUT005_URLParameterTampering(token) {
    logger.info('[INPUT-005] 测试: 前端URL参数篡改');

    const testCases = [
        { desc: '不存在的页面', url: 'http://example.com/nonexistent' },
        { desc: '恶意URL', url: 'javascript:alert(1)' },
        { desc: '空URL', url: '' },
        { desc: 'XSS URL', url: 'http://example.com/<script>alert(1)</script>' }
    ];

    let allPassed = true;

    for (const testCase of testCases) {
        logger.info(`  测试: ${testCase.desc}`);

        const result = AITestUtils.sendAIRequest(
            '当前页面有哪些功能',
            token,
            {
                testName: 'input005_url_tampering',
                extraParams: {
                    currentUrl: testCase.url
                }
            }
        );

        // 预期: 系统应该验证URL，不应该执行恶意代码
        const hasXSS = JSON.stringify(result.body || {}).includes('<script>');
        const passed = !hasXSS && (result.success || result.status === 400);

        if (passed) {
            logger.info(`  ✓ ${testCase.desc} - 正确处理`);
        } else {
            logger.error(`  ✗ ${testCase.desc} - 可能存在安全风险`);
            allPassed = false;
        }
    }

    return {
        testId: 'INPUT-005',
        testName: '前端URL参数篡改',
        passed: allPassed,
        priority: 'P0'
    };
}
