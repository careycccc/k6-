import { sleep } from 'k6';
import { logger } from '../../libs/utils/logger.js';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

// 导入所有测试套件
import apiSecurityTest from './1-api-security/api-security.test.js';
import dataIsolationTest from './2-data-isolation/data-isolation.test.js';
import serverProbeTest from './3-server-probe/server-probe.test.js';
import inputValidationTest from './4-input-validation/input-validation.test.js';

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: {
        'http_req_duration': ['p(95)<5000'],
        'http_req_failed': ['rate<0.5']
    },
    tags: {
        test_type: 'ai_security_suite',
        environment: 'test'
    }
};

/**
 * AI安全测试 - 完整测试套件
 * 包含: 接口安全、数据隔离、服务器探测、输入验证
 */
export default function () {
    logger.info('\n');
    logger.info('╔═══════════════════════════════════════════════════════════╗');
    logger.info('║                                                           ║');
    logger.info('║          AI智能助手系统 - 安全测试套件                    ║');
    logger.info('║                                                           ║');
    logger.info('╚═══════════════════════════════════════════════════════════╝');
    logger.info('\n');

    const startTime = Date.now();

    // 1. 接口安全测试
    logger.info('【1/4】执行接口安全测试...');
    apiSecurityTest();
    sleep(2);

    // 2. 数据隔离测试
    logger.info('\n【2/4】执行数据隔离测试...');
    dataIsolationTest();
    sleep(2);

    // 3. 服务器探测测试
    logger.info('\n【3/4】执行服务器探测测试...');
    serverProbeTest();
    sleep(2);

    // 4. 输入验证与边界安全测试
    logger.info('\n【4/4】执行输入验证与边界安全测试...');
    inputValidationTest();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    logger.info('\n');
    logger.info('╔═══════════════════════════════════════════════════════════╗');
    logger.info('║                                                           ║');
    logger.info('║                    测试执行完成                           ║');
    logger.info('║                                                           ║');
    logger.info(`║              总耗时: ${duration} 秒                        ║`);
    logger.info('║                                                           ║');
    logger.info('╚═══════════════════════════════════════════════════════════╝');
    logger.info('\n');
}

export function handleSummary(data) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    return {
        stdout: textSummary(data, { indent: ' ', enableColors: true }),
        [`reports/ai-security-test-${timestamp}.html`]: htmlReport(data, {
            title: 'AI智能助手系统 - 安全测试报告'
        })
    };
}
