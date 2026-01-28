import { commonRequest3 } from '../config/formreqeust.js';
import { fromOptions } from '../config/config.js';
import { logger } from '../../../../libs/utils/logger.js';
import { gameBetData } from '../MemberReport/gameBettypeQuery.test.js';
import { sleep } from 'k6';

export const memberTag = 'memberTag'


const startTime = fromOptions.startTimeSecend
const endTime = fromOptions.endTimeSecend
const payload = {
    memberIdType: 1,
    pageSize: 200,
    startTime,
    endTime,
}

// 会员报表要返回的数据
let memberReportData = {
    MemberSummary: {}, //会员汇总报表的总计
    MemberGame: {}, //会员游戏报表的总计
    MemberActivity: {}, //会员活动报表的总计
    MemberRecharge: {
        R1: {}, //会员首充报表的总计
        R2: {}, //会员2充值报表的总计
        R3: {}, //会员3充值报表的总计
    }, //会员充值报表的总计
    MemberWithdraw: {
        W1: {},// 会员首提报表的总计
        W2: {},// 会员二提报表的总计
        W3: {}// 会员三提报表的总计
    }, //会员提现报表的总计
    MemberLogin: {}, //会员登录报表的总计
    memberGameProfitTotal: 0,// 会员盈亏 会员游戏
    winAmountSumTotal: 0,//  派奖金额的统计 游戏管理的游戏投注
    feeAmountSumTotal: 0,//手续费的统计  游戏管理的游戏投注
}


/**
 * 会员报表相关查询
*/
export function queryMemberReportFunc(data) {
    //查询游戏管理的游戏投注的数据
    const result = gameBetData(data)
    // 会员汇总数据查询
    const MemberSummarydata = MemberSummaryReport(data)
    memberReportData.MemberSummary = { ...MemberSummarydata.summary }
    // 会员游戏数据查询
    const MemberGamedata = MemberGame(data)
    memberReportData.MemberGame = { ...MemberGamedata.summary }
    // 会员活动数据查询
    const MemberActivitydata = MemberActivity(data)
    memberReportData.MemberActivity = { ...MemberActivitydata.summary }
    // 会员充值数据首充，二充，三充查询
    const R1result = MemberRecharge(data, 'R1')
    memberReportData.MemberRecharge.R1 = { ...R1result.summary }
    const R2result = MemberRecharge(data, 'R2')
    memberReportData.MemberRecharge.R2 = { ...R2result.summary }
    const R3result = MemberRecharge(data, 'R3')
    memberReportData.MemberRecharge.R3 = { ...R3result.summary }
    // 会员提现数据首提，二提，三提查询
    const W1result = MemberWithdraw(data, 'W1')
    memberReportData.MemberWithdraw.W1 = { ...W1result.summary }
    const W2result = MemberWithdraw(data, 'W2')
    memberReportData.MemberWithdraw.W2 = { ...W2result.summary }
    const W3result = MemberWithdraw(data, 'W3')
    memberReportData.MemberWithdraw.W3 = { ...W3result.summary }

    // 计算游戏投注占比
    const gameBetRatioResult = calculateGameBetRatio(result);

    // 会员报表的会员游戏的会员盈亏的累积
    let memberGameProfit = 0
    // 会员管理的投注报表
    // 派奖金额的统计
    let winAmountSum = 0
    // 手续费的统计
    let feeAmountSum = 0

    // 会员游戏查询
    const memberGameResult = MemberGame(data)

    // 在 memberReport.test.js 中，修改游戏数据对比部分
    // 检查 memberGameResult.summary.gameDataList 是否存在
    if (!memberGameResult.summary || !memberGameResult.summary.gameDataList) {
        logger.error('memberGameResult.summary.gameDataList 不存在');
        return memberReportData;
    }

    // 进行游戏数据对比
    for (const item of memberGameResult.summary.gameDataList) {
        sleep(0.5)
        const key = getValueByKey(item.itemName, result)


        // 检查 key 是否有效
        if (!key || typeof key !== 'object') {
            logger.info(`${item.itemName}没有数据`)
            continue;
        }

        // 添加对 item 字段的检查，使用默认值
        const itemBetAmount = item.betAmount || 0;
        const itemValidBetAmount = item.validBetAmount || item.validAmount || 0; // 添加备选字段名
        const itemWinLoseAmount = item.winLoseAmount || 0;

        // 检查 key 的属性是否存在，使用默认值
        const keyBetAmountSum = key.betAmountSum || 0;
        const keyValidAmountSum = key.validAmountSum || 0;
        const keyWinLoseAmount = key.winLoseAmount || 0;
        const keyWinAmountSum = key.winAmountSum || 0;
        const keyFeeAmountSum = key.feeAmountSum || 0;

        if (itemBetAmount != keyBetAmountSum) {
            logger.error(`会员游戏报表的${item.itemName}的投注金额${itemBetAmount}和游戏管理的投注金额:${keyBetAmountSum}对不上`)
            console.log('')
        }
        if (itemValidBetAmount != keyValidAmountSum) {
            logger.error(`会员游戏报表的${item.itemName}的有效投注金额${itemValidBetAmount}和游戏管理的有效投注金额:${keyValidAmountSum}对不上`)
            console.log('')
        }
        if (itemWinLoseAmount != keyWinLoseAmount) {
            logger.error(`会员游戏报表的${item.itemName}的会员盈亏金额${itemWinLoseAmount}和游戏管理的会员盈亏金额:${keyWinLoseAmount}对不上`)
            console.log('')
        }

        memberGameProfit += itemWinLoseAmount
        winAmountSum += keyWinAmountSum
        feeAmountSum += keyFeeAmountSum
    }

    // 四舍五入保留两位小数
    memberGameProfit = parseFloat(memberGameProfit.toFixed(2))
    winAmountSum = parseFloat(winAmountSum.toFixed(2))
    feeAmountSum = parseFloat(feeAmountSum.toFixed(2))

    memberReportData.memberGameProfitTotal = memberGameProfit
    memberReportData.winAmountSumTotal = winAmountSum
    memberReportData.feeAmountSumTotal = feeAmountSum


    // 将游戏投注占比添加到返回数据中
    memberReportData.gameBetRatio = gameBetRatioResult.gameBetRatio;
    memberReportData.totalBetAmount = gameBetRatioResult.totalBetAmount;

    return memberReportData
}


