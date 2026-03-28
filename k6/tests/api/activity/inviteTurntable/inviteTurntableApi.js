/**
 * 邀请转盘API函数
 * 封装所有邀请转盘相关的API调用
 */

import { sleep } from 'k6';
import { sendRequest } from '../../common/request.js';
import { httpClient } from '../../../../libs/http/client.js';
import { getTimeRandom } from '../../../utils/utils.js';

/**
 * 获取邀请转盘配置
 * @param {string} adminToken - 管理员token
 * @returns {object} { success: boolean, config: object, isOpen: boolean, cashToMainWallet: boolean, autoRotate: boolean }
 */
export function getInvitedWheelConfig(adminToken) {
    console.log(`[GetInvitedWheelConfig] 获取邀请转盘配置...`);

    const api = '/api/InvitedWheel/GetConfig';
    const timeData = getTimeRandom();
    const payload = {
        random: timeData.random,
        language: timeData.language,
        signature: '',
        timestamp: timeData.timestamp
    };

    try {
        httpClient.setAuthToken(adminToken);
        const response = httpClient.post(api, payload, {}, false);

        if (!response || !response.body) {
            console.error('[GetInvitedWheelConfig] 响应为空');
            return { success: false };
        }

        let parsedBody;
        if (typeof response.body === 'string') {
            parsedBody = JSON.parse(response.body);
        } else {
            parsedBody = response.body;
        }

        if (!parsedBody || parsedBody.msgCode !== 0) {
            console.error(`[GetInvitedWheelConfig] 获取配置失败: ${parsedBody?.msg || '未知错误'}`);
            return { success: false };
        }

        const data = parsedBody.data;
        const isOpen = data.isOpenInvitedWheel?.value1 === '1';
        const cashToMainWallet = data.isInvitedWheelCashToMainWallet?.value1 === '1';
        const autoRotate = data.inviteAutoRotate?.value1 === '1';

        console.log(`[GetInvitedWheelConfig] ✅ 获取配置成功`);
        console.log(`[GetInvitedWheelConfig] 活动开关: ${isOpen ? '开启' : '关闭'}`);
        console.log(`[GetInvitedWheelConfig] 提现方式: ${cashToMainWallet ? '主钱包' : '银行卡'}`);
        console.log(`[GetInvitedWheelConfig] 自动旋转: ${autoRotate ? '开启' : '关闭'}`);

        return {
            success: true,
            config: data,
            isOpen: isOpen,
            cashToMainWallet: cashToMainWallet,
            autoRotate: autoRotate
        };

    } catch (error) {
        console.error(`[GetInvitedWheelConfig] 异常: ${error.message}`);
        return { success: false };
    }
}

/**
 * 更新邀请转盘配置
 * @param {string} adminToken - 管理员token
 * @param {string} settingKey - 配置键
 * @param {string} value1 - 配置值
 * @returns {object} { success: boolean }
 */
export function updateInvitedWheelConfig(adminToken, settingKey, value1) {
    console.log(`[UpdateInvitedWheelConfig] 更新配置：${settingKey} = ${value1}`);

    const api = '/api/InvitedWheel/UpdateConfig';
    const timeData = getTimeRandom();
    const payload = {
        settingKey: settingKey,
        value1: value1,
        random: timeData.random,
        language: timeData.language,
        signature: '',
        timestamp: timeData.timestamp
    };

    try {
        httpClient.setAuthToken(adminToken);
        const response = httpClient.post(api, payload, {}, false);

        if (!response || !response.body) {
            console.error('[UpdateInvitedWheelConfig] 响应为空');
            return { success: false };
        }

        let parsedBody;
        if (typeof response.body === 'string') {
            parsedBody = JSON.parse(response.body);
        } else {
            parsedBody = response.body;
        }

        if (!parsedBody || parsedBody.msgCode !== 0) {
            console.error(`[UpdateInvitedWheelConfig] 更新配置失败: ${parsedBody?.msg || '未知错误'}`);
            return { success: false };
        }

        console.log(`[UpdateInvitedWheelConfig] ✅ 配置更新成功: ${settingKey} = ${value1}`);
        return { success: true };

    } catch (error) {
        console.error(`[UpdateInvitedWheelConfig] 异常: ${error.message}`);
        return { success: false };
    }
}

/**
 * 点击4个礼物盒（开启邀请转盘）
 * @param {string} userToken - 用户token
 * @returns {object} { success: boolean, isFirstInvitedWheel: boolean }
 */
