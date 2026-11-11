/**
 * 下载APP奖励(DownloadPage) —— API封装层
 * 对应接口族：/api/DownloadPage/{GetSetting,UpdateSetting,GetRewardRecordPageList}
 *
 * 全部管理后台接口都要带 {forceTenant:true}，否则默认走集团路由会报
 * "Account type does not match the admin site"(msgCode=5/13208) —— 这是用
 * tenantAdminLogin(tenantId, true) 拿到的商户token跟集团域名路由不匹配导致的，
 * 不是接口本身的问题，详见 libs/http/groupRouting.js 的说明。
 */
import { httpClient } from '../../../../libs/http/client.js';
import { getTimeRandom, generateCryptoRandomString } from '../../../utils/utils.js';

/**
 * 查询下载奖励全部配置项
 * @param {string} adminToken
 * @returns {object} {settingKey: {settingKey, settingName, value1, value2}, ...}
 */
export function getDownloadRewardSetting(adminToken) {
    httpClient.setAuthToken(adminToken);
    const timeData = getTimeRandom();
    const resp = httpClient.post('/api/DownloadPage/GetSetting', {
        random: timeData.random, language: timeData.language, signature: '', timestamp: timeData.timestamp
    }, { forceTenant: true }, false);
    const body = JSON.parse(resp.body);
    return body.data || {};
}

/**
 * 更新单个下载奖励配置项
 * @param {string} adminToken
 * @param {string} settingKey
 * @param {string|number} value1
 * @param {string|number} [value2]
 */
export function updateDownloadRewardSetting(adminToken, settingKey, value1, value2 = '') {
    httpClient.setAuthToken(adminToken);
    const timeData = getTimeRandom();
    const resp = httpClient.post('/api/DownloadPage/UpdateSetting', {
        settingKey, value1, value2,
        random: timeData.random, language: timeData.language, signature: '', timestamp: timeData.timestamp
    }, { forceTenant: true }, false);
    return JSON.parse(resp.body);
}

/**
 * 自愈检查：对比当前配置跟期望值，不一致就警告+改回去。
 * 背景(2026-11-11实测)：当前测试环境租户3004是共享的，配置会被其他人/进程
 * 中途改动(实测抓到过一次DownloadRewardRechargeType被改回去)，所以每个关键
 * 步骤前都要做这个检查，不能只在最开头设置一次就假设它一直有效。
 * @param {string} adminToken
 * @param {Object<string, string|number>} expected - {settingKey: 期望的value1}
 * @param {string} label - 日志标签，方便定位是哪一步检测到的漂移
 * @returns {boolean} 是否发生过漂移(发生过则已经重新写回)
 */
export function ensureDownloadRewardConfig(adminToken, expected, label) {
    const current = getDownloadRewardSetting(adminToken);
    let drifted = false;
    for (const key of Object.keys(expected)) {
        // GetSetting响应的外层key是settingKey首字母小写的camelCase(实测确认，比如
        // settingKey="DownloadRewardDeviceLimit"对应的外层key是
        // "downloadRewardDeviceLimit")，不是settingKey本身，这里要转一下再查找。
        const camelKey = key.charAt(0).toLowerCase() + key.slice(1);
        const item = current[camelKey];
        const curVal1 = item ? item.value1 : undefined;
        if (String(curVal1) !== String(expected[key])) {
            console.warn(`[${label}] ⚠️ 检测到配置漂移: ${key} 当前=${curVal1} 期望=${expected[key]}，可能被其他人/进程改动，重新修正`);
            updateDownloadRewardSetting(adminToken, key, expected[key]);
            drifted = true;
        }
    }
    return drifted;
}

/**
 * 以H5/PWA(clientType=1)或套壳包APP(clientType=2)身份直接注册（走
 * /api/Home/Register，不是登录）。项目里现成的 phoneRegister()
 * (k6/tests/api/login/register.test.js) 不支持传 clientType，这里单独封装
 * 一个版本，专门用于验证"安全问题1"：clientType 完全由客户端自报，后端零
 * 校验——配合"无需充值"模式，手动传 clientType:2 后，注册这一步本身就会
 * 直接触发奖励发放，不需要额外的登录步骤。
 * @param {string} userName
 * @param {1|2} clientType - 1=H5/PWA, 2=套壳包APP
 * @param {{deviceId?:string, browserId?:string, password?:string, inviteCode?:string}} [overrides]
 */
export function registerAsDownloadRewardClient(userName, clientType, overrides = {}) {
    const api = '/api/Home/Register';
    const timeData = getTimeRandom();
    const payload = {
        loginType: 'Mobile',
        userName,
        password: overrides.password || 'qwer1234',
        inviteCode: overrides.inviteCode || '',
        code: '',
        captchaId: null,
        deviceId: overrides.deviceId !== undefined
            ? overrides.deviceId
            : (clientType === 2 ? generateCryptoRandomString(16) : ''),
        browserId: overrides.browserId !== undefined ? overrides.browserId : generateCryptoRandomString(32),
        packageName: '',
        clientType,
        language: timeData.language,
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp
    };
    const resp = httpClient.post(api, payload, {}, true);
    return JSON.parse(resp.body);
}

