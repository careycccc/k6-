import { fromOptions } from '../../formdata/config/config.js';
import { commonRequest5 } from '../../formdata/config/formreqeust.js';
import { groupByAndSum } from '../../common/common.js';
import { logger } from '../../../../libs/utils/logger.js';
import { sleep } from 'k6'

export const rankingTag = 'ranking'


// 礼品码
let rankingInfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}

// 保存对象的结果集
let resultlist = []


/**
 * 查询会员排行榜的审核通过了的数据
*/
export function queryRanking(data) {
    const api = 'api/Rank/GetUserRankAuditList'

    //console.log('排行榜查询开始');

    // 重置排行榜信息
    rankingInfo.amount = 0;
    rankingInfo.amountUsercount = 0;
    rankingInfo.amountcountTotal = 0;

    // 重置结果列表
    resultlist = [];

    // 创建合并后的结果对象
    let mergedResult = {};

    // 用于存储每个 userId 出现的榜单次数
    let userRankCount = {};

    // 用于存储每个榜单的 userId 列表
    let rankUserIds = {
        1: [],
        2: [],
        3: []
    };
    // 找出在至少两个榜单中出现的 userId
    let commonUserIds = [];
    for (let i = 1; i <= 3; i++) {
        sleep(1)

        const payload = {
            rankDateMin: fromOptions.startTime,
            rankDateMax: fromOptions.endTime,
            rankType: i,  // 1:日榜 2:周榜 3:月榜
            state: 'Approved'
        }

        //console.log(`查询${i}榜参数:`, payload);

        const result = commonRequest5(data, api, payload, rankingTag)

        // 检查 result 是否有效
        if (!result) {
            logger.error(`查询${i}榜返回空结果`);
            continue;
        }

        //console.log(`查询${i}榜结果:`, result);

        // 检查 result.list 是否存在
        if (!result.list) {
            logger.error(`查询${i}榜的list不存在`);
            continue;
        }

        //console.log(`查询${i}榜结果长度:`, result.list.length);

        // 检查 result.list 是否为数组
        if (!Array.isArray(result.list)) {
            logger.error(`查询${i}榜的list不是数组`);
            continue;
        }

        // 累加总领奖次数
        rankingInfo.amountcountTotal += result.totalCount || 0;

        // 检查 list 是否有数据
        if (result.list.length > 0) {
            // 提取当前榜单的所有 userId
            const currentUserIds = result.list.map(item => item.userId);
            rankUserIds[i] = currentUserIds;

            //console.log(`查询${i}榜的用户ID列表:`, currentUserIds);

            // 检查当前榜单中是否有重复的 userId
            const uniqueUserIds = [...new Set(currentUserIds)];
            if (currentUserIds.length !== uniqueUserIds.length) {
                //console.log(`查询${i}榜的用户ID列表中有重复`);

                // 找出重复的 userId
                const userIdCount = {};
                const duplicateUserIds = [];
                for (const userId of currentUserIds) {
                    if (userIdCount[userId]) {
                        userIdCount[userId]++;
                        if (!duplicateUserIds.includes(userId)) {
                            duplicateUserIds.push(userId);
                            commonUserIds.push(userId);
                        }
                    } else {
                        userIdCount[userId] = 1;
                    }
                }

                console.log(`查询${i}榜中重复的会员ID:`, duplicateUserIds);
                //console.log(`查询${i}榜中重复的会员ID详情:`, userIdCount);
            }

            // 按照 userId 分组并累加 rewardAmount
            const groupResult = groupByAndSum(result.list, 'userId', 'rewardAmount')

            //console.log(`查询${i}榜分组结果:`, groupResult);

            resultlist.push(groupResult)

            // 记录每个 userId 出现的榜单次数
            for (const userId of Object.keys(groupResult.result || {})) {
                if (userRankCount[userId]) {
                    userRankCount[userId]++;
                } else {
                    userRankCount[userId] = 1;
                }
            }

            // 合并到 mergedResult
            for (const [userId, sum] of Object.entries(groupResult.result || {})) {
                if (mergedResult[userId]) {
                    mergedResult[userId] += sum;
                } else {
                    mergedResult[userId] = sum;
                }
            }
        } else {
            logger.error(`查询${i}榜的list为空`);
        }
    }

    //console.log('合并后的结果:', mergedResult);
    //console.log('每个榜单的用户ID列表:', rankUserIds);


    for (const [userId, count] of Object.entries(userRankCount)) {
        if (count >= 2) {
            commonUserIds.push(userId);
        }
    }

    console.log('在至少两个榜单中出现的会员ID:', commonUserIds);

    // 找出 1 榜和 2 榜中重复的 userId
    const duplicateUserIds = [];
    if (rankUserIds[1] && rankUserIds[2]) {
        for (const userId of rankUserIds[1]) {
            if (rankUserIds[2].includes(userId)) {
                duplicateUserIds.push(userId);
            }
        }
    }



    // 统计 resultlist 中所有对象的 count 和 sum 的总和
    let totalCount = 0;
    let totalSum = 0;

    //console.log('开始统计 resultlist:', resultlist);

    for (const item of resultlist) {
        // 检查 item 是否有效
        if (!item || typeof item !== 'object') {
            logger.error('item 无效，跳过:', item);
            continue;
        }

        // 累加 count
        if (item.count !== undefined && item.count !== null) {
            totalCount += item.count;
        }

        // 累加 sum
        if (item.sum !== undefined && item.sum !== null) {
            totalSum += item.sum;
        }
    }

    // 计算去重后的用户数量
    const uniqueUserCount = Object.keys(mergedResult).length;

    //console.log(`累加的count: ${totalCount}, 去重后的用户数量: ${uniqueUserCount}`);

    // 更新排行榜信息
    rankingInfo.amount = totalSum;
    rankingInfo.amountUsercount = uniqueUserCount;

    // 返回您需要的格式的对象
    const finalResult = {
        result: mergedResult,
        count: uniqueUserCount,
        sum: totalSum.toFixed(2),
        commonUserIds: commonUserIds  // 添加在至少两个榜单中出现的会员ID
    };

    console.log('排行榜统计结果:', finalResult);


    return finalResult;
}









