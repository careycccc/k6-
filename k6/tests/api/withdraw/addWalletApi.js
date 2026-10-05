/**
 * 添加用户钱包相关接口 - 多租户版本
 * 支持：银行卡、电子钱包、PIX、USDT、UPI
 */

import { sleep } from 'k6';
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
export function generateIFSC() {
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
export function generateTRONAddress() {
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

    // console.log(`[${tag}] 响应状态码: ${response.status}`);
    // console.log(`[${tag}] 响应msgCode: ${response.msgCode}`);
    // console.log(`[${tag}] 响应msg: ${response.msg}`);
    // console.log(`[${tag}] 完整响应:`, JSON.stringify(response, null, 2));

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
    //console.log(`[${tag}] 完整响应:`, JSON.stringify(response, null, 2));

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
    //console.log(`[${tag}] 完整响应:`, JSON.stringify(response, null, 2));

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
    //console.log(`[${tag}] 完整响应:`, JSON.stringify(response, null, 2));

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

// ============================================================
// 前台添加钱包（/api/Withdraw/AddUserWithdrawWallet，会员 token）
// 后台 /api/Users/AddUserWallet 现在返回 msgCode=0、data=13001 但不落库，改走前台接口
// ============================================================

/** 随机字母名字（holderName） */
function generateHolderName() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let name = 'name';
    for (let i = 0; i < 2 + Math.floor(Math.random() * 4); i++) name += chars.charAt(Math.floor(Math.random() * chars.length));
    return name;
}

/** msgCode=13 Too frequent access 时退避重试 */
function addFrontWithdrawWallet(userToken, payload, tag) {
    console.log(`[${tag}] 请求参数:`, JSON.stringify(payload));
    let response = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
        response = tenantRequest('/api/Withdraw/AddUserWithdrawWallet', payload, { token: userToken, isDesk: true });
        if (!response || response.msgCode !== 13) break;
        console.warn(`[${tag}] 访问太频繁，${attempt * 3}s 后重试 (${attempt}/4)`);
        sleep(attempt * 3);
    }
    // 10031：该类型只能绑一个且已绑过（电子钱包），已有可用钱包，视为成功
    if (response && response.msgCode === 10031) {
        console.log(`[${tag}] ✅ 已绑定过，沿用现有钱包`);
        return true;
    }
    if (!response || response.msgCode !== 0) {
        console.error(`[${tag}] ❌ 添加失败: msgCode=${response && response.msgCode} msg=${response && response.msg}`);
        return false;
    }
    console.log(`[${tag}] ✅ 添加成功`);
    return true;
}

/** 会员已有真实姓名时 holderName 必须一致（否则 10035 Full name is not match） */
function getFrontRealName(userToken) {
    const response = tenantRequest('/api/Withdraw/GetWithdrawBasicInfo', {}, { token: userToken, isDesk: true });
    return (response && response.data && response.data.realName) || '';
}

/** 前台添加银行卡：accountNo 18位、mobileNo 10位 */
export function addFrontBankCard(userToken, bankCode = 'INR10125', holderName = '') {
    return addFrontWithdrawWallet(userToken, {
        bankCode: bankCode,
        holderName: holderName || getFrontRealName(userToken) || generateHolderName(),
        accountNo: generateNumberString(18, true),
        mobileNo: generateNumberString(10, true),
        ifscCode: generateIFSC(),
        withdrawType: 'BankCard'
    }, 'AddFrontBankCard');
}

/** 前台添加电子钱包：accountNo 10位且不能0开头 */
export function addFrontEWallet(userToken, bankCode = 'ceshiyong', holderName = '') {
    return addFrontWithdrawWallet(userToken, {
        bankCode: bankCode,
        holderName: holderName || getFrontRealName(userToken) || generateHolderName(),
        accountNo: generateNumberString(10, true),
        withdrawType: 'EWallet'
    }, 'AddFrontEWallet');
}