/**
 * 以H5(不带clientType)/PWA(clientType=1)/套壳包APP(clientType=2)身份登录。
 * 关键事实(2026-11-11用户纠正并实测确认)：浏览器指纹(fingerprint)只在
 * H5/PWA场景下有意义，套壳包用的是设备号(deviceId)，两者是完全独立的两条
 * 校验路径——所以这里 clientType=1 时强制不带 deviceId(传空串)，
 * clientType=2 时才生成随机 deviceId。
 * @param {string} userName
 * @param {1|2|null|undefined} clientType - 1=H5/PWA, 2=套壳包APP，
 *   null/undefined=不传clientType字段(模拟真实H5网页默认请求，不是手动
 *   注入的测试字段)——用于H组验证"注册端已拿奖励后，再用H5默认登录"场景。
 * @param {{deviceId?:string, browserId?:string, password?:string}} [overrides]
 */
export function loginAsDownloadRewardClient(userName, clientType, overrides = {}) {
    const api = '/api/Home/Login';
    const timeData = getTimeRandom();
    const payload = {
        loginType: 'Mobile',
        userName,
        password: overrides.password || 'qwer1234',
        deviceId: overrides.deviceId !== undefined
            ? overrides.deviceId
            : (clientType === 2 ? generateCryptoRandomString(16) : ''),
        browserId: overrides.browserId !== undefined ? overrides.browserId : generateCryptoRandomString(32),
        packageName: '',
        language: timeData.language,
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp
    };
    if (clientType !== null && clientType !== undefined) {
        payload.clientType = clientType;
    }
    const resp = httpClient.post(api, payload, {}, true);
    return JSON.parse(resp.body);
}

/**
 * 查询某个会员的下载奖励领取记录(没有就返回undefined，调用方按"被拦截/无
 * 记录"处理——限流超额后台是静默拦截、不生成任何记录，不是生成一条带remark
 * 的拒绝记录，这是2026-11-11实测确认的行为)。
 * @param {string} adminToken
 * @param {number} userId
 */
export function getDownloadRewardRecordByUserId(adminToken, userId) {
    httpClient.setAuthToken(adminToken);
    const timeData = getTimeRandom();
    const resp = httpClient.post('/api/DownloadPage/GetRewardRecordPageList', {
        pageNo: 1, pageSize: 200,
        random: timeData.random, language: timeData.language, signature: '', timestamp: timeData.timestamp
    }, { forceTenant: true }, false);
    const list = JSON.parse(resp.body).data.list;
    return list.find(r => r.userId === userId);
}

/**
 * 查询某个会员的全部下载奖励领取记录(不是只取第一条)——用于并发/竞态场景，
 * 需要知道到底生成了几条记录，不能只看"有没有"，要看"有几条"。
 * @param {string} adminToken
 * @param {number} userId
 * @returns {Array} 可能是空数组
 */
export function getAllDownloadRewardRecordsByUserId(adminToken, userId) {
    httpClient.setAuthToken(adminToken);
    const timeData = getTimeRandom();
    const resp = httpClient.post('/api/DownloadPage/GetRewardRecordPageList', {
        pageNo: 1, pageSize: 200,
        random: timeData.random, language: timeData.language, signature: '', timestamp: timeData.timestamp
    }, { forceTenant: true }, false);
    const list = JSON.parse(resp.body).data.list;
    return list.filter(r => r.userId === userId);
}

/**
 * 通用风控查询(复用自 rechargeGoodsLimitVerify.js 的同款用法)：按标识符
 * (设备ID/IP/浏览器指纹的具体值)查全站范围内的关联账号数。
 * 仅用于观测/交叉核实，不是下载奖励限流的判定依据——2026-11-11实测发现
 * 下载奖励的三项限流用的是它自己专属的计数器，跟这个通用风控体系不共享数据
 * (查指纹查不到任何记录；查IP即使历史关联几百个账号，下载奖励照样能在"额度
 * 内"正常发放)。
 * @param {string} adminToken
 * @param {string} accountNo - 设备ID/IP/浏览器指纹的具体值
 * @param {1|3|5} riskControlType - 1=设备 3=IP 5=浏览器指纹
 * @returns {number|null} totalCount
 */
export function getRiskControlCount(adminToken, accountNo, riskControlType) {
    httpClient.setAuthToken(adminToken);
    const timeData = getTimeRandom();
    const resp = httpClient.post('/api/Users/GetUserRiskControlPageList', {
        accountNo, riskControlType, pageNo: 1, pageSize: 1, orderBy: 'Desc',
        random: timeData.random, language: timeData.language, signature: '', timestamp: timeData.timestamp
    }, { forceTenant: true }, false);
    const body = JSON.parse(resp.body);
    return body.data ? body.data.totalCount : null;
}
