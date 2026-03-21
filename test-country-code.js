/**
 * 测试区号功能
 * 验证不同区号的注册功能
 */

import { generateRandomPhone, generateRandomPhones } from './k6/tests/utils/accountGenerator.js';

console.log('========================================');
console.log('开始测试区号功能');
console.log('========================================\n');

// 测试1: 生成不同区号的手机号
console.log('测试1: 生成不同区号的手机号');
console.log('----------------------------------------');

const phone91 = generateRandomPhone('91');
console.log(`区号91的手机号: ${phone91}`);

const phone55 = generateRandomPhone('55');
console.log(`区号55的手机号: ${phone55}`);

const phone52 = generateRandomPhone('52');
console.log(`区号52的手机号: ${phone52}`);

console.log('\n');

// 测试2: 验证手机号格式
console.log('测试2: 验证手机号格式');
console.log('----------------------------------------');

function validatePhoneFormat(phone, expectedPrefix) {
    if (phone.startsWith(expectedPrefix)) {
        console.log(`✅ ${phone} - 正确以 ${expectedPrefix} 开头`);
        return true;
    } else {
        console.log(`❌ ${phone} - 错误，应该以 ${expectedPrefix} 开头`);
        return false;
    }
}

validatePhoneFormat(phone91, '91');
validatePhoneFormat(phone55, '55');
validatePhoneFormat(phone52, '52');

console.log('\n');

// 测试3: 批量生成手机号
console.log('测试3: 批量生成手机号');
console.log('----------------------------------------');

const phones91 = generateRandomPhones(5, '91');
console.log(`生成5个区号91的手机号: ${phones91.join(', ')}`);

const phones55 = generateRandomPhones(5, '55');
console.log(`生成5个区号55的手机号: ${phones55.join(', ')}`);

const phones52 = generateRandomPhones(5, '52');
console.log(`生成5个区号52的手机号: ${phones52.join(', ')}`);

console.log('\n');

// 测试4: 验证批量生成的手机号格式
console.log('测试4: 验证批量生成的手机号格式');
console.log('----------------------------------------');

function validatePhonesFormat(phones, expectedPrefix) {
    let allValid = true;
    phones.forEach(phone => {
        if (!phone.startsWith(expectedPrefix)) {
            console.log(`❌ ${phone} - 错误，应该以 ${expectedPrefix} 开头`);
            allValid = false;
        }
    });
    if (allValid) {
        console.log(`✅ 所有手机号都正确以 ${expectedPrefix} 开头`);
    }
    return allValid;
}

validatePhonesFormat(phones91, '91');
validatePhonesFormat(phones55, '55');
validatePhonesFormat(phones52, '52');

console.log('\n');

// 测试5: 测试默认区号
console.log('测试5: 测试默认区号');
console.log('----------------------------------------');

const phoneDefault = generateRandomPhone();
console.log(`默认区号的手机号: ${phoneDefault}`);
validatePhoneFormat(phoneDefault, '91');

console.log('\n');
console.log('========================================');
console.log('区号功能测试完成');
console.log('========================================');
