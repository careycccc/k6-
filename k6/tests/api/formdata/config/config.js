import { dateStringToTimestamp } from '../../../../tests/utils/utils.js';
// 报表查询的专属配置文件，用于存放一些全局的配置信息
export const fromOptions = {
    startTime: '2026-02-02',
    endTime: '2026-02-02',
    startTimeSecend: '2026-02-02 00:00:00',
    endTimeSecend: '2026-02-02 23:59:59',
    channelId: 500095,  // 用于渠道信息查询到时候
    startTimeLastdaySecend: '2026-02-03 00:00:00',
    endTimeLastdaySecend: '2026-02-03 23:59:59',
}
//将日期字符串转换为毫秒级时间戳
export const stringToTimestamp = {
    starttime: dateStringToTimestamp(fromOptions.startTimeSecend),
    endtime: dateStringToTimestamp(fromOptions.endTimeSecend)
}

