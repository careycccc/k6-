# 活动配置统一处理方案

## 概述

为了确保所有活动配置的一致性和可维护性，我们创建了统一的活动配置处理工具 `activityConfigHandler.js`。

## 配置规则

### 1. 开关类配置 (ConfigType.SWITCH)

**规则：**
- 如果当前值是 `"1"` (已开启)：先关闭，等待1秒，再开启
- 如果当前值是 `"0"` (已关闭)：等待1秒，再开启

**目的：** 确保每个开关都经过完整的开启流程，触发所有相关的初始化逻辑。

### 2. 数字类配置 (ConfigType.NUMBER)

**规则：**
- 读取 `value1` 的当前值
- 对当前值执行 `+2` 操作
- 设置新值

**目的：** 确保数字配置每次都会更新，便于测试和验证。

### 3. 字符类配置 (ConfigType.STRING)

**规则：**
- 使用提供的 `targetValue` 原封不动地设置
- 如果有特殊要求（如添加时间戳），在调用时指定

**目的：** 保持字符串配置的灵活性，支持各种自定义需求。

## 使用方法

### 基本用法

```javascript
import { handleMultipleConfigs, ConfigType } from '../../common/activityConfigHandler.js';

// 定义配置规则
const configRules = [
    { settingKey: 'IsOpenActivity', configType: ConfigType.SWITCH },
    { settingKey: 'ActivityCodingMultiple', configType: ConfigType.NUMBER },
    { settingKey: 'ActivityName', configType: ConfigType.STRING, targetValue: 'MyActivity' }
];

// 批量处理配置
const result = handleMultipleConfigs({
    token,
    settings,           // 从API获取的配置对象
    configRules,
    updateApi: '/api/Activity/UpdateConfig',
    tag: 'myActivityTag'
});

if (result.success) {
    console.log('所有配置处理成功');
} else {
    console.log('部分配置处理失败:', result.failedConfigs);
}
```

### 单个配置处理

```javascript
import { handleConfigSetting, ConfigType } from '../../common/activityConfigHandler.js';

const result = handleConfigSetting({
    token,
    settingKey: 'IsOpenActivity',
    currentSetting: settings.isOpenActivity,  // 当前配置对象
    configType: ConfigType.SWITCH,
    updateApi: '/api/Activity/UpdateConfig',
    tag: 'myActivityTag'
});
```

## 已改造的活动

以下活动已经使用统一配置处理方案：

1. **锦标赛活动** (`champion/createChampion.js`)
   - IsOpenChampion (开关)
   - ChampionCodingMultiple (数字)

2. **邀请转盘活动** (`inviteTurntable/createInviteTurntable.js`)
   - IsOpenInvitedWheel (开关)
   - IsInvitedWheelCashToMainWallet (开关)
   - InvitedWheelWithdrawCashCodeWash (数字)
   - InvitedWheelCycleTime (数字)
   - InviteAutoRotate (开关)
   - FirstInvitedSpinWinProbabilityRate (数字)

3. **每日每周任务** (`dailyTasks/createDailyTasks.js`)
   - isOpenDailyWeeklyTask (开关)

4. **洗码活动** (`codeWashing/createCodeWashing.js`)
   - IsOpenCodeWashing (开关)
   - IsSettleTheWashingAmount (开关)
   - IsFrontManualCodeWashing (开关)
   - CodeWashingMultiple (数字)

5. **超级大奖活动** (`MegaJackpot/createMegaJackpot.js`)
   - IsOpenJackpotRewardSwitch (开关)
   - JackpotEveryDayRewardLimitNum (数字)
   - JackpotRewardCodeAmount (数字)
   - JackpotRewardValidityTime (数字)

## 新活动接入指南

### 步骤1：导入工具

```javascript
import { handleMultipleConfigs, ConfigType } from '../../common/activityConfigHandler.js';
```

### 步骤2：创建配置处理函数

```javascript
function checkAndConfigureYourActivitySettings(data) {
    const token = data.token;
    const getSettingApi = '/api/YourActivity/GetConfig';
    const updateSettingApi = '/api/YourActivity/UpdateConfig';

    try {
        // 1. 获取当前配置
        const settingsResult = sendRequest({}, getSettingApi, yourTag, false, token);
        
        // 2. 解析配置（根据API响应格式调整）
        let settings;
        if (settingsResult.msgCode !== undefined) {
            if (settingsResult.msgCode !== 0) {
                return { success: false, message: settingsResult.msg };
            }
            settings = settingsResult.data;
        } else {
            settings = settingsResult;
        }

        // 3. 定义配置规则
        const configRules = [
            { settingKey: 'IsOpenYourActivity', configType: ConfigType.SWITCH },
            { settingKey: 'YourActivityMultiple', configType: ConfigType.NUMBER },
            { settingKey: 'YourActivityName', configType: ConfigType.STRING, targetValue: 'CustomName' }
        ];

        // 4. 批量处理配置
        const result = handleMultipleConfigs({
            token,
            settings,
            configRules,
            updateApi: updateSettingApi,
            tag: yourTag
        });

        return result;

    } catch (error) {
        return { success: false, message: `配置失败: ${error}` };
    }
}
```

### 步骤3：在主函数中调用

```javascript
export function createYourActivity(data) {
    // ... 其他逻辑 ...

    // 检查并配置活动设置
    const settingResult = checkAndConfigureYourActivitySettings(data);
    if (!settingResult.success) {
        return {
            success: false,
            tag: yourTag,
            message: `配置活动设置失败: ${settingResult.message}`
        };
    }

    // ... 继续创建活动 ...
}
```

## 注意事项

1. **配置键名大小写**：工具会自动尝试驼峰和首字母大写两种格式
2. **等待时间**：每个配置操作后会自动等待0.3秒，开关操作会等待1秒
3. **错误处理**：如果某个配置失败，会继续处理其他配置，最后返回失败列表
4. **日志记录**：所有操作都会记录详细日志，便于调试

## 配置类型枚举

```javascript
export const ConfigType = {
    SWITCH: 'switch',      // 开关类
    NUMBER: 'number',      // 数字类
    STRING: 'string'       // 字符类
};
```

## 常见问题

### Q: 如何处理特殊的字符串配置（如需要添加时间戳）？

A: 在调用时动态生成 targetValue：

```javascript
const timestamp = Date.now();
const configRules = [
    { 
        settingKey: 'ActivityName', 
        configType: ConfigType.STRING, 
        targetValue: `MyActivity_${timestamp}` 
    }
];
```

### Q: 如果API响应格式不同怎么办？

A: 在配置处理函数中添加响应格式解析逻辑，确保 `settings` 对象包含所有配置项。

### Q: 如何跳过某些配置？

A: 只在 `configRules` 数组中包含需要处理的配置项即可。

## 维护建议

1. 所有新活动都应使用此统一方案
2. 如需修改配置规则，请更新 `activityConfigHandler.js` 和本文档
3. 定期检查已改造活动的配置逻辑是否符合最新规则
