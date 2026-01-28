import { commonRequest5 } from '../../formdata/config/formreqeust.js';


//锦标赛
let championInfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}

export const championTag = 'champion'

export function queryChampion(data) {
    const api = '/api/Champion/GetPageList'
    // 完成的，进行中
    const payload = {
        activityState: 3,
        isCompleted: true,
        rewardState: 2,
    }
    const result = commonRequest5(data, api, payload, championTag)
    championInfo.amountcountTotal = result.totalCount
    // 必须找到状态是已派发的
    // 找到所有状态是已派发的项
    const distributedList = result.list.filter(item => {
        return item.rewardStateName === 'Distributed';
    });

    // 检查 distributedList 是否有效
    if (!distributedList || distributedList.length === 0) {
        console.log('没有找到已派发的锦标赛');
        return championInfo;
    }
    // 获取总派发金额
    distributedList.forEach(ele => {
        championInfo.amount += ele.totalBonus
    });

    return championInfo
}