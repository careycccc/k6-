import { commonRequest3 } from '../config/formreqeust.js';
import { fromOptions } from '../config/config.js';
import { logger } from '../../../../libs/utils/logger.js';

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
}

/**
 * 会员报表相关查询
*/
export function queryMemberReportFunc(data) {
    // 会员汇总查询
    const memberResult = MemberSummaryReport(data)
    if (memberResult.list && memberResult.list.length > 0) {
        memberReportData.MemberSummary = { ...memberResult.summary }
    }
    // 会员游戏查询
    const memberGameResult = MemberGame(data)
    if (memberGameResult.list && memberGameResult.list.length > 0) {
        memberReportData.MemberGame = { ...memberGameResult.summary }
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