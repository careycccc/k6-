/**
 * 添加用户钱包相关接口 - 多租户版本
 * 支持：银行卡、电子钱包、PIX、USDT、UPI
 */

import { tenantRequest } from '../../../libs/http/tenantRequest.js';

/**
 * 获取银行字典列表
 * @param {string} adminToken - 后台管理员token
 * @param {string} type - 类型（1=银行卡，2=电子钱包等）
 * @returns {string|null} 返回随机选择的银行代码
 */
function getBankCode(adminToken, type = '1') {
    const api = '/api/Bankdictionary/GetBankDictionarySelect';
    const tag = 'GetBankCode';

    const payload = {
        type: type
    };

    const response = tenantRequest(api, payload, { token: adminToken, isDesk: false });

    if (!response || response.msgCode !== 0 || !response.data) {
        console.error(`[${tag}] 获取银行字典失败:`, response);
        return null;
    }

    const bankList = response.data;

    if (!Array.isArray(bankList) || bankList.length === 0) {
        console.error(`[${tag}] 银行列表为空`);
        return null;
    }

    // 取前5项或实际长度（如果少于5项）
    const maxItems = Math.min(5, bankList.length);
    const selectedList = bankList.slice(0, maxItems);

    // 随机选择一个
    const randomIndex = Math.floor(Math.random() * selectedList.length);
    const selectedBank = selectedList[randomIndex];

    console.log(`[${tag}] 银行列表总数: ${bankList.length}, 取前 ${maxItems} 项`);
    console.log(`[${tag}] 随机选择: ${selectedBank.code} - ${selectedBank.name}`);

    return selectedBank.code;
}

/**
 * 生成随机字符串
 * @param {number} length - 字符串长度
 * @returns {string}
 */
