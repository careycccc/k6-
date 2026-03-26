# 区号功能使用指南

## 概述

本项目现在支持多区号功能，可以在登录和注册时指定不同的国家区号。目前支持的区号包括：
- `91` - 默认区号（印度）
- `55` - 巴西区号
- `52` - 墨西哥区号

## 功能特性

1. **可配置区号**：在注册和登录时可以指定区号
2. **环境配置支持**：每个租户环境可以配置默认区号
3. **向后兼容**：不指定区号时使用默认值 `91`
4. **多租户支持**：不同租户可以使用不同的区号

## 使用方法

### 1. 生成指定区号的手机号

```javascript
import { generateRandomPhone, generateRandomPhones } from './tests/utils/accountGenerator.js';

// 生成单个手机号
const phone91 = generateRandomPhone('91');  // 生成区号91的手机号
const phone55 = generateRandomPhone('55');  // 生成区号55的手机号
const phone52 = generateRandomPhone('52');  // 生成区号52的手机号

// 批量生成手机号
const phones91 = generateRandomPhones(5, '91');  // 生成5个区号91的手机号
const phones55 = generateRandomPhones(5, '55');  // 生成5个区号55的手机号
```

### 2. 使用指定区号注册账号

```javascript
import { registerPhoneAccount, registerAccountsForTenant } from './services/registerService.js';

// 使用区号91注册单个账号
const account91 = registerPhoneAccount('3004', 'qwer1234', '91');

// 使用区号55注册单个账号
const account55 = registerPhoneAccount('3004', 'qwer1234', '55');

// 使用区号52注册单个账号
const account52 = registerPhoneAccount('3004', 'qwer1234', '52');

// 使用默认区号（从环境配置读取）
const accountDefault = registerPhoneAccount('3004', 'qwer1234');

// 批量注册账号
const accounts = registerAccountsForTenant('3004', 'phone', 5, 'qwer1234', '55');
```

### 3. 直接使用注册函数

```javascript
import { phoneRegister, phoneRegisterByInvite } from './tests/api/login/register.test.js';

// 前台总代注册方式
const response = phoneRegister(
    '553201234567',  // 手机号
    { token: adminToken },  // adminToken
    'qwer1234',  // 密码
    '',  // 邀请码
    null,  // 验证码ID
    '55'  // 区号
);

// 邀请注册方式
const response = phoneRegisterByInvite(
    '553201234567',  // 手机号
    'INVITE123',  // 邀请码
    { token: adminToken },  // adminToken
    'qwer1234',  // 密码
    '',  // turnstileToken
    null,  // customUrls
    '55'  // 区号
);
```

## 环境配置

每个租户环境都可以配置默认区号：

```javascript
// k6/config/envconfig.js

export const ENV_3001 = {
    BASE_ADMIN_URL: "https://ar666999.club",
    BASE_DESK_URL: "https://arplatsaassit1.club",
    // ... 其他配置
    COUNTRY_CODE: "91"  // 默认区号
};

export const ENV_3002 = {
    BASE_ADMIN_URL: "https://arsitasdfghjklg.com",
    BASE_DESK_URL: "https://arplatsaassit2.club",
    // ... 其他配置
    COUNTRY_CODE: "91"  // 默认区号
};
```

## 测试

运行区号功能测试：

```bash
node k6-/test-country-code.js
```

测试内容包括：
1. 生成不同区号的手机号
2. 验证手机号格式
3. 批量生成手机号
4. 验证批量生成的手机号格式
5. 测试默认区号

## API 变更

### accountGenerator.js

```javascript
// 新增参数
export function generateRandomPhone(countryCode = '91')
export function generateRandomPhones(count, countryCode = '91')
```

### registerService.js

```javascript
// 新增参数
export function registerAccountsForTenant(tenantId, registerType, count, password, countryCode = null)
export function registerPhoneAccount(tenantId, password, countryCode = null)
```

### register.test.js

```javascript
// 新增参数
export function phoneRegister(userName, data, password, inviteCode, captchaId, countryCode = '91')
export function phoneRegisterByInvite(userName, inviteCode, data, password, turnstileToken, customUrls, countryCode = '91')
```

## 注意事项

1. **区号格式**：区号必须是字符串类型，如 `'91'`、`'55'`、`'52'`
2. **默认值**：如果不指定区号，系统会使用环境配置中的 `COUNTRY_CODE`，如果环境配置也没有，则使用默认值 `'91'`
3. **手机号格式**：生成的手机号格式为 `区号 + 月日 + 随机数`，总长度为12位
4. **向后兼容**：现有代码不需要修改，会自动使用默认区号 `'91'`

## 示例场景

### 场景1：为巴西用户注册账号

```javascript
import { registerPhoneAccount } from './services/registerService.js';

const brazilAccount = registerPhoneAccount('3004', 'qwer1234', '55');
console.log('巴西账号:', brazilAccount);
// 输出: { username: '553201234567', password: 'qwer1234', countryCode: '55', ... }
```

### 场景2：为墨西哥用户批量注册账号

```javascript
import { registerAccountsForTenant } from './services/registerService.js';

const mexicoAccounts = registerAccountsForTenant('3004', 'phone', 10, 'qwer1234', '52');
console.log('墨西哥账号数量:', mexicoAccounts.length);
// 输出: 墨西哥账号数量: 10
```

### 场景3：混合区号注册

```javascript
import { registerPhoneAccount } from './services/registerService.js';

const account91 = registerPhoneAccount('3004', 'qwer1234', '91');
const account55 = registerPhoneAccount('3004', 'qwer1234', '55');
const account52 = registerPhoneAccount('3004', 'qwer1234', '52');

console.log('区号91账号:', account91.username);
console.log('区号55账号:', account55.username);
console.log('区号52账号:', account52.username);
```

## 总结

通过本次更新，项目现在支持多区号功能，可以灵活地为不同地区的用户注册账号。所有功能都保持了向后兼容性，现有代码无需修改即可继续使用。



ArUpi
Net_ArUpi
https://apiarb-sit.35456462.com
ArUpi
127.0.0.1|123.201.213.207|8.219.195.67|47.236.134.126|8.219.243.223