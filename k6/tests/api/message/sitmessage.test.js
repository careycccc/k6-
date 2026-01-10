import { sendRequest, sendQueryRequest } from '../common/request.js';
import { jumpType } from '../common/type.js';
import { sleep } from 'k6';
//站内信
export const couponTag = 'inmail';

// 创建站内信
export function createInmail(data) {
    const api = '/api/Inmail/Add';
    // 必须接收 data 参数来拿 token
    const token = data.token;
    const couponList = [];

    jumpType.forEach(({ id, name }) => {
        //logger.info(`ID: ${id}, Name: ${name}`);
        couponList.push([name + '站内信', data.uploadedSrc[0], data.uploadedUrls[0], { id, name }]);
    });
    // 优惠券的id,需要先执行优惠券
    const couponIds = null;
    // dataSrc是完整的带有域名的地址
    // imgSrc是图片的相对路径
    couponList.forEach(([inmailName, dataSrc, imgSrc, { id, name }]) => {
        const payload = {
            "backstageDisplayName": inmailName,
            "validType": 1,
            "jumpType": 3,
            "jumpPage": id,
            "jumpButtonText": name,
            "targetType": 1,
            "translations": [
                {
                    "language": "hi",
                    "content": `<p><img data-src=\"${dataSrc}\" src=\"${dataSrc}\" data-image-id=\"img0\" style=\"vertical-align: baseline;\">${inmailName}</p>`,
                    "title": inmailName,
                    "thumbnail": imgSrc
                },
                {
                    "language": "en",
                    "content": `<p><img data-src=\"${dataSrc}\" src=\"${dataSrc}\" data-image-id=\"img1\" style=\"vertical-align: baseline;\">${inmailName}</p>`,
                    "title": inmailName,
                    "thumbnail": imgSrc
                },
                {
                    "language": "zh",
                    "content": `<p><img data-src=\"${dataSrc}\" src=\"${dataSrc}\" data-image-id=\"img0\" style=\"vertical-align: baseline;\">${inmailName}</p>`,
                    "title": inmailName,
                    "thumbnail": imgSrc
                }
            ],
            "sendType": 1,
            "isHasReward": true,
            "rewardConfig": {
                "freeReward": {
                    "rewardAmount": 103,
                    "amountCodingMultiple": 2,
                    "couponIds": couponIds
                },
                "rewardTypes": [1, 2],
                "rechargeReward": {
                    "rechargeAmount": 1000,
                    "rechargeCount": 1,
                    "rewardAmount": 1003,
                    "amountCodingMultiple": 2,
                    "couponIds": couponIds
                },
                "expireType": 1
            },
        };
        sendRequest(payload, api, couponTag, false, token);
    });
    return true;
}

// 启动站内信
export function startInmail(data) {
    const api = '/api/Inmail/GetPageList';
    // 必须接收 data 参数来拿 token
    const token = data.token;
    // 获取站内信列表
    const payload = {}
    //发送查询请求
    let result = sendQueryRequest(payload, api, couponTag, false, token);
    //logger.info('---获取站内信列表:', result);
    // 判断 result 的 typeof 是不是对象
    if (typeof result !== 'object') {
        result = JSON.parse(result);
    }
    const idList = [];
    if (result && result.list && result.list.length > 0) {
        // 处理获取到的站内信列表
        result.list.forEach(item => {
            idList.push(item.id);
        });
    }
    // 启动站内信
    idList.forEach(id => {
        //睡眠1s
        sleep(1);
        startInmailById(id, token);
    });
}

//点击启动
function startInmailById(id, token) {
    const api = '/api/Inmail/UpdateState';
    const payload = {
        state: 1,
        id: id
    };
    const result = sendRequest(payload, api, couponTag, false, token);
    logger.info(`${id} 启动站内信结果:`, JSON.stringify(result));
}
