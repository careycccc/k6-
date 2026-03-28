# 批量提现密码修复说明

## 问题描述

在执行批量充值提现测试时，遇到以下错误：

```
ERRO[0020] [WithdrawApply] 提现申请失败: {"code":11,"msg":"Please set withdraw password","msgCode":10038}
```

**根本原因**: 在提现申请前，没有设置提现密码。

## 修复内容

### 1. `batchRechargeWithdraw.test.js` (无投注版本)

#### 修改点 1: 导入 `setWithdrawPassword` 函数
```javascript
// 修改前
import { getWithdrawBasicInfo, getUserWithdrawWallet, withdrawApply } from '../withdraw/withdrawApi.js';

// 修改后
import { getWithdrawBasicInfo, setWithdrawPassword, getUserWithdrawWallet, withdrawApply } from '../withdraw/withdrawApi.js';
```

#### 修改点 2: 在提现流程中添加步骤3 - 设置提现密码
```javascript
// 步骤2: 添加钱包
const walletsAdded = addAllWallets(adminToken, account.userId);
sleep(1);

// 步骤3: 设置提现密码 (新增)
console.log(`[${tag}] [${index}/${total}] 步骤3: 设置提现密码...`);
const pwdResult = setWithdrawPassword(account.token, "123456");
if (!pwdResult || (pwdResult.msgCode !== 0 && pwdResult.msgCode !== undefined)) {
    console.warn(`[${tag}] [${index}/${total}] ⚠️ 设置提现密码可能失败，但继续尝试: ${JSON.stringify(pwdResult)}`);
} else {
    console.log(`[${tag}] [${index}/${total}] ✅ 提现密码设置成功`);
}

// 步骤4: 获取提现基础信息 (原步骤3，重新编号)
const withdrawInfo = getWithdrawBasicInfo(account.token);
```

#### 修改点 3: 重新编号后续步骤
- 原步骤 3-8 → 新步骤 4-9
- 所有日志输出中的步骤编号已更新

### 2. `batchRechargeWithdrawWithBet.test.js` (带投注版本)

此文件在之前的修复中已经添加了 `setWithdrawPassword` 步骤，本次确认无需修改。

## 完整提现流程 (修复后)

```
1. 获取余额
2. 添加提现钱包
3. 设置提现密码 ⭐ (新增步骤)
4. 获取提现基础信息
5. 检查提现条件 (次数、打码量)
6. 计算提现金额
7. 选择提现通道
8. 获取钱包ID
9. 提交提现申请
10. 后台审核 (可选)
```

## 测试验证

修复后，可以使用以下命令测试：

```bash
# 测试无投注版本
./k6/tests/api/batch/run-batch-recharge-withdraw.sh

# 测试带投注版本
./k6/tests/api/batch/run-batch-with-bet.sh
```

## 技术细节

### `setWithdrawPassword` 函数说明

- **位置**: `k6/tests/api/withdraw/withdrawApi.js`
- **API**: `/api/User/SetWithdrawPassword`
- **参数**: `{ withdrawPassword: "123456" }`
- **返回**: 响应对象，通过 `msgCode` 判断是否成功
- **容错**: 即使设置失败（如已设置过），也会继续执行提现流程

### 错误处理策略

```javascript
const pwdResult = setWithdrawPassword(account.token, "123456");
if (!pwdResult || (pwdResult.msgCode !== 0 && pwdResult.msgCode !== undefined)) {
    // 仅警告，不阻断流程
    console.warn(`设置提现密码可能失败，但继续尝试`);
} else {
    console.log(`✅ 提现密码设置成功`);
}
```

这种设计允许：
- 首次设置密码成功
- 重复设置时不会因为"已设置"错误而中断流程
- 其他非致命错误也不会阻断提现

## 相关文件

- `k6/tests/api/batch/batchRechargeWithdraw.test.js` - 已修复
- `k6/tests/api/batch/batchRechargeWithdrawWithBet.test.js` - 已修复
- `k6/tests/api/withdraw/withdrawApi.js` - 提现API封装
- `k6/tests/api/withdraw/withdraw.test.js` - 参考实现

## 修复日期

2026-03-28
