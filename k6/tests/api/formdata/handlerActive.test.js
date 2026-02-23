import { logger } from '../../../libs/utils/logger.js';


// 在文件顶部添加 handlerActivefunc 函数定义
/**
 * 处理活动数据对比
 * @param {Object} memberActivityData - 会员活动数据
 * @param {Array} dataStatisticsActivityList - 数据统计活动列表
 * @param {Object} dailyActiveSummary - 每日活动汇总
 * @param {Array} args[0] 所有后台活动的查询结果统计
 */
export function handlerActivefunc(memberActivityData, dataStatisticsActivityList, dailyActiveSummary, ...args) {
    try {
        // 检查参数是否有效
        const dataStatisticsActivityData = dataStatisticsActivityList.length
        const dailyActiveSummaryData = dailyActiveSummary.list.length

        if (dataStatisticsActivityData < 0) {
            logger.error('dataStatisticsActivityList 参数无效');
            console.log('')
            return;
        }

        if (dailyActiveSummaryData < 0) {
            logger.error('dailyActiveSummary 参数无效');
            console.log('')
            return;
        }
        // 检查 memberActivityData 是否为空对象
        if (Object.keys(memberActivityData).length === 0) {
            logger.info('memberActivityData 会员活动数据为空');
            console.log('')
            return;
        }


        // 比较两个活动数组
        const mismatches = compareActivityArrays(dataStatisticsActivityList, dailyActiveSummary.list);

        // 输出比较结果
        if (mismatches.length === 0) {
            logger.info('两个活动数组完全匹配');
        } else {
            console.log('发现不匹配的活动数据:');
            mismatches.forEach((mismatch, index) => {
                console.log(`不匹配 ${index + 1}: ${mismatch.reason}`);
                console.log('数据统计活动列表:', mismatch.item1);
                console.log('每日活动:', mismatch.item2);
                console.log('');
            });
        }

        const dailytotalActivityAmount = dailyActiveSummary.summary.totalActivityAmount
        // 比较每日活动的活动金额 和 会员活动的金额
        if (dailytotalActivityAmount.toFixed(2) != memberActivityData.totalAllActivityAmount) {
            logger.error(`每日活动的活动金额:${dailytotalActivityAmount} 和 会员活动的金额${memberActivityData.totalAllActivityAmount} 不匹配`);
            console.log('')
        }
        let activeLists = []
        if (args.length > 0) {
            activeLists = args[0]
            // 获取的数据直接和每日活动报表里面的数据进行比较
            console.log('')
            console.log('获取的数据----', activeLists)
            console.log('')
            console.log('')
            console.log('____***&*', memberActivityData)
            console.log('')
        }
    } catch (error) {
        logger.error('handlerActivefunc 参数无效:', error.message);
    }
}


/**
 * 比较两个活动数组
 * @param {Array} array1 - 第一个活动数组
 * @param {Array} array2 - 第二个活动数组
 * @returns {Array} 返回不匹配的对象数组，每个元素包含两个不匹配的对象
 */
function compareActivityArrays(array1, array2) {
    // 检查参数是否有效
    if (!Array.isArray(array1) || !Array.isArray(array2)) {
        console.error('参数必须是数组');
        return [];
    }

    const mismatches = [];

    // 遍历第一个数组
    for (const item1 of array1) {
        // 在第二个数组中查找匹配的 activityType
        const item2 = array2.find(item => item.activityType === item1.activityType);

        // 如果找不到匹配的 activityType，记录不匹配
        if (!item2) {
            mismatches.push({
                item1,
                item2: null,
                reason: `在第二个数组中找不到 activityType 为 ${item1.activityType} 的对象`
            });
            continue;
        }

        // 比较三个属性值
        const amountMatch = item1.amount === item2.activityAmount;
        const countMatch = item1.count === item2.activityCount;
        const userCountMatch = item1.userCount === item2.userCount;

        // 如果任何一个属性不匹配，记录不匹配
        if (!amountMatch || !countMatch || !userCountMatch) {
            mismatches.push({
                item1,
                item2,
                reason: `activityType ${item1.activityType} 的属性不匹配: ` +
                    `amount(${item1.amount} vs ${item2.activityAmount}), ` +
                    `count(${item1.count} vs ${item2.activityCount}), ` +
                    `userCount(${item1.userCount} vs ${item2.userCount})`
            });
        }
    }

    // 检查第二个数组中是否有第一个数组中没有的 activityType
    for (const item2 of array2) {
        const item1 = array1.find(item => item.activityType === item2.activityType);

        if (!item1) {
            mismatches.push({
                item1: null,
                item2,
                reason: `在第一个数组中找不到 activityType 为 ${item2.activityType} 的对象`
            });
        }
    }

    return mismatches;
}

