import { BatchReportOperation } from '../../../libs/batch/BatchOperationBase.js';
import { createActivityConfigs } from '../../../config/activities.js';
import { getUploadFileName } from '../uploadFile/uploadInmail.js';

/**
 * 根据优先级对活动配置进行排序
 * @returns {Array} 排序后的活动配置数组
 */
function getActivitiesByPriority() {
    return createActivityConfigs.sort((a, b) => a.priority - b.priority);
}

// 创建活动批量操作实例
const activityOperation = new BatchReportOperation();

// 导出配置选项
export const options = activityOperation.getOptions();

// 导出指标
export const metrics = activityOperation.metrics;

// 导出setup函数
export function setup() {
    console.log('\n开始初始化批量创建活动系统...\n');

    // 1. 获取基础数据（token）
    const baseData = activityOperation.setup();

    // 2. 上传站内信所需的图片
    console.log('\n[站内信] 开始上传图片资源...');
    try {
        const uploadData = getUploadFileName();

        console.log('[站内信] ✓ 图片上传成功');
        console.log(`[站内信] 上传文件数: ${uploadData.uploadedUrls.length}`);

        // 合并数据
        return {
            ...baseData,
            uploadedSrc: uploadData.uploadedSrc,
            uploadedUrls: uploadData.uploadedUrls,
            uploadResults: uploadData.uploadResults
        };
    } catch (error) {
        console.log(`[站内信] ⚠️  图片上传失败: ${error.message}`);
        console.log('[站内信] 站内信活动将被跳过');

        // 即使上传失败，也返回基础数据，让其他活动继续执行
        return {
            ...baseData,
            uploadedSrc: [],
            uploadedUrls: []
        };
    }
}

// 导出主执行函数
export default function (data) {
    const activityList = getActivitiesByPriority();

    // 定义执行函数，支持跳过逻辑
    function executeActivity(activity, data) {
        const result = activity.func(data);

        // 检查返回结果，如果 success 为 false，则跳过该活动
        if (result && result.success === false) {
            console.log(`[INFO] 跳过活动: ${activity.name} (${activity.tag}) - ${result.message || '未提供原因'}`);
            return {
                ...result,
                skipped: true,
                activityName: activity.name
            };
        }

        return {
            ...result,
            skipped: false,
            activityName: activity.name
        };
    }

    // 执行批量操作 - 串行模式（避免并发问题）
    const results = activityOperation.execute(data, activityList, executeActivity, {
        parallel: false,  // 禁用并行执行，使用串行模式
        batchSize: 5      // 串行模式下此参数无效
    });

    // 调试日志：记录结果
    try {
        const totalCount = Array.isArray(results) ? results.length : 0;
        const skippedCount = Array.isArray(results) ? results.filter(r => r.skipped).length : 0;
        const createdCount = totalCount - skippedCount;

        console.log('[DEBUG] batchCreateActivities: 执行完成');
        console.log(`[DEBUG] 总活动数: ${totalCount}, 已创建: ${createdCount}, 已跳过: ${skippedCount}`);

        // 输出跳过的活动列表
        if (skippedCount > 0) {
            const skippedActivities = results.filter(r => r.skipped);
            console.log('[DEBUG] 跳过的活动:');
            skippedActivities.forEach(activity => {
                console.log(`  - ${activity.activityName} (${activity.tag}): ${activity.message}`);
            });
        }

        console.log('[DEBUG] 活动创建结果:', JSON.stringify(results, null, 2));
    } catch (e) {
        console.error('[DEBUG] batchCreateActivities: 打印结果失败', e.message);
    }

    return results;
}

// 导出handleSummary函数
export function handleSummary(data) {
    return activityOperation.generateHandleSummary(data);
}