export function clickSpinInvitedWheel(userToken) {
    console.log(`[ClickSpinInvitedWheel] 点击礼物盒...`);

    const api = '/api/Activity/SpinInvitedWheel';
    const payload = {};

    try {
        const response = sendRequest(payload, api, 'ClickSpinInvitedWheel', true, userToken);

        if (!response) {
            console.error('[ClickSpinInvitedWheel] 响应为空');
            return { success: false };
        }

        // 检查响应格式
        let data = null;
        if (response.data !== undefined) {
            data = response.data;
        } else if (response.isFirstInvitedWheel !== undefined) {
            data = response;
        }

        if (!data) {
            console.error('[ClickSpinInvitedWheel] 无法解析响应数据');
            return { success: false };
        }

        const isFirstInvitedWheel = data.isFirstInvitedWheel || false;
        console.log(`[ClickSpinInvitedWheel] ✅ 成功，isFirstInvitedWheel: ${isFirstInvitedWheel}`);

        return {
            success: true,
            isFirstInvitedWheel: isFirstInvitedWheel
        };

    } catch (error) {
        console.error(`[ClickSpinInvitedWheel] 异常: ${error.message}`);
        return { success: false };
    }
}

/**
 * 点击分享链接，获取邀请码
 * @param {string} userToken - 用户token
 * @returns {object} { success: boolean, inviteCode: string }
 */
export function clickShareLink(userToken) {
    console.log(`[ClickShareLink] 获取邀请链接...`);

    const api = '/api/Activity/GetUserInviteLinkAddress';
    const payload = {};

    try {
        const response = sendRequest(payload, api, 'ClickShareLink', true, userToken);

        if (!response) {
            console.error('[ClickShareLink] 响应为空');
            return { success: false };
        }

        // 检查响应格式
        let data = null;
        if (response.data !== undefined) {
            data = response.data;
        } else if (response.inviteCode !== undefined) {
            data = response;
        }

        if (!data || !data.inviteCode) {
            console.error('[ClickShareLink] 无法获取邀请码');
            return { success: false };
        }

        const inviteCode = data.inviteCode;
        console.log(`[ClickShareLink] ✅ 成功，邀请码: ${inviteCode}`);

        return {
            success: true,
            inviteCode: inviteCode
        };

    } catch (error) {
        console.error(`[ClickShareLink] 异常: ${error.message}`);
        return { success: false };
    }
}

/**
 * 旋转转盘（带重试逻辑）
 * @param {string} userToken - 用户token
 * @param {number} maxRetries - 最大重试次数（默认3次）
 * @returns {object} { success: boolean, prizeAmount: number, isWin: boolean }
 */
export function clickSpinningTurntable(userToken, maxRetries = 3) {
    console.log(`[ClickSpinningTurntable] 旋转转盘...`);

    const api = '/api/Activity/SpinInvitedWheel';
    const payload = {};

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = sendRequest(payload, api, 'ClickSpinningTurntable', true, userToken);

            if (!response) {
                console.error('[ClickSpinningTurntable] 响应为空');

                // 如果还有重试次数，继续重试
                if (attempt < maxRetries) {
                    console.log(`[ClickSpinningTurntable] 等待3秒后重试 (${attempt}/${maxRetries})...`);
                    sleep(3);
                    continue;
                }

                return { success: false };
            }

            // 检查是否是"Too frequent access"错误
            if (response.msgCode === 13 || (response.msg && response.msg.includes('Too frequent access'))) {
                console.warn(`[ClickSpinningTurntable] 访问过于频繁 (${attempt}/${maxRetries})`);

                // 如果还有重试次数，等待后重试
                if (attempt < maxRetries) {
                    console.log(`[ClickSpinningTurntable] 等待3秒后重试...`);
                    sleep(3);
                    continue;
                }

                console.error('[ClickSpinningTurntable] 达到最大重试次数，仍然访问过于频繁');
                return { success: false, error: 'Too frequent access' };
            }

            // 检查响应格式
            let data = null;
            if (response.data !== undefined) {
                data = response.data;
            } else if (response.prizeAmount !== undefined) {
                data = response;
            }

            if (!data) {
                console.error('[ClickSpinningTurntable] 无法解析响应数据');

                // 如果还有重试次数，继续重试
                if (attempt < maxRetries) {
                    console.log(`[ClickSpinningTurntable] 等待3秒后重试 (${attempt}/${maxRetries})...`);
                    sleep(3);
                    continue;
                }

                return { success: false };
            }

            const prizeAmount = data.prizeAmount || 0;
            const isWin = data.isWin || false;
            console.log(`[ClickSpinningTurntable] ✅ 成功，金额: ${prizeAmount}, 中奖: ${isWin}`);

            return {
                success: true,
                prizeAmount: prizeAmount,
                isWin: isWin
            };

        } catch (error) {
            console.error(`[ClickSpinningTurntable] 异常: ${error.message}`);

            // 如果还有重试次数，继续重试
            if (attempt < maxRetries) {
                console.log(`[ClickSpinningTurntable] 等待3秒后重试 (${attempt}/${maxRetries})...`);
                sleep(3);
                continue;
            }

            return { success: false };
        }
    }

    // 理论上不会到这里，但为了安全起见
    return { success: false };
}

