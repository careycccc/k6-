import { sendQueryRequest } from '../../common/request.js';
import { fromOptions } from '../config/config.js';
import { dateStringToTimestamp } from '../../../../tests/utils/utils.js';
import { logger } from '../../../../libs/utils/logger.js';

const gameBetQueryTag = 'gameBetQueryTag'

export let gameBetInfoData = {
    Electronic: {}, // 电子类
    Video: {},// 真人视讯
    Sports: {},// 体育
    Lottery: {},// 彩票
    ChessCard: {} // 棋牌
}



/**
 查询游戏管理的游戏投注的数据
 * @param {Obect} options 请求的数据
 * @returns {Obect} 查询的结果
 * 
*/
export function queryGameBet(data, options) {
    const api = '/api/ThirdGame/GetBetRecordPageList'
    const payload = {
        ...options
    }
    let result = sendQueryRequest(payload, api, gameBetQueryTag, false, data.token)
    if (typeof result != 'object') {
        result = JSON.parse(result)
    }

    // 检查响应数据结构
    if (result && result.data && result.data.sum) {
        if (result.list && result.list.length > 0) {
            return {
                data: result.data,
                list: result.list
            }
        } else {
            // 即使list为空，如果sum存在，仍然返回sum
            return {
                data: result.data,
                list: []
            }
        }
    }

    return {}
}


/**
 * 查询游戏管理的游戏投注的数据
*/
export function gameBetData(data) {
    // 根据上面对象的长度进行调用
    const elementCount = Object.keys(gameBetInfoData).length;
    const start = fromOptions.startTimeSecend;
    const end = fromOptions.endTimeSecend;
    const beginTimeUnix = dateStringToTimestamp(start)
    const endTimeUnix = dateStringToTimestamp(end)
    for (let i = 0; i < elementCount - 1; i++) {
        let options = {
            beginTimeUnix,
            endTimeUnix,
            categoryType: i,
            orderState: 1,
            queryTimeType: 'SettleTime',
            sortField: 'BetTime'
        }
        const reslult = queryGameBet(data, options)
        // 检查 result 是否有效
        if (!reslult || !reslult.data || !reslult.data.sum) {
            console.log(`categoryType ${i} 没有数据`);
            continue;
        }
        switch (i) {
            case 0:
                gameBetInfoData.Electronic = { ...reslult.data.sum }
                break;
            case 1:
                gameBetInfoData.Video = { ...reslult.data.sum }
                break;
            case 2:
                gameBetInfoData.Sports = { ...reslult.data.sum }
                break;
            case 3:
                gameBetInfoData.Lottery = { ...reslult.data.sum }
                break;
            case 4:
                gameBetInfoData.ChessCard = { ...reslult.data.sum }
                break;
            default:
                break;
        }
    }
    return gameBetInfoData;
}