function generateRandomString(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * 生成随机邮箱
 * @returns {string}
 */
function generateRandomEmail() {
    const domains = [
        "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
        "163.com", "126.com", "qq.com", "sina.com",
        "foxmail.com", "sohu.com", "139.com", "189.com",
        "aliyun.com", "protonmail.com", "icloud.com",
        "aol.com", "zoho.com", "mail.com", "inbox.com"
    ];
    const usernameLen = 6 + Math.floor(Math.random() * 7); // 6-12
    const username = generateRandomString(usernameLen);
    const domain = domains[Math.floor(Math.random() * domains.length)];
    return `${username}@${domain}`;
}

/**
 * 生成随机数字字符串
 * @param {number} length - 长度
 * @param {boolean} noLeadingZero - 是否禁止0开头（默认false）
 * @returns {string}
 */
function generateNumberString(length, noLeadingZero = false) {
    let result = '';
    for (let i = 0; i < length; i++) {
        if (i === 0 && noLeadingZero) {
            // 第一位不能是0，生成1-9
            result += Math.floor(Math.random() * 9) + 1;
        } else {
            result += Math.floor(Math.random() * 10);
        }
    }
    return result;
}

/**
 * 生成银行卡号（带Luhn校验）
 * @param {number} length - 卡号长度（10-19位）
 * @param {string} prefix - 前缀（默认"4"）
 * @returns {string}
 */
function generateBankCard(length = 18, prefix = '4') {
    if (length < 10 || length > 19) {
        throw new Error('卡号长度必须在10-19位之间');
    }

    // 生成除校验位外的所有数字
    let card = prefix;
    const neededDigits = length - prefix.length - 1;

    for (let i = 0; i < neededDigits; i++) {
        card += Math.floor(Math.random() * 10);
    }

    // 计算Luhn校验位
    const checkDigit = calculateLuhnCheckDigit(card);
    return card + checkDigit;
}

/**
 * 计算Luhn校验位
 * @param {string} partialCard - 不含校验位的卡号
 * @returns {number}
 */
function calculateLuhnCheckDigit(partialCard) {
    let sum = 0;
    const length = partialCard.length;

    for (let i = 0; i < length; i++) {
        let digit = parseInt(partialCard[length - 1 - i]);

        if ((length % 2 === 0 && i % 2 === 1) || (length % 2 === 1 && i % 2 === 0)) {
            digit *= 2;
            if (digit > 9) {
                digit -= 9;
            }
        }
        sum += digit;
    }

    return (10 - (sum % 10)) % 10;
}

/**
 * 生成IFSC代码
 * @returns {string}
 */
function generateIFSC() {
    const bankCodes = [
        "SBIN", "HDFC", "ICIC", "AXIS", "KKBK",
        "BARB", "CANB", "INDB", "KARB", "CNRB",
        "SCBL", "MAHB", "VIJB", "IOBA", "FDRL",
        "IBKL", "UCOB"
    ];

    const bankCode = bankCodes[Math.floor(Math.random() * bankCodes.length)];
    const middleNum = "0";

    // 生成6位分行代码（大写字母+数字）
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let branchCode = '';
    for (let i = 0; i < 6; i++) {
        branchCode += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return bankCode + middleNum + branchCode;
}

/**
 * 生成TRON USDT地址
 * @returns {string}
 */
function generateTRONAddress() {
    const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const length = 34;

    let address = 'T'; // TRON地址前缀
    for (let i = 0; i < length - 1; i++) {
        address += base58Alphabet.charAt(Math.floor(Math.random() * base58Alphabet.length));
    }

    return address;
}

/**
 * 生成UPI格式地址
 * @returns {string}
 */
function generateUPIFormat() {
    // 10位随机电话号码
    const phoneNumber = generateNumberString(10);

    // 4-8位随机银行名称
    const bankNameLength = 4 + Math.floor(Math.random() * 5);
    const chars = "abcdefghijklmnopqrstuvwxyz";
    let bankName = '';
    for (let i = 0; i < bankNameLength; i++) {
        bankName += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return `${phoneNumber}@${bankName}`;
}

/**
 * 添加银行卡
 * @param {string} adminToken - 后台管理员token
 * @param {string} userId - 用户ID
 * @returns {boolean}
 */
export function addUserBank(adminToken, userId) {
    const api = '/api/Users/AddUserWallet';
    const tag = 'AddUserBank';

    // 先获取银行代码
    const bankCode = getBankCode(adminToken, '1');
    if (!bankCode) {
        console.error(`[${tag}] ❌ 无法获取银行代码，跳过添加银行卡`);
        return false;
    }

    const payload = {
        bankCode: bankCode,
        cardNo: generateBankCard(18),
        mobileNo: generateNumberString(12),
        email: generateRandomEmail(),
        ifscCode: generateIFSC(),
        userId: userId,
        walletType: 1 // 1表示银行卡
    };

    console.log(`[${tag}] 请求参数:`, JSON.stringify(payload, null, 2));

    const response = tenantRequest(api, payload, { token: adminToken, isDesk: false });

    console.log(`[${tag}] 响应状态码: ${response.status}`);
    console.log(`[${tag}] 响应msgCode: ${response.msgCode}`);
    console.log(`[${tag}] 响应msg: ${response.msg}`);
    console.log(`[${tag}] 完整响应:`, JSON.stringify(response, null, 2));

    if (!response || response.msgCode !== 0) {
        console.error(`[${tag}] ❌ 添加银行卡失败`);
        return false;
    }

    console.log(`[${tag}] ✅ 添加银行卡成功`);
    return true;
}

/**
 * 添加电子钱包
 * @param {string} adminToken - 后台管理员token
 * @param {string} userId - 用户ID
 * @returns {boolean}
 */
export function addUserWallet(adminToken, userId) {
    const api = '/api/Users/AddUserWallet';
    const tag = 'AddUserWallet';

    // 获取电子钱包代码（type=2）
    const bankCode = getBankCode(adminToken, '2');
    if (!bankCode) {
        console.error(`[${tag}] ❌ 无法获取电子钱包代码，跳过添加电子钱包`);
        return false;
    }

    const payload = {
        bankCode: bankCode,
        mobileNo: generateNumberString(12),
        userId: userId,
        walletType: 2 // 2表示电子钱包
    };

    console.log(`[${tag}] 请求参数:`, JSON.stringify(payload, null, 2));

    const response = tenantRequest(api, payload, { token: adminToken, isDesk: false });

    console.log(`[${tag}] 响应状态码: ${response.status}`);
    console.log(`[${tag}] 响应msgCode: ${response.msgCode}`);
    console.log(`[${tag}] 响应msg: ${response.msg}`);
    console.log(`[${tag}] 完整响应:`, JSON.stringify(response, null, 2));

    if (!response || response.msgCode !== 0) {
        console.error(`[${tag}] ❌ 添加电子钱包失败`);
        return false;
    }

    console.log(`[${tag}] ✅ 添加电子钱包成功`);
    return true;
}

/**
 * 添加PIX
 * @param {string} adminToken - 后台管理员token
 * @param {string} userId - 用户ID
 * @returns {boolean}
 */
export function addUserPix(adminToken, userId) {
    const api = '/api/Users/AddUserWallet';
    const tag = 'AddUserPix';

    const payload = {
        mobileNo: generateNumberString(10, true), // 10位数字，不能0开头
        pixWalletType: 'Phone',
        userId: userId,
        walletType: 3 // 3表示PIX
    };

    console.log(`[${tag}] 请求参数:`, JSON.stringify(payload, null, 2));

    const response = tenantRequest(api, payload, { token: adminToken, isDesk: false });

    console.log(`[${tag}] 响应状态码: ${response.status}`);
    console.log(`[${tag}] 响应msgCode: ${response.msgCode}`);
    console.log(`[${tag}] 响应msg: ${response.msg}`);
    console.log(`[${tag}] 完整响应:`, JSON.stringify(response, null, 2));

    if (!response || response.msgCode !== 0) {
        console.error(`[${tag}] ❌ 添加PIX失败`);
        return false;
    }

    console.log(`[${tag}] ✅ 添加PIX成功`);
    return true;
}

/**
 * 添加USDT
 * @param {string} adminToken - 后台管理员token
 * @param {string} userId - 用户ID
 * @returns {boolean}
 */
export function addUserUsdt(adminToken, userId) {
    const api = '/api/Users/AddUserWallet';
    const tag = 'AddUserUsdt';

    const address = generateTRONAddress();

    const payload = {
        address: address,
        aliasAddress: address,
        networkType: 'TRC20',
        userId: userId,
        walletType: 4 // 4表示USDT
    };

    console.log(`[${tag}] 请求参数:`, JSON.stringify(payload, null, 2));

    const response = tenantRequest(api, payload, { token: adminToken, isDesk: false });

    console.log(`[${tag}] 响应状态码: ${response.status}`);
    console.log(`[${tag}] 响应msgCode: ${response.msgCode}`);
    console.log(`[${tag}] 响应msg: ${response.msg}`);
    console.log(`[${tag}] 完整响应:`, JSON.stringify(response, null, 2));

    if (!response || response.msgCode !== 0) {
        console.error(`[${tag}] ❌ 添加USDT失败`);
        return false;
    }

    console.log(`[${tag}] ✅ 添加USDT成功`);
    return true;
}

/**
 * 添加UPI
 * @param {string} adminToken - 后台管理员token
 * @param {string} userId - 用户ID
 * @returns {boolean}
 */
export function addUserUpi(adminToken, userId) {
    const api = '/api/Users/AddUserWallet';
    const tag = 'AddUserUpi';

    const payload = {
        upiId: generateUPIFormat(),
        userId: userId,
        walletType: 5 // 5表示UPI
    };

    const response = tenantRequest(api, payload, { token: adminToken, isDesk: false });

    if (!response || response.msgCode !== 0) {
        console.error(`[${tag}] 添加UPI失败:`, response);
        return false;
    }

    console.log(`[${tag}] ✅ 添加UPI成功`);
    return true;
}

/**
 * 批量添加所有类型的钱包
 * @param {string} adminToken - 后台管理员token
 * @param {string} userId - 用户ID
 * @returns {boolean} 是否全部成功
 */
export function addAllWallets(adminToken, userId) {
    const tag = 'AddAllWallets';

    console.log(`[${tag}] ========== 开始为用户 ${userId} 添加所有钱包类型 ==========`);

    // 顺序添加所有钱包类型，记录每个结果
    const results = {};

    console.log(`\n[${tag}] --- 1/4 添加银行卡 ---`);
    results.bank = addUserBank(adminToken, userId);

    console.log(`\n[${tag}] --- 2/4 添加电子钱包 ---`);
    results.wallet = addUserWallet(adminToken, userId);

    console.log(`\n[${tag}] --- 3/4 添加PIX ---`);
    results.pix = addUserPix(adminToken, userId);

    console.log(`\n[${tag}] --- 4/4 添加USDT ---`);
    results.usdt = addUserUsdt(adminToken, userId);

    // 统计结果
    const successCount = Object.values(results).filter(r => r === true).length;
    const totalCount = Object.keys(results).length;

    console.log(`\n[${tag}] ========== 钱包添加汇总 ==========`);
    console.log(`[${tag}] 银行卡: ${results.bank ? '✅ 成功' : '❌ 失败'}`);
    console.log(`[${tag}] 电子钱包: ${results.wallet ? '✅ 成功' : '❌ 失败'}`);
    console.log(`[${tag}] PIX: ${results.pix ? '✅ 成功' : '❌ 失败'}`);
    console.log(`[${tag}] USDT: ${results.usdt ? '✅ 成功' : '❌ 失败'}`);
    console.log(`[${tag}] 总计: ${successCount}/${totalCount} 成功`);

    return successCount === totalCount;
}
