//import { getUploadFileName } from '../uploadFile/uploadSystemActive.js';
import { createSystemActive as createSystemActiveFunc } from '../../api/activity/systemActive.test.js'
import { logger } from '../../../libs/utils/logger.js';
import { AdminLogin } from '../login/adminlogin.test.js';
// 执行系统活动的相关操作


let token = ""
let uploadedUrls = [],  // 返回上传成功后的文件路径表
    uploadedSrc = [],
    uploadResults = {}
export function setup() {
    try {
        const token = AdminLogin();

        if (!token) {
            logger.error('AdminLogin 返回空值，登录失败');
            throw new Error('AdminLogin 返回空 token');
        }
        return { token };
    } catch (error) {
        logger.error('AdminLogin 发生异常:', error.message);
        throw new Error(`登录失败: ${error.message}`);
    }
}
// export function setup() {
//     return {
//         token,
//         uploadedUrls,
//         uploadedSrc,
//         uploadResults
//     } = getUploadFileName();
// }

export function createSystemActive(data) {
    createSystemActiveFunc(data);
}

export const options = {
    scenarios: {
        // 场景1：后台登录
        login: {
            executor: 'shared-iterations',
            vus: 1,
            iterations: 1, // 只运行一次
            maxDuration: '10s'
        },
        // 场景2：创建系统活动
        createSystemActive: {
            executor: 'shared-iterations',
            vus: 1,
            iterations: 1, // 只运行一次
            exec: 'createSystemActive', // 指向实际的函数名
            startTime: '5s' // 等待setup完成后执行
        }
    }
}


export default function () { }