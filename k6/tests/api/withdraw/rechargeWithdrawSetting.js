/**
 * 充值/提现相关后台配置项（钱包绑定唯一性开关等）
 *
 * 统一走 /api/RechargeWithdrawSetting/UpdateSetting，用 settingKey 区分具体配置项，
 * value1 传 "1"/"0" 控制开启/关闭（2026-11-03 实测确认，银行卡唯一性开启已验证成功）。
 */

import { sendRequest } from '../common/request.js';

const TAG = 'RechargeWithdrawSetting';

/** 四种绑定唯一性开关对应的 settingKey */
export const UNIQUE_SETTING_KEY = {
    bank: 'IsBindBankUnique',
    usdt: 'IsBindUSDTUnique',
    ewallet: 'IsBindEWalletUnique',
    upi: 'IsBindUPIUnique'
};

/**
 * 更新单个配置项
 * @param {string} adminToken
 * @param {string} settingKey - 如 'IsBindBankUnique'
 * @param {boolean} enabled - true=开启(value1:"1")，false=关闭(value1:"0")
 * @returns {boolean}
 */
export function updateRechargeWithdrawSetting(adminToken, settingKey, enabled) {
    const payload = { settingKey, value1: enabled ? '1' : '0' };
    const res = sendRequest(payload, '/api/RechargeWithdrawSetting/UpdateSetting', TAG, false, adminToken);
    if (!res || res.msgCode !== 0) {
        console.error(`[${TAG}] ❌ 更新失败 settingKey=${settingKey} enabled=${enabled}: ${JSON.stringify(res)}`);
        return false;
    }
    console.log(`[${TAG}] ✅ ${settingKey} 已设为 ${enabled ? '开启' : '关闭'}`);
    return true;
}

/**
 * 设置银行卡绑定唯一性开关
 * @param {string} adminToken
 * @param {boolean} enabled
 */
export function setBankUniqueness(adminToken, enabled) {
    return updateRechargeWithdrawSetting(adminToken, UNIQUE_SETTING_KEY.bank, enabled);
}

/** 设置USDT地址绑定唯一性开关 */
export function setUsdtUniqueness(adminToken, enabled) {
    return updateRechargeWithdrawSetting(adminToken, UNIQUE_SETTING_KEY.usdt, enabled);
}

/** 设置电子钱包绑定唯一性开关 */
export function setEWalletUniqueness(adminToken, enabled) {
    return updateRechargeWithdrawSetting(adminToken, UNIQUE_SETTING_KEY.ewallet, enabled);
}

/** 设置UPI绑定唯一性开关 */
export function setUpiUniqueness(adminToken, enabled) {
    return updateRechargeWithdrawSetting(adminToken, UNIQUE_SETTING_KEY.upi, enabled);
}