// 会员汇总
export function MemberSummaryReport(data) {
    const api = '/api/RptUserInfo/GetUserRptTotalPageList'
    return commonRequest3(data, api, payload, memberTag)
}
// 会员游戏
export function MemberGame(data) {
    const api = 'api/RptUserInfo/GetUserRptGamePageList'
    return commonRequest3(data, api, payload, memberTag)
}

// 会员活动
export function MemberActivity(data) {
    const api = '/api/RptUserInfo/GetUserRptActivityPageList'
    return commonRequest3(data, api, payload, memberTag)
}


/**
 * 会员二三充值
 * @param {string} type  R1 首充 R2 二充 R3 三充
*/
export function MemberRecharge(data, type) {
    const api = '/api/RptUserInfo/GetUserRptRechargePageList'
    const rechargePayload = {
        ...payload,
        type
    }
    return commonRequest3(data, api, rechargePayload, memberTag)
}

/**
 * 会员的首二三提
 * @param {string} type  W1 首充 W2 二充 W3 三充
*/
export function MemberWithdraw(data, type) {
    const api = '/api/RptUserInfo/GetUserRptWithdrawPageList'
    const rechargePayload = {
        ...payload,
        type
    }
    return commonRequest3(data, api, rechargePayload, memberTag)
}


// 会员登录
export function MemberLogin(data) {
    const api = '/api/RptUserInfo/GetUserLoginLogPageList'
    return commonRequest3(data, api, payload, memberTag)
}



/**
 * 根据键名获取对象中对应的值
 * @param {string} key - 要查找的键名
 * @param {Object} obj - 要查找的对象
 * @returns {*} 如果找到匹配的键，则返回对应的值；否则返回 undefined
 */
export function getValueByKey(key, obj) {
    // 检查参数是否有效
    if (typeof key !== 'string' || typeof obj !== 'object' || obj === null) {
        console.error('无效的参数：key 必须是字符串，obj 必须是对象');
        return undefined;
    }

    // 检查对象中是否存在该键
    if (key in obj) {
        return obj[key];
    }

    // 如果键不存在，返回 undefined
    return undefined;
}


// 在 memberReport.test.js 中添加计算游戏投注占比的函数
/**
 * 计算游戏投注占比
 * @param {Object} gameBetData - 游戏投注数据
 * @returns {Object} 包含各游戏类型投注占比的对象
 */
export function calculateGameBetRatio(gameBetData) {
    // 计算总投注金额
    let totalBetAmount = 0;
    const gameBetRatio = {};

    // 遍历所有游戏类型，计算总投注金额
    for (const [gameType, data] of Object.entries(gameBetData)) {
        if (data && data.betAmountSum) {
            totalBetAmount += data.betAmountSum;
        }
    }

    // 计算各游戏类型的投注占比
    for (const [gameType, data] of Object.entries(gameBetData)) {
        if (data && data.betAmountSum) {
            gameBetRatio[gameType] = {
                betAmount: data.betAmountSum,
                ratio: totalBetAmount > 0 ? (data.betAmountSum / totalBetAmount * 100).toFixed(2) + '%' : '0%'
            };
        } else {
            gameBetRatio[gameType] = {
                betAmount: 0,
                ratio: '0%'
            };
        }
    }

    return {
        totalBetAmount,
        gameBetRatio
    };
}

