import { sendQueryRequest, sendRequest } from '../common/request.js';

import { sleep } from 'k6';

const tag = 'adminsixearn';
// 解除和绑定代理
// 要解除的账号id列表
let unbindAccountIds = [];

/**
 * @param {*} accountId 总代账号ID
 * @param {*} hierarchy 相对层级
*/
export function querySubAccounts(data, accountId, hierarchy) {
    const api = '/api/Agent/GetPageListAgentList';
    const payload = {
        userId: accountId,
        isAll: true,
        isIncludeSelfAndParent: false,
        hierarchy,
        pageSize: 200,
    }
    let result = sendQueryRequest(payload, api, tag, false, data.token);
    if (typeof result != 'object') {
        result = JSON.parse(result);
    }
    if (result && result.list) {
        // 提取账号ID列表
        unbindAccountIds = result.list.map(account => account.userId);
        return unbindAccountIds;
    } else {
        console.error('查询下级账号失败或无结果', result);
        return [];
    }
}


// 2,进行解除
export function unbindSubAccounts(data) {
    if (unbindAccountIds.length === 0) {
        console.warn('没有找到需要解绑的账号');
        return;
    }
    const api = '/api/Agent/UserInviteUnBind';
    const token = data.token;
    unbindAccountIds.forEach(accountId => {
        sleep(0.5); // 避免请求过快
        const payload = {
            userId: accountId,
        }
        const result = commonRequest(payload, api, tag, token);
        if (result) {
            console.log(`账号ID ${accountId} 解绑成功`);
        }
    })
}
// 3.进行绑定
/**
 * @param {*} inviteCode 邀请码
*/
export function bindSubAccounts(data, inviteCode) {
    const api = '/api/Agent/UserInviteBind';
    const token = data.token;
    if (unbindAccountIds.length === 0) {
        console.warn('没有找到需要解绑的账号');
        return;
    }
    unbindAccountIds.forEach(accountId => {
        sleep(0.5); // 避免请求过快
        const payload = {
            userId: accountId,
            inviteCode: inviteCode
        }
        const result = commonRequest(payload, api, tag, token);
        if (result) {
            console.log(`账号ID ${accountId} 绑定成功`);
        }
    })
}



// 公共的请求
function commonRequest(payload, api, tag, token) {
    let result = sendRequest(payload, api, tag, false, token);
    if (typeof result != 'object') {
        result = JSON.parse(result);
    }
    return result.data;
}

// 主函数，执行解绑和绑定操作
export function bundEarn(data) {
    // 这里输入要查询的团队总代的id
    const accountId = 5944683;
    const hierarchy = 5; // 指定相对层级
    //1.查询当前代理下指定的相对层级的所有下级账号
    querySubAccounts(data, accountId, hierarchy);
    sleep(0.5);
    console.log('找到需要解绑和绑定的账号ID列表:', unbindAccountIds);
    // 2.进行解绑
    unbindSubAccounts(data);
    sleep(2);
    // 5944602 邀请码 9ECKE5N <- 5944389 的所有5级的下级账号进行绑定
    const inviteCode = '85YJGZN'; // 替换为实际的邀请码
    // 3.进行绑定
    bindSubAccounts(data, inviteCode);
}

// [5944753,5944752,5944751,5944750,5944749,5944748,5944747,5944746,5944745,5944744,5944743,5944742]