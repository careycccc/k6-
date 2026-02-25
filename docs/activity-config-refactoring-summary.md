# 活动配置统一改造总结

## 改造目标

确保每个活动配置的开关和设置数据都能被正确设置，不再跳过任何配置项。

## 统一配置规则

### 1. 开关类配置
- **规则**：如果 `value1 = "1"` 表示已开启，先关闭等待1秒再开启；如果 `value1 = "0"` 表示已关闭，等待1秒后开启
- **目的**：确保每个开关都经过完整的开启流程，触发所有相关的初始化逻辑

### 2. 数字类配置
- **规则**：读取 `value1` 的值后进行 `+2` 操作再设置
- **目的**：确保数字配置每次都会更新，便于测试和验证

### 3. 字符类配置
- **规则**：根据提供的 payload 数据原封不动地请求
- **特殊处理**：如需添加时间戳等特殊要求，在调用时动态生成

## 核心工具

### activityConfigHandler.js

位置：`k6/tests/api/activity/common/activityConfigHandler.js`

提供以下功能：

1. **handleConfigSetting** - 处理单个配置项
2. **handleMultipleConfigs** - 批量处理多个配置项
3. **ConfigType** - 配置类型枚举（SWITCH/NUMBER/STRING）

## 已改造的活动

### 1. 锦标赛活动 (champion/createChampion.js)

**配置项：**
- `IsOpenChampion` - 开关类
- `ChampionCodingMultiple` - 数字类

**改造内容：**
- 移除了原有的条件判断逻辑（跳过已设置的配置）
- 使用统一配置处理器，确保所有配置都会被处理

### 2. 邀请转盘活动 (inviteTurntable/createInviteTurntable.js)

**配置项：**
- `IsOpenInvitedWheel` - 开关类
- `IsInvitedWheelCashToMainWallet` - 开关类
- `InvitedWheelWithdrawCashCodeWash` - 数字类
- `InvitedWheelCycleTime` - 数字类
- `InviteAutoRotate` - 开关类
- `FirstInvitedSpinWinProbabilityRate` - 数字类

**改造内容：**
- 简化了原有的6个独立配置处理逻辑
- 统一使用配置规则数组，代码更简洁

### 3. 每日每周任务 (dailyTasks/createDailyTasks.js)

**配置项：**
- `isOpenDailyWeeklyTask` - 开关类

**改造内容：**
- 处理了特殊的响应格式（单个配置对象）
- 确保配置对象正确包装后传递给处理器

### 4. 洗码活动 (codeWashing/createCodeWashing.js)

**配置项：**
- `IsOpenCodeWashing` - 开关类
- `IsSettleTheWashingAmount` - 开关类
- `IsFrontManualCodeWashing` - 开关类
- `CodeWashingMultiple` - 数字类

**改造内容：**
- 移除了5个独立的配置处理函数
- 使用统一配置规则，减少了约100行代码

### 5. 超级大奖活动 (MegaJackpot/createMegaJackpot.js)

**配置项：**
- `IsOpenJackpotRewardSwitch` - 开关类
- `JackpotEveryDayRewardLimitNum` - 数字类
- `JackpotRewardCodeAmount` - 数字类
- `JackpotRewardValidityTime` - 数字类

**改造内容：**
- 移除了循环处理配置的逻辑
- 简化了步骤编号（从6步减少到5步）
- 使用统一配置处理器

## 改造效果

### 代码简化

**改造前（以邀请转盘为例）：**
```javascript
// 6个独立的配置处理块，每个约20-30行代码
// 总计约150行代码

// 1. 检查并启用邀请转盘活动开关
const isOpenInvitedWheel = settings.isOpenInvitedWheel;
if (isOpenInvitedWheel && isOpenInvitedWheel.value1 !== "1") {
    // ... 20行代码
}

// 2. 检查并设置是否提现到主钱包
const isInvitedWheelCashToMainWallet = settings.isInvitedWheelCashToMainWallet;
if (isInvitedWheelCashToMainWallet && isInvitedWheelCashToMainWallet.value1 !== "0") {
    // ... 20行代码
}

// ... 重复4次
```