/**
 * 获取用户邀请转盘信息（总金额）
 * @param {string} userToken - 用户token
 * @returns {object} { success: boolean, totalPrizeAmount: number, userWheelAmount: number }
 */
export function getUserInvitedWheelInfo(userToken) {
    console.log(`[GetUserInvitedWheelInfo] 获取转盘信息...`);

    const api = '/api/Activity/GetUserInvitedWheelInfo';
    const payload = {};

    try {
        const response = sendRequest(payload, api, 'GetUserInvitedWheelInfo', true, userToken);

        if (!response) {
            console.error('[GetUserInvitedWheelInfo] 响应为空');
            return { success: false };
        }

        // 检查响应格式
        let data = null;
        if (response.data !== undefined) {
            data = response.data;
        } else if (response.invitedWheelTotalPrizeAmount !== undefined) {
            data = response;
        }

        if (!data) {
            console.error('[GetUserInvitedWheelInfo] 无法解析响应数据');
            return { success: false };
        }

        const totalPrizeAmount = data.invitedWheelTotalPrizeAmount || 0;
        const userWheelAmount = data.userInvitedWheelAmount || 0;

        console.log(`[GetUserInvitedWheelInfo] ✅ 成功，总金额: ${totalPrizeAmount}, 已旋转金额: ${userWheelAmount}`);

        return {
            success: true,
            totalPrizeAmount: totalPrizeAmount,
            userWheelAmount: userWheelAmount
        };

    } catch (error) {
        console.error(`[GetUserInvitedWheelInfo] 异常: ${error.message}`);
        return { success: false };
    }
}

/**
 * 点击提现按钮
 * @param {number} amount - 提现金额
 * @param {string} userToken - 用户token
 * @returns {object} { success: boolean }
 */
export function clickWheelWithdraw(amount, userToken) {
    console.log(`[ClickWheelWithdraw] 提现，金额: ${amount}`);

    const api = '/api/Activity/SumitInvitedWheelWithdraw';
    const timeData = getTimeRandom();
    const payload = {
        random: timeData.random,
        language: timeData.language,
        signature: '',
        timestamp: timeData.timestamp,
        amount: amount
    };

    try {
        httpClient.setAuthToken(userToken);
        const response = httpClient.post(api, payload, {}, true);

        if (!response || !response.body) {
            console.error('[ClickWheelWithdraw] 响应为空');
            return { success: false };
        }

        let parsedBody;
        if (typeof response.body === 'string') {
            parsedBody = JSON.parse(response.body);
        } else {
            parsedBody = response.body;
        }

        if (!parsedBody) {
            console.error('[ClickWheelWithdraw] 无法解析响应');
            return { success: false };
        }

        const statusCode = parsedBody.code !== undefined ? parsedBody.code : parsedBody.msgCode;
        const msg = parsedBody.msg;

        console.log(`[ClickWheelWithdraw] 响应: code=${statusCode}, msg=${msg}`);

        // 检查业务状态码
        if (statusCode === 0 || msg === 'Succeed') {
            console.log(`[ClickWheelWithdraw] ✅ 提现成功，金额: ${amount}`);
            return { success: true };
        } else {
            console.error(`[ClickWheelWithdraw] 提现失败: code=${statusCode}, msg=${msg}`);
            return { success: false, code: statusCode, msg: msg };
        }

    } catch (error) {
        console.error(`[ClickWheelWithdraw] 异常: ${error.message}`);
        return { success: false };
    }
}
