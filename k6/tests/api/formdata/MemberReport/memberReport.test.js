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
    memberGameProfitTotal: 0,// 会员盈亏 会游戏
    winAmountSumTotal: 0,//  派奖金额的统计 游戏管理的游戏投注
    feeAmountSumTotal: 0,//手续费的统计  游戏管理的游戏投注
}

/**
 * 会员报表查询
*/
export function memberReport(data) {
    const result = commonRequest3('/memberReport', data, memberTag)
    if (result.code != 0) {
        logger.error(`会员报表查询失败,${result.msg}`)
        return
    }
    // 会员汇总查询
}

/**
 * 会员报表相关查询
*/
export function queryMemberReportFunc(data) {
    //游戏管理的游戏投注数据
    const result = gameBetData(data)
    // 会员报表的会员游戏的会员盈亏的累积
    let memberGameProfit = 0
    // 会员管理的投注报表
    // 派奖金额的统计
    let winAmountSum = 0
    // 手续费的统计
    let feeAmountSum = 0
    // 会员汇总查询
    const memberResult = MemberSummaryReport(data)
    if (memberResult.list && memberResult.list.length > 0) {
        memberReportData.MemberSummary = { ...memberResult.summary }
    }
    // 会员游戏查询
    const memberGameResult = MemberGame(data)

    if (memberGameResult.list && memberGameResult.list.length > 0) {
        memberReportData.MemberGame = { ...memberGameResult.summary }
        // 进行游戏数据对比
        for (const item of memberGameResult.summary.gameDataList) {
            sleep(0.5)
            const key = getValueByKey(item.itemName, result)
            if (key == null || key == undefined) {
                logger.info(`${item.itemName}没有数据`)
                continue;
            }
            const keyBetAmountSum = key.betAmountSum || 0;
            const keyValidAmountSum = key.validAmountSum || 0;
            const keyWinLoseAmount = key.winLoseAmount || 0;
            const keyWinAmountSum = key.winAmountSum || 0;
            const keyFeeAmountSum = key.feeAmountSum || 0;


            if (item.betAmount != keyBetAmountSum) {
                logger.error(`会员游戏报表的${item.itemName}的投注金额${item.betAmount}和游戏管理的游戏投注投注金额:${keyBetAmountSum}对不上`)
                console.log('')
            }
            if (item.validAmount != keyValidAmountSum) {
                logger.error(`会员游戏报表的${item.itemName}的有效投注金额${item.validAmount}和游戏管理的游戏投注有效投注金额:${keyValidAmountSum}对不上`)
                console.log('')
            }
            if (item.winLoseAmount != keyWinLoseAmount) {
                logger.error(`会员游戏报表的${item.itemName}的会员盈亏金额${item.winLoseAmount}和游戏管理的游戏投注会员盈亏金额:${keyWinLoseAmount}对不上`)
                console.log('')
            }

            memberGameProfit += item.winLoseAmount
            winAmountSum += keyWinAmountSum
            feeAmountSum += keyFeeAmountSum
        }
        memberGameProfit = parseFloat(memberGameProfit.toFixed(2))
        winAmountSum = parseFloat(winAmountSum.toFixed(2))
        feeAmountSum = parseFloat(feeAmountSum.toFixed(2))
        memberReportData.memberGameProfitTotal = memberGameProfit
        memberReportData.winAmountSumTotal = winAmountSum
        memberReportData.feeAmountSumTotal = feeAmountSum
    }
    // 会员活动查询
    const memberActivityResult = MemberActivity(data)
    if (memberActivityResult.list && memberActivityResult.list.length > 0) {
        memberReportData.MemberActivity = { ...memberActivityResult.summary }
    }
    // 会员充值查询
    const memberRechargeResult = MemberRecharge(data, 'R1')
    if (memberRechargeResult.list && memberRechargeResult.list.length > 0) {
        memberReportData.MemberRecharge.R1 = { ...memberRechargeResult.summary }
    }
    const memberRechargeResult2 = MemberRecharge(data, 'R2')
    if (memberRechargeResult2.list && memberRechargeResult2.list.length > 0) {
        memberReportData.MemberRecharge.R2 = { ...memberRechargeResult2.summary }
    }
    const memberRechargeResult3 = MemberRecharge(data, 'R3')
    if (memberRechargeResult3.list && memberRechargeResult3.list.length > 0) {
        memberReportData.MemberRecharge.R3 = { ...memberRechargeResult3.summary }
    }
    // 会员提现查询
    const memberWithdrawResult = MemberWithdraw(data, 'W1')
    if (memberWithdrawResult.list && memberWithdrawResult.list.length > 0) {
        memberReportData.MemberWithdraw.W1 = { ...memberWithdrawResult.summary }
    }
    const memberWithdrawResult2 = MemberWithdraw(data, 'W2')
    if (memberWithdrawResult2.list && memberWithdrawResult2.list.length > 0) {
        memberReportData.MemberWithdraw.W2 = { ...memberWithdrawResult2.summary }
    }
    const memberWithdrawResult3 = MemberWithdraw(data, 'W3')
    if (memberWithdrawResult3.list && memberWithdrawResult3.list.length > 0) {
        memberReportData.MemberWithdraw.W3 = { ...memberWithdrawResult3.summary }
    }
    // 会员登录查询
    const memberLoginResult = MemberLogin(data)
    if (memberLoginResult.list && memberLoginResult.list.length > 0) {
        memberReportData.MemberLogin = { ...memberLoginResult.summary }
        memberReportData.MemberLogin.totalCount = memberLoginResult.totalCount // 会员登录的次数
    }
    // 会员汇总的活动和会员活动进行比较
    const memberSummaryActivityAmount = memberReportData.MemberSummary.totalActivityAmount
    const memberActivityAmount = memberReportData.MemberActivity.totalAllActivityAmount
    if (memberSummaryActivityAmount != memberActivityAmount) {
        logger.error(`会员汇总的活动${memberSummaryActivityAmount}和会员活动${memberActivityAmount}的活动总金额不相等`)
    }
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
