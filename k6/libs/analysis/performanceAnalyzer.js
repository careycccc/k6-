import { logger } from '../utils/logger.js';

/**
 * 性能分析器
 * 自动识别性能瓶颈并提供优化建议
 */
export class PerformanceAnalyzer {
    constructor(config = {}) {
        this.thresholds = {
            p95: config.p95Threshold || 2000,
            p99: config.p99Threshold || 5000,
            errorRate: config.errorRateThreshold || 0.05,
            minRPS: config.minRPS || 10
        };
    }

    /**
     * 分析测试结果
     * @param {Array} results - 测试结果数组
     * @returns {Object} 分析报告
     */
    analyze(results) {
        logger.info('开始性能分析...');

        const report = {
            summary: this.generateSummary(results),
            bottlenecks: this.identifyBottlenecks(results),
            recommendations: this.generateRecommendations(results),
            topSlowAPIs: this.getTopSlowAPIs(results, 10),
            topErrorAPIs: this.getTopErrorAPIs(results, 10),
            performanceScore: this.calculatePerformanceScore(results)
        };

        logger.info(`性能分析完成，综合评分: ${report.performanceScore}/100`);

        return report;
    }

    /**
     * 生成摘要
     */
    generateSummary(results) {
        const totalRequests = results.length;
        const successCount = results.filter(r => r.success).length;
        const failedCount = totalRequests - successCount;

        const durations = results.map(r => r.duration).filter(d => d !== undefined);
        const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
        const maxDuration = Math.max(...durations);
        const minDuration = Math.min(...durations);

        return {
            totalRequests,
            successCount,
            failedCount,
            successRate: ((successCount / totalRequests) * 100).toFixed(2) + '%',
            avgDuration: avgDuration.toFixed(2) + 'ms',
            maxDuration: maxDuration.toFixed(2) + 'ms',
            minDuration: minDuration.toFixed(2) + 'ms'
        };
    }

    /**
     * 识别性能瓶颈
     */
    identifyBottlenecks(results) {
        const bottlenecks = [];

        // 识别慢接口
        const slowAPIs = results.filter(r => r.duration > this.thresholds.p95);
        if (slowAPIs.length > 0) {
            bottlenecks.push({
                type: 'slow_response',
                severity: 'high',
                count: slowAPIs.length,
                percentage: ((slowAPIs.length / results.length) * 100).toFixed(2) + '%',
                apis: slowAPIs.slice(0, 5).map(api => ({
                    name: api.tag || api.title,
                    duration: api.duration.toFixed(2) + 'ms'
                })),
                suggestion: '优化数据库查询、增加缓存或考虑异步处理'
            });
        }

        // 识别高错误率
        const errorAPIs = results.filter(r => !r.success);
        if (errorAPIs.length > 0) {
            const errorRate = errorAPIs.length / results.length;
            bottlenecks.push({
                type: 'high_error_rate',
                severity: errorRate > 0.1 ? 'critical' : 'warning',
                count: errorAPIs.length,
                percentage: (errorRate * 100).toFixed(2) + '%',
                apis: errorAPIs.slice(0, 5).map(api => ({
                    name: api.tag || api.title,
                    error: api.error
                })),
                suggestion: '检查服务稳定性、错误处理逻辑和依赖服务状态'
            });
        }

        return bottlenecks;
    }

    /**
     * 生成优化建议
     */
    generateRecommendations(results) {
        const recommendations = [];
        const summary = this.generateSummary(results);

        // 基于平均响应时间的建议
        const avgDuration = parseFloat(summary.avgDuration);
        if (avgDuration > 1000) {
            recommendations.push({
                priority: 'high',
                category: 'performance',
                title: '整体响应时间偏高',
                description: `平均响应时间 ${avgDuration.toFixed(2)}ms 超过推荐值 1000ms`,
                impact: '用户体验差，可能导致超时',
                actions: [
                    '分析慢查询日志，优化数据库索引',
                    '实施 Redis 缓存策略',
                    '考虑数据库读写分离',
                    '优化业务逻辑，减少不必要的计算',
                    '考虑服务水平扩展'
                ],
                estimatedImprovement: '响应时间可降低 40-60%'
            });
        }

        // 基于成功率的建议
        const successRate = parseFloat(summary.successRate);
        if (successRate < 95) {
            recommendations.push({
                priority: 'critical',
                category: 'reliability',
                title: '服务可用性不足',
                description: `成功率 ${successRate}% 低于推荐值 95%`,
                impact: '严重影响业务连续性',
                actions: [
                    '增加服务健康检查',
                    '实施熔断和降级策略',
                    '增加重试机制',
                    '检查依赖服务的稳定性',
                    '增加监控告警'
                ],
                estimatedImprovement: '可用性可提升至 99%+'
            });
        }

        return recommendations;
    }

    /**
     * 获取最慢的 API
     */
    getTopSlowAPIs(results, limit = 10) {
        return results
            .filter(r => r.duration !== undefined)
            .sort((a, b) => b.duration - a.duration)
            .slice(0, limit)
            .map(r => ({
                name: r.tag || r.title,
                duration: r.duration.toFixed(2) + 'ms',
                success: r.success
            }));
    }

    /**
     * 获取错误最多的 API
     */
    getTopErrorAPIs(results, limit = 10) {
        const errorAPIs = results.filter(r => !r.success);
        const errorCounts = {};

        errorAPIs.forEach(api => {
            const name = api.tag || api.title;
            errorCounts[name] = (errorCounts[name] || 0) + 1;
        });

        return Object.entries(errorCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([name, count]) => ({ name, errorCount: count }));
    }

    /**
     * 计算性能评分 (0-100)
     */
    calculatePerformanceScore(results) {
        let score = 100;

        const summary = this.generateSummary(results);
        const avgDuration = parseFloat(summary.avgDuration);
        const successRate = parseFloat(summary.successRate);

        // 响应时间评分 (40分)
        if (avgDuration > 3000) score -= 40;
        else if (avgDuration > 2000) score -= 30;
        else if (avgDuration > 1000) score -= 20;
        else if (avgDuration > 500) score -= 10;

        // 成功率评分 (40分)
        if (successRate < 90) score -= 40;
        else if (successRate < 95) score -= 30;
        else if (successRate < 98) score -= 20;
        else if (successRate < 99) score -= 10;

        // 稳定性评分 (20分)
        const maxDuration = parseFloat(summary.maxDuration);
        if (maxDuration > avgDuration * 5) score -= 20;
        else if (maxDuration > avgDuration * 3) score -= 10;

        return Math.max(0, score);
    }
}