**改造后：**
```javascript
// 仅需定义配置规则，约10行代码

const configRules = [
    { settingKey: 'IsOpenInvitedWheel', configType: ConfigType.SWITCH },
    { settingKey: 'IsInvitedWheelCashToMainWallet', configType: ConfigType.SWITCH },
    { settingKey: 'InvitedWheelWithdrawCashCodeWash', configType: ConfigType.NUMBER },
    { settingKey: 'InvitedWheelCycleTime', configType: ConfigType.NUMBER },
    { settingKey: 'InviteAutoRotate', configType: ConfigType.SWITCH },
    { settingKey: 'FirstInvitedSpinWinProbabilityRate', configType: ConfigType.NUMBER }
];

const result = handleMultipleConfigs({
    token, settings, configRules,
    updateApi: updateSettingApi,
    tag: createInviteTurntableTag
});
```

### 统计数据

- **改造文件数量**：5个活动文件
- **处理配置项总数**：17个配置项
- **代码减少量**：约400行
- **维护性提升**：统一规则，易于扩展

## 配置规则执行流程

### 开关类配置流程

```
获取当前值
    ↓
value1 = "1"? ─── 是 ──→ 关闭开关 → 等待1秒 → 开启开关
    ↓
   否
    ↓
等待1秒 → 开启开关
```

### 数字类配置流程

```
获取当前值 (value1)
    ↓
转换为数字
    ↓
执行 +2 操作
    ↓
设置新值
```

### 字符类配置流程

```
获取目标值 (targetValue)
    ↓
直接设置
```

## 新活动接入步骤

1. **导入工具**
   ```javascript
   import { handleMultipleConfigs, ConfigType } from '../../common/activityConfigHandler.js';
   ```

2. **创建配置处理函数**
   ```javascript
   function checkAndConfigureYourActivitySettings(data) {
       // 1. 获取配置
       // 2. 解析配置
       // 3. 定义配置规则
       // 4. 调用 handleMultipleConfigs
   }
   ```

3. **在主函数中调用**
   ```javascript
   const settingResult = checkAndConfigureYourActivitySettings(data);
   if (!settingResult.success) {
       return { success: false, message: settingResult.message };
   }
   ```

## 文档和示例

### 文档位置
- **使用指南**：`k6/tests/api/activity/common/README.md`
- **示例代码**：`k6/tests/api/activity/common/activityConfigExample.js`
- **改造总结**：`docs/activity-config-refactoring-summary.md`（本文档）

### 示例内容
- 基本用法
- 单个配置处理
- 带 value2 字段的配置
- 不同响应格式处理
- 条件性配置处理
- 错误处理

## 注意事项

1. **配置键名大小写**
   - 工具会自动尝试驼峰和首字母大写两种格式
   - 例如：`IsOpenActivity` 和 `isOpenActivity` 都能识别

2. **等待时间**
   - 每个配置操作后自动等待 0.3 秒
   - 开关操作会等待 1 秒
   - 确保配置生效后再进行下一步操作

3. **错误处理**
   - 如果某个配置失败，会继续处理其他配置
   - 最后返回失败列表，便于排查问题

4. **日志记录**
   - 所有操作都会记录详细日志
   - 包括配置键名、当前值、目标值、操作结果

## 后续维护

### 添加新配置类型

如需添加新的配置类型，在 `activityConfigHandler.js` 中：

1. 在 `ConfigType` 枚举中添加新类型
2. 在 `handleConfigSetting` 的 switch 语句中添加处理逻辑
3. 创建对应的处理函数

### 修改配置规则

如需修改现有规则（如数字类改为 +3）：

1. 修改 `activityConfigHandler.js` 中的处理逻辑
2. 更新 `README.md` 文档
3. 更新本总结文档

### 测试建议

1. 测试开关类配置的两种状态（已开启/已关闭）
2. 测试数字类配置的边界值（0、负数、大数）
3. 测试字符类配置的特殊字符和长度
4. 测试配置失败的情况和错误处理

## 总结

通过引入统一的活动配置处理方案，我们实现了：

✅ **一致性**：所有活动配置遵循相同的规则
✅ **完整性**：不再跳过任何配置项，确保每个配置都被处理
✅ **可维护性**：代码简洁，易于理解和修改
✅ **可扩展性**：新活动可以快速接入
✅ **可测试性**：统一的处理逻辑便于测试

这个方案为后续的活动配置管理提供了坚实的基础。
/Users/zhangwensi/Desktop/k6config/k6-/k6/tests/api/uploadFile/img/outlink