/** 前台添加 USDT：aliasAddress 为随机字母备注 */
export function addFrontUsdt(userToken) {
    return addFrontWithdrawWallet(userToken, {
        networkType: 'TRC20',
        usdtAddress: generateTRONAddress(),
        aliasAddress: generateRandomString(6),
        withdrawType: 'USDT'
    }, 'AddFrontUsdt');
}

/**
 * 批量添加所有类型的钱包
 * @param {string} adminToken - 后台管理员token
 * @param {string} userId - 用户ID
 * @param {string} userToken - 会员token（传了就走前台接口添加银行卡/电子钱包/USDT，推荐）
 * @returns {boolean} 是否全部成功
 */
export function addAllWallets(adminToken, userId, userToken = null) {
    const tag = 'AddAllWallets';

    if (userToken) return addAllWalletsByFront(adminToken, userId, userToken);

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
    console.log(`[${tag}] 总计: ${successCount}/${totalCount} 接口返回成功`);

    // AddUserWallet 可能返回 msgCode=0 却没落库（如 data=13001），以后台 GetWallet 实查为准
    const actual = getUserWalletCount(adminToken, userId);
    console.log(`[${tag}] 后台实查已绑钱包: ${JSON.stringify(actual)}`);
    if (actual && actual.total === 0) {
        console.error(`[${tag}] ❌ 接口返回成功但后台查不到任何钱包，添加实际未生效`);
        return false;
    }

    return successCount === totalCount;
}

/** 前台接口添加 银行卡/电子钱包/USDT，bankCode 用后台字典随机取（取不到用默认值），最后后台实查确认 */
function addAllWalletsByFront(adminToken, userId, userToken) {
    const tag = 'AddAllWallets';
    console.log(`[${tag}] ========== 前台接口为用户 ${userId} 添加钱包 ==========`);

    const bankCode = (adminToken && getBankCode(adminToken, '1')) || 'INR10125';
    const ewalletCode = (adminToken && getBankCode(adminToken, '2')) || 'ceshiyong';

    // 已有真实姓名就沿用；没有则随机一个，银行卡和电子钱包用同一个名字
    const holderName = getFrontRealName(userToken) || generateHolderName();
    console.log(`[${tag}] holderName: ${holderName}`);

    const results = {};
    results.bank = addFrontBankCard(userToken, bankCode, holderName);
    sleep(3); // 连续添加会 Too frequent access
    results.ewallet = addFrontEWallet(userToken, ewalletCode, holderName);
    sleep(3);
    results.usdt = addFrontUsdt(userToken);

    console.log(`[${tag}] 银行卡: ${results.bank ? '✅' : '❌'}  电子钱包: ${results.ewallet ? '✅' : '❌'}  USDT: ${results.usdt ? '✅' : '❌'}`);
    if (adminToken) {
        const actual = getUserWalletCount(adminToken, userId);
        console.log(`[${tag}] 后台实查已绑钱包: ${JSON.stringify(actual)}`);
        if (actual && actual.total === 0) {
            console.error(`[${tag}] ❌ 接口返回成功但后台查不到任何钱包，添加实际未生效`);
            return false;
        }
    }
    return results.bank && results.ewallet && results.usdt;
}

/**
 * 后台查询用户已绑定的钱包数量（/api/Users/GetWallet）
 * @returns {{bank:number, ewallet:number, pix:number, usdt:number, upi:number, total:number}|null}
 */
export function getUserWalletCount(adminToken, userId) {
    const response = tenantRequest('/api/Users/GetWallet', { userId: userId }, { token: adminToken, isDesk: false });
    if (!response || response.msgCode !== 0 || !response.data) return null;
    const d = response.data;
    const len = a => (Array.isArray(a) ? a.length : 0);
    const c = {
        bank: len(d.usersWalletbankList),
        ewallet: len(d.usersWalletElectronicWalletList),
        pix: len(d.userPixWalletList),
        usdt: len(d.usersWalletVirtualCurrencyList),
        upi: len(d.usersWalletUpiList)
    };
    c.total = c.bank + c.ewallet + c.pix + c.usdt + c.upi;
    return c;
}
