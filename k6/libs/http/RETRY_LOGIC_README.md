# 请求重试逻辑说明

## 概述

当遇到 `"Too frequent access, please try again later"` 错误（msgCode: 13）时，系统会自动等待3秒后重试请求。

## 已实现重试逻辑的模块

### 1. 后台人工充值 (`manualRecharge.js`)

**函数**: `manualRecharge()`

**默认重试次数**: 3次

**使用示例**:
```javascript
import { manualRecharge } from './recharge/manualRecharge.js';

// 使用默认重试次数（3次）
const result = manualRecharge(adminToken, userId, 1000, 1, 'Test recharge');

// 自定义重试次数（5次）
const result = manualRecharge(adminToken, userId, 1000, 1, 'Test recharge', 5);
```

**重试逻辑**:
- 遇到 msgCode === 13 或 msg 包含 "Too frequent access" 时触发重试
- 每次重试前等待 3 秒
- 达到最大重试次数后返回失败结果

### 2. 通用租户请求 (`tenantRequestWithRetry.js`)

**函数**: `tenantRequestWithRetry()` 和 `tenantQueryRequestWithRetry()`

**默认重试次数**: 3次

**使用示例**:
```javascript
import { tenantRequestWithRetry } from '../../../libs/http/tenantRequestWithRetry.js';

// 基本使用
const response = tenantRequestWithRetry(
    '/api/SomeEndpoint',
    { param1: 'value1' },
    { token: userToken, isDesk: true }
);

// 自定义重试次数
const response = tenantRequestWithRetry(
    '/api/SomeEndpoint',
    { param1: 'value1' },
    { token: userToken, isDesk: true, tag: 'MyAPI' },
    5  // 最大重试5次
);

// 查询请求（带分页）
import { tenantQueryRequestWithRetry } from '../../../libs/http/tenantRequestWithRetry.js';

const response = tenantQueryRequestWithRetry(
    '/api/QueryEndpoint',
    { filter: 'value' },
    { token: userToken, isDesk: false }
);
```

## 重试机制详解

### 触发条件

重试会在以下情况触发：
1. 响应的 `msgCode === 13`
2. 响应的 `msg` 包含 `"Too frequent access"` 或 `"please try again later"`

### 重试流程

```
第1次请求 → 失败（Too frequent access）
    ↓
等待 3 秒
    ↓
第2次请求 → 失败（Too frequent access）
    ↓
等待 3 秒
    ↓
第3次请求 → 失败（Too frequent access）
    ↓
等待 3 秒
    ↓
第4次请求（最后一次）→ 成功/失败
```

### 日志输出示例

```
[ManualRecharge] 访问过于频繁 (1/4)
[ManualRecharge] 等待3秒后重试 (1/3)...
[ManualRecharge] 访问过于频繁 (2/4)
[ManualRecharge] 等待3秒后重试 (2/3)...
[ManualRecharge] ✅ 充值成功: userId=123456, amount=1000
```

## 在批量测试中的应用

### 批量充值提现测试

`batchRechargeWithdraw.test.js` 和 `batchRechargeWithdrawWithBet.test.js` 已经通过 `hybridRecharge()` → `backendRecharge()` → `manualRecharge()` 自动使用重试逻辑。

**无需修改现有代码**，重试逻辑会自动生效。

### 其他需要重试的场景

如果你的代码中有其他接口也遇到 "Too frequent access" 错误，可以：

1. **使用 `tenantRequestWithRetry` 替换 `tenantRequest`**:
```javascript
// 修改前
import { tenantRequest } from '../../../libs/http/tenantRequest.js';
const response = tenantRequest(api, payload, options);

// 修改后
import { tenantRequestWithRetry } from '../../../libs/http/tenantRequestWithRetry.js';
const response = tenantRequestWithRetry(api, payload, options);
```

2. **或者在函数级别添加重试逻辑**（参考 `manualRecharge` 的实现）

## 配置建议

### 推荐的重试次数

- **后台充值**: 3-5次（因为充值操作比较重要）
- **查询操作**: 2-3次（查询失败影响较小）
- **提现操作**: 3-5次（重要操作）
- **普通API**: 2-3次

### 等待时间

当前固定为 **3秒**，这是根据 API 限流策略设定的。如果需要调整，可以修改：
- `manualRecharge.js` 中的 `sleep(3)`
- `tenantRequestWithRetry.js` 中的 `sleep(3)`

## 错误处理

### 达到最大重试次数后

函数会返回最后一次请求的响应，包含错误信息：
```javascript
{
    success: false,
    userId: 123456,
    amount: 1000,
    msgCode: 13,
    msg: "Too frequent access, please try again later"
}
```

### 其他错误（非频率限制）

其他类型的错误**不会触发重试**，会立即返回错误响应。这样可以避免不必要的等待。

## 性能影响

### 最坏情况

如果每次请求都失败并重试3次：
- 总耗时 = 原始请求时间 + (3秒 × 3次) = 原始时间 + 9秒

### 最佳情况

如果第一次请求就成功：
- 总耗时 = 原始请求时间（无额外开销）

### 批量操作

在批量测试中（如100个账号），如果10%的请求需要重试：
- 额外耗时 ≈ 10个账号 × 3秒 = 30秒

## 监控和调试

### 查看重试日志

在测试输出中搜索以下关键词：
- `"访问过于频繁"`
- `"等待3秒后重试"`
- `"达到最大重试次数"`

### 统计重试次数

可以在代码中添加计数器来统计重试情况：
```javascript
let retryCount = 0;
// 在重试逻辑中
if (attempt > 0) {
    retryCount++;
}
```

## 相关文件

- `k6/libs/http/tenantRequestWithRetry.js` - 通用重试包装器
- `k6/tests/api/recharge/manualRecharge.js` - 后台充值重试实现
- `k6/tests/api/recharge/rechargeService.js` - 混合充值服务（使用重试）
- `k6/tests/api/batch/batchRechargeWithdraw.test.js` - 批量测试（自动使用重试）
- `k6/tests/api/batch/batchRechargeWithdrawWithBet.test.js` - 批量测试（自动使用重试）

## 更新日期

2026-03-28
