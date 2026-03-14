# 充值模块

## 功能说明

提供多种充值方式的实现，目前已实现人工充值（后台管理员操作）。

## 文件结构

```
k6/tests/api/recharge/
├── manualRecharge.js     # 人工充值实现
└── README.md             # 说明文档
```

## 人工充值 (Manual Recharge)

### 功能描述

后台管理员为用户进行人工充值，需要管理员权限。

### 使用方法

```javascript
import { manualRecharge } from './recharge/manualRecharge.js';
import { AdminLogin } from './login/adminlogin.test.js';

// 1. 管理员登录
const adminToken = AdminLogin();

// 2. 执行充值
const result = manualRecharge(
    adminToken,      // 管理员token
    12345,           // 用户ID
    10000,           // 充值金额
    1,               // 打码量倍数（默认1）
    'Test recharge'  // 备注（可选）
);

// 3. 检查结果
if (result && result.success) {
    console.log('充值成功:', result);
} else {
    console.error('充值失败:', result);
}
```

### 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| adminToken | string | 是 | 管理员登录token |
| userId | number | 是 | 用户ID |
| rechargeAmount | number | 是 | 充值金额 |
| amountOfCode | number | 否 | 打码量倍数，默认1 |
| remark | string | 否 | 备注，默认'Manual recharge' |

### 返回值

成功时：
```javascript
{
    success: true,
    userId: 12345,
    amount: 10000,
    data: { /* 响应数据 */ }
}
```

失败时：
```javascript
{
    success: false,
    userId: 12345,
    amount: 10000,
    msgCode: 6001,
    msg: '错误信息'
}
```

### 批量充值

```javascript
import { batchManualRecharge } from './recharge/manualRecharge.js';

const rechargeList = [
    { userId: 12345, amount: 10000 },
    { userId: 12346, amount: 15000 },
    { userId: 12347, amount: 8000 }
];

const results = batchManualRecharge(adminToken, rechargeList, 1);

console.log('批量充值结果:', results);
// {
//     total: 3,
//     success: 2,
//     failed: 1,
//     details: [...]
// }
```

## API 接口

### 人工充值接口

- **接口**: `/api/ArtificialRechargeRecord/ArtificialRecharge`
- **方法**: POST
- **权限**: 需要管理员token

### 请求体

```javascript
{
    artificialRechargeType: 3,      // 充值类型：3=人工充值
    rechargeAmount: 10000,          // 充值金额
    remark: "Manual recharge",      // 备注
    amountOfCode: 1,                // 打码量倍数
    userId: 12345,                  // 用户ID
    random: "...",                  // 随机数
    language: "en",                 // 语言
    signature: "...",               // 签名
    timestamp: 1234567890           // 时间戳
}
```

### 响应体

```javascript
{
    code: 0,
    msgCode: 0,
    msg: "Succeed",
    data: {
        // 充值记录详情
    }
}
```

## 充值类型枚举

```javascript
export const RechargeType = {
    MANUAL: 3,  // 人工充值
    // 可以添加更多充值类型
    // AUTO: 1,     // 自动充值
    // BONUS: 2,    // 奖金充值
};
```

## 在多层级邀请中的使用

在 `inviteService.js` 中，充值功能已集成到用户处理流程中：

```javascript
// 步骤1: 获取用户ID
const userId = getUserIdByAccount(adminData.token, userDetail.userAccount);

// 步骤2: 充值
const rechargeAmount = Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000;
const rechargeResult = manualRecharge(adminData.token, userId, rechargeAmount, 1);

if (rechargeResult && rechargeResult.success) {
    // 充值成功，继续投注
    userDetail.recharged = true;
    userDetail.rechargeAmount = rechargeAmount;
} else {
    // 充值失败，跳过投注
    userDetail.recharged = false;
    continue;
}
```

## 注意事项

1. **管理员权限**：人工充值需要管理员token，普通用户token无法调用
2. **用户ID获取**：需要先通过 `getUserIdByAccount` 获取用户ID
3. **充值金额**：建议设置合理的充值金额范围（如5000-15000）
4. **打码量**：默认为1倍，可根据业务需求调整
5. **错误处理**：充值失败不会中断整个流程，会跳过该用户继续处理下一个

## 扩展功能

后续可以添加更多充值方式：

1. **在线支付充值**
2. **银行转账充值**
3. **第三方支付充值**
4. **优惠券充值**
5. **活动奖励充值**

每种充值方式可以创建独立的文件，如：
- `onlinePayment.js`
- `bankTransfer.js`
- `thirdPartyPayment.js`
- `couponRecharge.js`
- `activityReward.js`
