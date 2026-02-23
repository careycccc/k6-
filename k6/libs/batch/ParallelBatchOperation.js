import { batch } from 'k6/http';
import { check } from 'k6';
import { logger } from '../utils/logger.js';
import { Trend, Counter } from 'k6/metrics';

// 自定义指标
const batchDuration = new Trend('batch_operation_duration');
const batchSuccess = new Counter('batch_operation_success');
const batchFailed = new Counter('batch_operation_failed');

/**
 * 并行批量操作类
 * 优化批量报表查询性能，支持并行执行
 */
export class ParallelBatchOperation {
    constructor(batchSize = 5) {
        this.batchSize = batchSize;
        this.results = [];
        this.metrics = {
            totalRequests: 0,
            successCount: 0,
            failedCount: 0,
            totalDuration: 0
        };
    }

    /**
     * 执行批量操作
     * @param {Array} reports - 报表配置数组
     * @param {string} token - 认证 token
     * @returns {Array} 执行结果数组
     */
    executeBatch(reports, token) {
        const startTime = Date.now();
        logger.info(`开始批量查询，共 ${reports.length} 个报表，批次大小: ${this.batchSize}`);

        // 分批并行执行
        for (let i = 0; i < reports.length; i += this.batchSize) {
            const batchReports = reports.slice(i, i + this.batchSize);
            const batchNum = Math.floor(i / this.batchSize) + 1;

            logger.info(`执行第 ${batchNum} 批，包含 ${batchReports.length} 个报表`);
            const batchResults = this.executeBatchGroup(batchReports, token);
            this.results.push(...batchResults);
        }

        const duration = Date.now() - startTime;
        this.metrics.totalDuration = duration;

        // 记录指标
        batchDuration.add(duration);

        logger.info(`批量查询完成，总耗时: ${duration}ms，平均: ${(duration / reports.length).toFixed(2)}ms`);
        logger.info(`成功: ${this.metrics.successCount}，失败: ${this.metrics.failedCount}`);

        return this.results;
    }

    /**
     * 执行单个批次
     */
    executeBatchGroup(reports, token) {
        const batchStartTime = Date.now();

        // 构建批量请求
        const requests = reports.map(report => {
            const url = report.func ? report.func.toString().match(/api\/[^'"]+/)?.[0] : '';
            return {
                method: 'POST',
                url: url || report.url,
                body: JSON.stringify(report.payload || {}),
                params: {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    tags: {
                        name: report.tag || report.title,
                        type: 'batch_report'
                    },
                    timeout: '30s'
                }
            };
        });

        // 并行执行请求
        const responses = batch(requests);
        const batchDuration = Date.now() - batchStartTime;

        // 处理响应
        return responses.map((response, index) => {
            this.metrics.totalRequests++;

            const success = check(response, {
                'status is 200': (r) => r.status === 200,
                'has response body': (r) => r.body && r.body.length > 0
            });

            if (success) {
                this.metrics.successCount++;
                batchSuccess.add(1);
            } else {
                this.metrics.failedCount++;
                batchFailed.add(1);
                logger.error(`报表查询失败: ${reports[index].title}, 状态码: ${response.status}`);
            }

            let data = null;
            try {
                data = success ? JSON.parse(response.body) : null;
            } catch (e) {
                logger.error(`解析响应失败: ${reports[index].title}, 错误: ${e.message}`);
            }

            return {
                tag: reports[index].tag || reports[index].title,
                title: reports[index].title,
                success: success,
                duration: response.timings.duration,
                data: data,
                error: success ? null : (response.error || `HTTP ${response.status}`),
                timestamp: new Date().toISOString()
            };
        });
    }

    /**
     * 获取执行统计
     */
    getMetrics() {
        return {
            ...this.metrics,
            successRate: (this.metrics.successCount / this.metrics.totalRequests * 100).toFixed(2) + '%',
            avgDuration: (this.metrics.totalDuration / this.metrics.totalRequests).toFixed(2) + 'ms'
        };
    }
}
