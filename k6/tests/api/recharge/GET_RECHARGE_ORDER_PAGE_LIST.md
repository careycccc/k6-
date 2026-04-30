# GetRechargeOrderPageList 接口测试说明

## 功能概述

`GetRechargeOrderPageList` 接口用于查询指定用户的充值订单列表，支持按状态、时间范围、金额范围等条件进行筛选。

## 接口信息

- **接口路径**: `/api/RechargeOrder/GetRechargeOrderPageList`
- **请求方法**: POST
- **接口类型**: 后台管理接口（需要管理员权限）

## 请求参数

| 参数名 | 类型 | 必需 | 说明 | 示例值 |
|--------|------|------|------|--------|
| userId | number | 是 | 用户ID | 110655 |
| rechargeState | string | 否 | 充值状态 | Payed, Wait, Fail, Cancel, PendingReview |
| startTime | number | 否 | 开始时间（毫秒时间戳） | 1777402800000 |
| endTime | number | 否 | 结束时间（毫秒时间戳） | 1777489199999 |
| pageNo | number | 是 | 页码 | 1 |
| pageSize | number | 是 | 每页数量 | 20 |
| minActualAmount | string | 否 | 最小金额 | "" |
| maxActualAmount | string | 否 | 最大金额 | "" |
| dateType | number | 是 | 日期类型 | 0 |
| orderBy | string | 是 | 排序方式 | Desc |
| random | number | 是 | 随机数（自动生成） | 202832417010 |
| language | string | 是 | 语言（自动生成） | zh |
| signature | string | 是 | 签名（自动生成） | 2460ADAA20AE126184B28D2D4156D4A9 |
| timestamp | number | 是 | 时间戳（自动生成） | 1777534194 |

### 充值状态说明

- `Payed`: 已支付
- `Wait`: 等待中
- `Fail`: 失败
- `Cancel`: 已取消
- `PendingReview`: 待审核

## 响应数据

```json
{
  "code": 0,
  "msg": "Succeed",
  "msgCode": 0,
  "data": {
    "list": [
      {
        "orderNo": "订单号",
        "userId": 110655,
        "amount": 1000,
        "actualAmount": 1000,
        "rechargeState": "Payed",
        "rechargeType": "LocalBankCard",
        "createTime": 1777402800000,
        "payTime": 1777402900000
      }
    ],
    "total": 1,
    "pageNo": 1,
    "pageSize": 20
  }
}
```

## 使用方法

### 1. 基本用法（查询昨天的数据）

```bash
k6 run -e TENANT_ID=3004 k6/tests/api/recharge/getRechargeOrderPageList.test.js
```

### 2. 指定用户ID

```bash
k6 run -e TENANT_ID=3004 -e USER_ID=110655 k6/tests/api/recharge/getRechargeOrderPageList.test.js
```

### 3. 在代码中调用

```javascript
import { getRechargeOrderPageListFull } from './backendRechargeApi.js';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';

// 1. 管理员登录
const adminToken = tenantAdminLogin('3004');

// 2. 获取昨天的时间范围
const now = new Date();
const yesterday = new Date(now);
yesterday.setDate(yesterday.getDate() - 1);

const startTime = new Date(yesterday);
startTime.setHours(0, 0, 0, 0);

const endTime = new Date(yesterday);
endTime.setHours(23, 59, 59, 999);

// 3. 调用查询接口
const result = getRechargeOrderPageListFull(adminToken, {
    userId: 110655,
    rechargeState: 'Payed',
    startTime: startTime.getTime(),
    endTime: endTime.getTime(),
    pageNo: 1,
    pageSize: 20,
    minActualAmount: '',
    maxActualAmount: '',
    dateType: 0,
    orderBy: 'Desc'
});

// 4. 处理结果
if (result && result.data && result.data.list) {
    const orders = result.data.list;
    console.log(`找到 ${orders.length} 条订单`);
}
```

## 时间范围说明

### 默认行为（查询昨天的数据）

如果不指定 `startTime` 和 `endTime`，接口会自动查询昨天的数据：

- **开始时间**: 昨天 00:00:00
- **结束时间**: 昨天 23:59:59

### 自定义时间范围

```javascript
// 查询最近7天的数据
const now = Date.now();
const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

const result = getRechargeOrderPageListFull(adminToken, {
    userId: 110655,
    rechargeState: 'Payed',
    startTime: sevenDaysAgo,
    endTime: now,
    pageNo: 1,
    pageSize: 20
});
```

## 注意事项

1. **不影响其他功能**: 此接口仅用于查询，不会修改任何数据，不会影响其他充值相关功能。

2. **权限要求**: 需要管理员权限才能调用此接口。

3. **时间戳格式**: 所有时间参数都使用毫秒时间戳格式。

4. **分页查询**: 如果订单数量较多，建议使用分页查询，避免一次性加载过多数据。

5. **性能优化**: 
   - 尽量缩小时间范围
   - 使用具体的充值状态筛选
   - 合理设置 pageSize

## 示例 Payload

```json
{
  "userId": 110655,
  "rechargeState": "Payed",
  "startTime": 1777402800000,
  "endTime": 1777489199999,
  "pageNo": 1,
  "pageSize": 20,
  "minActualAmount": "",
  "maxActualAmount": "",
  "dateType": 0,
  "orderBy": "Desc",
  "random": 202832417010,
  "language": "zh",
  "signature": "2460ADAA20AE126184B28D2D4156D4A9",
  "timestamp": 1777534194
}
```

## 相关文件

- **测试文件**: `k6/tests/api/recharge/getRechargeOrderPageList.test.js`
- **API 封装**: `k6/tests/api/recharge/backendRechargeApi.js`
- **通用请求**: `k6/tests/api/common/request.js`

## 常见问题

### Q1: 为什么查询不到数据？

**A**: 请检查以下几点：
1. 用户ID是否正确
2. 时间范围是否正确（注意时区）
3. 充值状态是否匹配
4. 该用户在指定时间范围内是否有充值记录

### Q2: 如何查询所有状态的订单？

**A**: 将 `rechargeState` 设置为空字符串：

```javascript
const result = getRechargeOrderPageListFull(adminToken, {
    userId: 110655,
    rechargeState: '', // 查询所有状态
    startTime: startTime,
    endTime: endTime,
    pageNo: 1,
    pageSize: 20
});
```

### Q3: 如何按金额范围筛选？

**A**: 使用 `minActualAmount` 和 `maxActualAmount` 参数：

```javascript
const result = getRechargeOrderPageListFull(adminToken, {
    userId: 110655,
    rechargeState: 'Payed',
    startTime: startTime,
    endTime: endTime,
    pageNo: 1,
    pageSize: 20,
    minActualAmount: '1000',  // 最小金额 1000
    maxActualAmount: '5000'   // 最大金额 5000
});
```

## 更新日志

- **2026-04-30**: 初始版本，支持查询充值订单列表，默认查询昨天的数据
