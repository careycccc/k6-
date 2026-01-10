import { systemJumpType } from '../common/type.js';
import { sendQueryRequest } from '../common/request.js';
import { logger } from '../../../libs/utils/logger.js';

export const systemActiveTag = 'systemActiveTag'

// 新的jumpType
let newJumpType = [];

// 进行 systemJumpType 的改造
export function transformSystemJumpType(data) {
    const token = data.token;
    const jumpTypeNumber = systemJumpType.length;
    const api = '/api/ActivityInformation/GetPageList'
    const payload = {
        activityType: 0,
        pageSize: 50,
        sysLanguage: "en",
    }
    // 发送查询
    let result = sendQueryRequest(payload, api, systemActiveTag, false, token);
    if (typeof result !== 'object') {
        result = JSON.parse(result);
    }
    // 获取数据
    if (result && result.list && result.list.length > 0) {
        if (result.list.length != jumpTypeNumber) {
            logger.error('查询的系统活动条数和type.js里面的条数不一致');
            return
        }
        // 处理获取到的站内信列表
        result.list.forEach(item => {
            if (item.pageType == systemJumpType.pageType) {
                newJumpType.push({
                    ...item,
                    id: item.id
                });
            }
        });
    }
    return newJumpType;
}

// 创建系统活动
export function createSystemActive(data) {
    transformSystemJumpType(data);
    if (newJumpType.length == 0) {
        logger.error('新构造的newJumpType为空');
        return
    }
    console.log('新构建的值', newJumpType)
    // 从data中获取数据
    // const token = data.token;
    // const api = '/api/ActivityInformation/Update'
    // const src = data.uploadedSrc
    // // 临时处理只有两个相等的时候才能进行编辑处理
    // if (src.length > 0 && src.length == systemJumpType.length) {
    //     src.forEach((element, index) => {
    //         const payload = {
    //             "imgUrl": element,
    //             "informationType": 2,
    //             "title": systemJumpType[index].title,
    //             "sort": 0,
    //             "displayTarget": 1,
    //             "pageType": systemJumpType[index].pageType,
    //             "pageId": 0,
    //             "sysLanguage": "en",
    //             "id": systemJumpType[index].id,
    //             "content": "",
    //         }
    //     });
    // }
}