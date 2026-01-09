import { sendQueryRequest } from "../common/request.js";
import { ENV_CONFIG } from '../../../config/envconfig.js';
import { dateStringToTimestamp, isNonEmptyArray } from "../../utils/utils.js";


export const sixearnTag = 'sixearn';
// 6级代理
//直属一级的账号：
let firstLevelAccounts = [];
// 团队的所有账号
let allTeamAccounts = [];
// 自定义用户信息
let customUserInfo = {
    userId: 0,
    isFirstCharge: false,  // 是否首充
    betAmountSum: 0, // 总投注金额
    totalRechargeAmount: 0 // 总充值金额
};

// 直属一级的汇总
let firstLevelSummary = {
    registerUsers: 0, // 直属一级的注册用户数
    firstTotalNumber: 0, // 直属一级的总人数
    depUsers: 0, // 直属一级的充值用户数
    depAmount: 0, // 直属一级的总充值金额
    firstDepUsers: 0, // 直属一级的首充用户数
    betAmountSum: 0 // 直属一级的总投注金额
};

// 整个团队的汇总
let teamSummary = {
    registerUsers: 0, // 团队的注册用户数
    teamTotalNumber: 0, // 团队的总人数
    depUsers: 0, // 团队的充值用户数
    depAmount: 0, // 团队的总充值金额
    firstDepUsers: 0, // 团队的首充用户数
    betAmountSum: 0 // 团队的总投注金额 
};

// 查询该账号的下级账号
export function querySubAccounts(data) {
    // 必须接收 data 参数来拿 token
    const token = data.token;
    // 模拟查询下级账号的逻辑
    const api = '/api/Agent/GetPageListAgentList';
    const accountId = 134434;
    const payload = {
        userId: accountId,
        isAll: true,
        isIncludeSelfAndParent: true,
        pageSize: 200
    };
    let result = sendQueryRequest(payload, api, sixearnTag, false, token);
    if (typeof result !== 'object') {
        result = JSON.parse(result);
    }
    if (result && result.list && result.list.length > 0) {
        // 处理获取到的账号列表
        result.list.forEach(item => {
            if (item.hierarchy === 1) {
                // 直属一级的账号
                firstLevelAccounts.push(item.userId);
            }
            allTeamAccounts.push(item);
        });
    }
    const startTime = dateStringToTimestamp(ENV_CONFIG.START_TIME);
    const endTime = dateStringToTimestamp(ENV_CONFIG.END_TIME);
    let totalcustomUserInfo = []
    if (allTeamAccounts.length > 0) {
        allTeamAccounts.forEach(account => {
            const userInfo = getUserCurrentInfo(data, account.userId, startTime, endTime);
            userInfo.registerTime = account.registerTime;
            totalcustomUserInfo.push(userInfo);
        });
    }
    // 找出直属一级的用户信息
    const firstIncludes = totalcustomUserInfo.filter(info => {
        return firstLevelAccounts.includes(info.userId);
    });
    // 计算直属一级的汇总信息
    firstLevelSummary.firstTotalNumber = firstIncludes.length;
    firstIncludes.forEach(info => {
        if (info.totalRechargeAmount > 0) {
            firstLevelSummary.depUsers++;
            firstLevelSummary.totalRechargeAmount += info.totalRechargeAmount;
        }
        firstLevelSummary.betAmountSum += info.betAmountSum;
        if (info.isFirstCharge) {
            firstLevelSummary.firstDepUsers++;
        }
        // 记录注册人数
        if (info.registerTime >= startTime && info.registerTime <= endTime) {
            firstLevelSummary.registerUsers++;
        }
    });
    // 计算团队的汇总信息
    teamSummary.teamTotalNumber = totalcustomUserInfo.length;
    totalcustomUserInfo.forEach(info => {
        if (info.totalRechargeAmount > 0) {
            teamSummary.depUsers++;
            teamSummary.totalRechargeAmount += info.totalRechargeAmount;
        }
        teamSummary.depAmount += info.totalRechargeAmount;
        teamSummary.betAmountSum += info.betAmountSum;
        if (info.isFirstCharge) {
            teamSummary.firstDepUsers++;
        }
        // 记录注册人数
        if (info.registerTime >= startTime && info.registerTime <= endTime) {
            teamSummary.registerUsers++;
        }
    });
    console.log(`直属一级的汇总信息:注册人数：${firstLevelSummary.registerUsers},直属总一级人数：${firstLevelSummary.firstTotalNumber},充值人数：${firstLevelSummary.depUsers},充值金额：${firstLevelSummary.depAmount},首充人数：${firstLevelSummary.firstDepUsers},总投注金额：${firstLevelSummary.betAmountSum}`);
    console.log(`团队的汇总信息:注册人数：${teamSummary.registerUsers},团队总人数：${teamSummary.teamTotalNumber},充值人数：${teamSummary.depUsers},充值金额：${teamSummary.depAmount},首充人数：${teamSummary.firstDepUsers},总投注金额：${teamSummary.betAmountSum}`);
}

