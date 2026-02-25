# 活动配置处理快速参考

## 快速开始

### 1. 导入工具

```javascript
import { handleMultipleConfigs, ConfigType } from '../../common/activityConfigHandler.js';
```

### 2. 定义配置规则

```javascript
const configRules = [
    { settingKey: 'IsOpenActivity', configType: ConfigType.SWITCH },
    { settingKey: 'ActivityMultiple', configType: ConfigType.NUMBER },
    { settingKey: 'ActivityName', configType: ConfigType.STRING, targetValue: 'MyActivity' }
];
```

### 3. 批量处理

```javascript
const result = handleMultipleConfigs({
    token,
    settings,
    configRules,
    updateApi: '/api/Activity/UpdateConfig',
    tag: 'myActivityTag'
});
```

## 配置类型

| 类型 | 枚举值 | 规则 | 示例 |
|------|--------|------|------|
| 开关 | `ConfigType.SWITCH` | value1="1"先关后开，"0"等1s后开 | `IsOpenActivity` |
| 数字 | `ConfigType.NUMBER` | 当前值 + 2 | `CodingMultiple` |
| 字符 | `ConfigType.STRING` | 使用 targetValue | `ActivityName` |

## 配置规则对象

```javascript
{
    settingKey: 'ConfigKey',        // 必需：配置键名
    configType: ConfigType.SWITCH,  // 必需：配置类型
    targetValue: 'value',           // STRING类型必需
    value2: ''                      // 可选：value2字段
}
```

## 常见模式

### 模式1：纯开关配置

```javascript
const configRules = [
    { settingKey: 'IsOpenActivity', configType: ConfigType.SWITCH },
    { settingKey: 'IsAutoSettle', configType: ConfigType.SWITCH }
];
```

### 模式2：混合配置

```javascript
const configRules = [
    { settingKey: 'IsOpenActivity', configType: ConfigType.SWITCH },
    { settingKey: 'CodingMultiple', configType: ConfigType.NUMBER },
    { settingKey: 'ActivityName', configType: ConfigType.STRING, targetValue: 'Test' }
];
```

### 模式3：动态值

```javascript
const timestamp = Date.now();
const configRules = [
    { 
        settingKey: 'ActivityName', 
        configType: ConfigType.STRING, 
        targetValue: `Activity_${timestamp}` 
    }
];
```

## 响应格式处理

### 格式1：标准响应

```javascript
// API返回: { msgCode: 0, data: {...} }
let settings;
if (settingsResult.msgCode !== undefined) {
    if (settingsResult.msgCode !== 0) {
        return { success: false, message: settingsResult.msg };
    }
    settings = settingsResult.data;
}
```

### 格式2：直接返回

```javascript
// API返回: { isOpenActivity: {...}, codingMultiple: {...} }
settings = settingsResult;
```

### 格式3：单个配置

```javascript
// API返回: { settingKey: "IsOpenActivity", value1: "1" }
settings = {
    [settingsResult.settingKey.charAt(0).toLowerCase() + settingsResult.settingKey.slice(1)]: settingsResult
};
```

## 错误处理

```javascript
const result = handleMultipleConfigs({...});

if (!result.success) {
    if (result.failedConfigs) {
        // 部分失败
        console.log('失败的配置:', result.failedConfigs);
    } else {
        // 完全失败
        console.log('错误:', result.message);
    }
}
```

## 完整示例

```javascript
function checkAndConfigureSettings(data) {
    const token = data.token;
    const getSettingApi = '/api/Activity/GetConfig';
    const updateSettingApi = '/api/Activity/UpdateConfig';

    try {
        // 1. 获取配置
        const settingsResult = sendRequest({}, getSettingApi, tag, false, token);
        
        // 2. 检查响应
        if (!settingsResult) {
            return { success: false, message: '获取配置失败' };
        }

        // 3. 解析配置
        let settings;
        if (settingsResult.msgCode !== undefined) {
            if (settingsResult.msgCode !== 0) {
                return { success: false, message: settingsResult.msg };
            }
            settings = settingsResult.data;
        } else {
            settings = settingsResult;
        }

        if (!settings) {
            return { success: false, message: '配置数据为空' };
        }

        // 4. 定义规则
        const configRules = [
            { settingKey: 'IsOpenActivity', configType: ConfigType.SWITCH },
            { settingKey: 'CodingMultiple', configType: ConfigType.NUMBER }
        ];

        // 5. 处理配置
        const result = handleMultipleConfigs({
            token,
            settings,
            configRules,
            updateApi: updateSettingApi,
            tag: 'myTag'
        });

        return result;

    } catch (error) {
        return { success: false, message: `配置失败: ${error}` };
    }
}
```

## 时间控制

| 操作 | 等待时间 | 说明 |
|------|----------|------|
| 开关关闭 | 1秒 | 确保关闭生效 |
| 开关开启 | 1秒 | 确保开启生效 |
| 数字设置 | 0.3秒 | 确保设置生效 |
| 字符设置 | 0.3秒 | 确保设置生效 |

## 调试技巧

### 1. 查看日志

所有操作都会记录日志，包括：
- 配置键名
- 当前值
- 目标值
- 操作结果

### 2. 检查配置对象

```javascript
logger.info(`配置对象: ${JSON.stringify(settings)}`);
```

### 3. 验证配置规则

```javascript
logger.info(`配置规则: ${JSON.stringify(configRules)}`);
```

## 常见问题

### Q: 配置键名大小写不匹配？
A: 工具会自动尝试驼峰和首字母大写格式

### Q: 如何跳过某些配置？
A: 只在 configRules 中包含需要处理的配置

### Q: 如何处理特殊的字符串？
A: 使用 targetValue 动态生成

### Q: 配置失败怎么办？
A: 检查 result.failedConfigs 获取失败详情

## 相关文档

- 详细文档：`README.md`
- 示例代码：`activityConfigExample.js`
- 改造总结：`../../docs/activity-config-refactoring-summary.md`
