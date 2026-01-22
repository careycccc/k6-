import { systemJumpType } from '../common/type.js';
import { sendQueryRequest, sendRequest } from '../common/request.js';
import { logger } from '../../../libs/utils/logger.js';
import { sleep } from 'k6';

export const systemActiveTag = 'systemActiveTag'

// 新的jumpType
let newJumpType = [];

// 进行 systemJumpType 的改造
export function transformSystemJumpType(data) {
    const token = data.token;
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
    // 清空数组，避免多次调用时数据累积
    newJumpType = [];
    // 获取数据
    if (result && result.list && result.list.length > 0) {
        // 处理获取到的站内信列表
        result.list.forEach(item => {
            // 遍历 systemJumpType 数组，查找匹配的元素
            const matchedJumpType = systemJumpType.find(jumpType => jumpType.pageType === item.pageType);
            if (matchedJumpType) {
                newJumpType.push({
                    pageType: matchedJumpType.pageType,
                    title: item.titile,
                    pngAddress: matchedJumpType.pageType + '.png',
                    id: item.id, // 活动id
                });
            }
        });
    }
    return newJumpType;
}


// 创建系统活动
export function createSystemActive(data) {
    transformSystemJumpType(data);
    const len = newJumpType.length;
    const jumpTypeNumber = systemJumpType.length;
    if (len == 0 || len != jumpTypeNumber) {
        logger.error('新构造的newJumpType为空或长度不匹配，无法继续进行系统活动的创建');
        return
    }
    console.log('新构建的值', newJumpType)
    // 从data中获取数据
    const token = data.token;
    const api = '/api/ActivityInformation/Update'
    const src = data.uploadedSrc
    // 临时处理只有两个相等的时候才能进行编辑处理
    if (src.length > 0 && src.length == systemJumpType.length) {
        src.forEach((element, index) => {
            sleep(1)
            const payload = {
                "imgUrl": element,
                "informationType": 2,
                "title": systemJumpType[index].title,
                "sort": 0,
                "displayTarget": 1,
                "pageType": systemJumpType[index].pageType,
                "pageId": 0,
                "sysLanguage": "en",
                "id": systemJumpType[index].id,
                "content": "",
            }
            sendRequest(payload, api, systemActiveTag, false, token);
        });
    }
    sleep(3);
    // 点击启用
    newJumpType.forEach(item => {
        sleep(0.5)
        enableSystemActive(data, item.id, 1, 'en')
    })
}

// 启用系统活动
/**
 * @param {*} id 活动id. 
 * @param {*} state 活动状态.  1表示启动 0表示关闭
 * @param {*} sysLanguage 语言 默认 en 
 * 
 * 
*/
export function enableSystemActive(data, id, state, sysLanguage) {
    const token = data.token;
    const api = '/api/ActivityInformation/UpdateState'
    const payload = {
        id,
        state,
        sysLanguage,
    }
    sendRequest(payload, api, systemActiveTag, false, token);
}