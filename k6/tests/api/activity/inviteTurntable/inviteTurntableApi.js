/**
 * 邀请转盘API函数
 * 封装所有邀请转盘相关的API调用
 */

import { sendRequest } from '../../common/request.js';

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
 * 旋转转盘
 * @param {string} userToken - 用户token
 * @returns {object} { success: boolean, prizeAmount: number, isWin: boolean }
 */
export function clickSpinningTurntable(userToken) {
    console.log(`[ClickSpinningTurntable] 旋转转盘...`);

    const api = '/api/Activity/SpinInvitedWheel';
    const payload = {};

    try {
        const response = sendRequest(payload, api, 'ClickSpinningTurntable', true, userToken);

        if (!response) {
            console.error('[ClickSpinningTurntable] 响应为空');
            return { success: false };
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
        return { success: false };
    }
}

/**
 * 获取用户邀请转盘信息（总金额）
 * @param {string} userToken - 用户token
 * @returns {object} { success: boolean, totalPrizeAmount: number }
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
        console.log(`[GetUserInvitedWheelInfo] ✅ 成功，总金额: ${totalPrizeAmount}`);

        return {
            success: true,
            totalPrizeAmount: totalPrizeAmount
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
    const payload = {
        amount: amount
    };

    try {
        const response = sendRequest(payload, api, 'ClickWheelWithdraw', true, userToken);

        if (!response) {
            console.error('[ClickWheelWithdraw] 响应为空');
            return { success: false };
        }

        // 检查响应状态
        const statusCode = response.code !== undefined ? response.code : response.msgCode;

        if (statusCode === 0 || response.msg === 'Succeed') {
            console.log(`[ClickWheelWithdraw] ✅ 提现成功，金额: ${amount}`);
            return { success: true };
        } else {
            console.error(`[ClickWheelWithdraw] 提现失败: code=${statusCode}, msg=${response.msg}`);
            return { success: false };
        }

    } catch (error) {
        console.error(`[ClickWheelWithdraw] 异常: ${error.message}`);
        return { success: false };
    }
}
