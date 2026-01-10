import { getUploadFileName } from '../uploadFile/uploadInmail.js';
import { createInmail as createInmailFunc, couponTag, startInmail as startInmailFunc } from '../message/sitmessage.test.js';
// 执行站内信相关操作

// 全局标记，用于跟踪场景1的执行状态
let scenario1Success = false;

let token = ""
let uploadedUrls = [],  // 返回上传成功后的文件路径表
    uploadedSrc = [],
    uploadResults = {}
export function setup() {
    return {
        token,
        uploadedUrls,
        uploadedSrc,
        uploadResults
    } = getUploadFileName();
}

export function createInmail(data) {
    // 在这里添加创建站内信的逻辑
    try {
        const result = createInmailFunc(data);
        if (result) {
            scenario1Success = true; // 标记场景1成功
        }
    } catch (error) {
        logger.error('创建站内信失败[没有获取到优惠券的id]:', error);
        throw new Error(`创建站内信失败[没有获取到优惠券的id]: ${error.message}`);
    }
}

export function startInmail(data) {
    if (!scenario1Success) {
        logger.info('场景1失败，跳过场景2执行');
        return;
    }
    // 在这里添加创建站内信的逻辑
    startInmailFunc(data);
}

export const options = {
    scenarios: {
        //场景1：创建站内信
        createInmail: {
            executor: 'shared-iterations',
            vus: 1,
            iterations: 1,
            exec: 'createInmail',
            startTime: '1s'
        },
        //场景2：启动站内信
        startInmail: {
            executor: 'shared-iterations',
            vus: 1,
            iterations: 1,
            exec: 'startInmail',
            startTime: '5s'
        }
    },
};

export default function () { }

