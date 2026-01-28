import { dateStringToTimestamp } from '../../../../tests/utils/utils.js';
// 报表查询的专属配置文件，用于存放一些全局的配置信息
export const fromOptions = {
    startTime: '2026-01-01',
    endTime: '2026-01-28',
    startTimeSecend: '2026-01-28 00:00:00',
    endTimeSecend: '2026-01-28 23:59:59',
    channelId: 500095,  // 用于渠道信息查询到时候
}
//将日期字符串转换为毫秒级时间戳
export const stringToTimestamp = {
    starttime: dateStringToTimestamp(fromOptions.startTimeSecend),
    endtime: dateStringToTimestamp(fromOptions.endTimeSecend)
}

