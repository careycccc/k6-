# 每日签到验证测试

## 功能说明

自动化验证每日签到活动的完整流程，包括：
1. 获取进行中的签到活动
2. 注册或登录用户
3. 检查用户VIP等级是否符合活动要求
4. 充值到最大金额以确保能签到
5. 手动领取签到奖励（可配置比例）
6. 验证签到记录
7. 生成详细报表

## 使用方法

### 1. 随机用户模式（默认）

生成随机用户进行验证：

```bash
# 基本用法：3个随机用户，80%手动领取
k6 run -e TENANT_ID=3004 k6/tests/api/activity/signin/signinValidation.test.js

# 指定用户数量
k6 run -e TENANT_ID=3004 -e USER_COUNT=2 k6/tests/api/activity/signin/signinValidation.test.js

# 指定手动领取比例（0-1之间）
k6 run -e TENANT_ID=3004 -e USER_COUNT=10 -e MANUAL_RECEIVE_RATE=0.5 k6/tests/api/activity/signin/signinValidation.test.js
```

### 2. 指定账号模式

使用指定的账号进行验证，系统会自动识别手机号和邮箱，并通过验证码方式登录：

```bash
# 使用指定账号（自动识别手机号和邮箱，使用验证码登录）
k6 run -e TENANT_ID=3004 \
  -e MODE=specified \
  -e ACCOUNTS="13800138000,test@example.com" \
  k6/tests/api/activity/signin/signinValidation.test.js

# 多个账号用逗号分隔
k6 run -e TENANT_ID=3002 \
  -e MODE=specified \
  -e ACCOUNTS="913190610583,913191269257,913170156615" \
  k6/tests/api/activity/signin/signinValidation.test.js
```

**账号格式说明：**
- 包含 `@` 符号的自动识别为邮箱
- 不包含 `@` 符号的自动识别为手机号
- 系统会自动发送验证码并完成登录
- 多个账号用逗号分隔

## 环境变量说明

| 变量名 | 说明 | 默认值 | 示例 |
|--------|------|--------|------|
| TENANT_ID | 租户ID | 3004 | 3004 |
| MODE | 验证模式 | random | random 或 specified |
| USER_COUNT | 随机用户数量（random模式） | 3 | 5 |
| MANUAL_RECEIVE_RATE | 手动领取比例 | 0.8 | 0.5 (表示50%) |
| ACCOUNTS | 指定账号列表（specified模式） | - | 13800138000,test@example.com |

## 验证流程

1. **获取活动列表**
   - 调用 `/api/DailyCheckIn/GetDailyCheckInList`
   - 筛选 `activityStatus=1` 且 `state=1` 的活动

2. **获取活动详情**
   - 调用 `/api/DailyCheckIn/GetDailyCheckInInfoById`
   - 解析 `targetDetail` 获取允许的VIP等级

3. **注册或登录用户**
   - 随机模式：先尝试手机注册，失败则邮箱注册
   - 指定模式：使用提供的账号登录

4. **检查VIP等级**
   - 调用 `/api/User/GetUserInfo`
   - 对比用户VIP等级与活动要求

5. **充值**
   - 获取 `rewardDetail` 中的最大 `rechargeAmount`
   - 使用混合充值策略充值

6. **等待10秒**

7. **手动领取（可选）**
   - 根据配置的比例决定是否手动领取
   - 调用 `/api/Activity/ReceiveDailyCheckInReward`

8. **等待5秒**

9. **验证签到记录**
   - 调用 `/api/DailyCheckIn/GetDailyCheckInUserList`
   - 检查是否有匹配的签到记录

## 报表说明

测试完成后会生成详细报表，包含：

### 详细表格
- 用户ID
- 活动ID
- 是否手动领取
- 验证是否成功
- VIP是否匹配
- 领取金额

### 统计信息
- 总用户数
- 成功验证数
- 失败验证数
- 成功率
- 总领取金额
- 平均领取金额

### 失败详情
- 失败用户的详细信息
- 错误原因

## 注意事项

1. **VIP等级匹配**
   - `targetDetail` 为空或 "0" 表示所有VIP等级都可参与
   - `targetDetail` 为 "1,2,3" 表示只有VIP1-3可参与
   - 即使VIP不匹配，也会继续执行流程并记录

2. **手动领取比例**
   - 设置为 0.8 表示 80% 的用户会手动领取
   - 设置为 1.0 表示所有用户都手动领取
   - 设置为 0.0 表示所有用户都不手动领取

3. **充值金额**
   - 自动选择 `rewardDetail` 中最大的 `rechargeAmount`
   - 确保用户能够完成签到

4. **测试时长**
   - 每个用户验证需要约 15-20 秒
   - 多个活动会依次验证
   - 建议设置合理的用户数量

## 示例输出

```
[SignInValidationTest] ========================================
[SignInValidationTest] 每日签到验证报表
[SignInValidationTest] ========================================

[SignInValidationTest] ┌──────────┬────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
[SignInValidationTest] │ 用户ID   │ 活动ID     │ 是否手动领取 │ 验证是否成功 │ VIP是否匹配  │ 领取金额     │
[SignInValidationTest] ├──────────┼────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
[SignInValidationTest] │ 136450   │ 74         │ 是           │ ✅ 成功      │ ✅ 匹配      │ 10.00        │
[SignInValidationTest] │ 136451   │ 74         │ 否           │ ✅ 成功      │ ✅ 匹配      │ 10.00        │
[SignInValidationTest] │ 136452   │ 74         │ 是           │ ✅ 成功      │ ❌ 不匹配    │ 10.00        │
[SignInValidationTest] └──────────┴────────────┴──────────────┴──────────────┴──────────────┴──────────────┘

[SignInValidationTest] ========== 统计信息 ==========
[SignInValidationTest] 总用户数: 3
[SignInValidationTest] 成功验证: 3
[SignInValidationTest] 失败验证: 0
[SignInValidationTest] 成功率: 100.00%
[SignInValidationTest] 总领取金额: 30.00
[SignInValidationTest] 平均领取金额: 10.00
```