/**
 * 获取用户的当前信息
 * @param {number} userId - 用户ID
 * @param {number} startTime - 开始时间
 * @param {number} endTime - 结束时间
 * @returns {Object}  - 用户的当前信息
*/
export function getUserCurrentInfo(data, userId, startTime, endTime) {
    customUserInfo.userId = userId;
    // 1.查询账号的昨日的充值
    const toUpInfo = GetRechargeOrderPageList(data, userId, 'Payed', startTime, endTime);
    let totalRechargeAmount = 0;
    // 获取这个用户的当前的所有充值金额
    if (isNonEmptyArray(toUpInfo)) {
        toUpInfo.forEach(item => {
            totalRechargeAmount += item.actualAmount;
        });
    }
    customUserInfo.totalRechargeAmount = totalRechargeAmount;

    // 2.查询账号的投注
    const betInfo = GetBetRecordPageList(data, userId, startTime, endTime, 'BetTime', 'BetTime');
    if (typeof betInfo === 'object' && 'betAmountSum' in betInfo) {
        customUserInfo.betAmountSum = betInfo.betAmountSum;
    }
    // 3.查询账号的的首充信息
    const userRptRechargeInfo = GetUserRptRechargePageList(data, userId, 1, ENV_CONFIG.START_TIME, ENV_CONFIG.END_TIME);
    // 判断这个为一个列表
    if (isNonEmptyArray(userRptRechargeInfo)) {
        // 判断这个用户在当前时间内是否首充
        const isFirstCharge = userRptRechargeInfo.every(item => item.rechargeType === 'R1');
        if (isFirstCharge) {
            customUserInfo.isFirstCharge = true;
        }
    }

    return {
        ...customUserInfo,
    };
}


/** 
查询账号的昨日的充值
@param {Object} data - 前置数据里面有token
@param {number} userId - 用户ID
@param {string} rechargeState - 充值状态
@param {number} startTime - 开始时间
@param {number} endTime - 结束时间
@returns {Array}  - 充值订单列表，或者响应信息
*/
export function GetRechargeOrderPageList(data, userId, rechargeState, startTime, endTime) {
    const api = '/api/RechargeOrder/GetRechargeOrderPageList';
    const token = data.token;
    const payload = {
        rechargeState,
        userId,
        startTime,
        endTime,
    };
    let result = sendQueryRequest(payload, api, sixearnTag, false, token);
    if (typeof result !== 'object') {
        result = JSON.parse(result);
    }
    if (result && result.list && result.list.length > 0) {
        // 处理获取到的充值订单列表
        return result.list;
    }
    return result;
}


/**
 * 查询账号的昨日的投注,默认查询200条
 * @param {Object} data - 前置数据里面有token
 * @param {number} userId - 用户ID
 * @param {number} startTime - 开始时间
 * @param {number} endTime - 结束时间
 * @param {string} queryTimeType - 查询时间类型
 * @param {string} sortField - 排序字段
 * @returns {object}  - 投注订单{投注金额betAmountSum,有效投注validAmountSum,派奖金额 winAmountSum,盈亏winLoseAmount,税收feeAmountSum}，或者响应信息
*/
export function GetBetRecordPageList(data, userId, startTime, endTime, queryTimeType, sortField) {
    const api = '/api/ThirdGame/GetBetRecordPageList';
    const token = data.token;
    const payload = {
        queryTimeType,
        userId,
        beginTimeUnix: startTime,
        endTimeUnix: endTime,
        pageSize: 200,
        sortField,
    }
    let result = sendQueryRequest(payload, api, sixearnTag, false, token);
    if (typeof result !== 'object') {
        result = JSON.parse(result);
    }
    if (result && result.data && result.data.sum) {
        // 处理获取到的投注信息
        return result.data.sum;
    }

    return result;
}

/**
 在某个时间段内为首充,二充,三充
 * @param {Object} data - 前置数据里面有token
 * @param {number} userId - 用户ID
 * @param {number} memberIdType - 会员ID类型,默认 1
 * @param {number} startTime - 开始时间
 * @param {number} endTime - 结束时间
 * @returns {Array}  - 充值信息列表，或者响应信息
*/
export function GetUserRptRechargePageList(data, userId, memberIdType, startTime, endTime) {
    const api = '/api/RptUserInfo/GetUserRptRechargePageList';
    const token = data.token;
    const payload = {
        memberIdType,
        memberId: userId,
        startTime,
        endTime,
    };
    let result = sendQueryRequest(payload, api, sixearnTag, false, token);
    if (typeof result !== 'object') {
        result = JSON.parse(result);
    }
    if (result && result.list && result.list.length > 0) {
        // 处理获取到的充值信息
        return result.list;
    }
    return result;
}
