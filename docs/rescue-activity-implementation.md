# 亏损救援金活动实现文档

## 概述

已完成亏损救援金活动的自动化创建功能，包括图片上传和活动配置。

## 实现内容

### 1. 核心文件

#### `k6/tests/api/activity/rescue/createRescue.js`
- 主要功能：创建亏损救援金活动
- 包含功能：
  - 图片上传（活动封面 + 3种语言的规则描述图）
  - 时间自动计算（开始时间：第二天00:00:00，结束时间：开始后第5天23:59:59）
  - 活动名称自动添加时间戳
  - 完整的错误处理和重试机制

#### `k6/tests/api/activity/rescue/rescue.test.js`
- 查询亏损救援金领奖记录
- 统计领奖金额、人数和次数

### 2. 图片资源

路径：`k6/tests/api/uploadFile/img/rescue/`

| 文件名 | 用途 | 状态 |
|--------|------|------|
| 1.png | 活动封面 | ✅ 已存在 |
| rule_hi.png | 印地语规则说明 | ✅ 已创建（占位符） |
| rule_en.png | 英语规则说明 | ✅ 已创建（占位符） |
| rule_zh.png | 中文规则说明 | ✅ 已创建（占位符） |

**注意**: 规则说明图片目前使用的是1.png的副本作为占位符，实际使用时需要替换为正确的规则说明图片。

### 3. API接口

#### 创建活动
- **接口**: `POST /api/LossRelief/Add`
- **认证**: Bearer Token
- **请求体**: 包含活动配置的JSON对象

#### 图片上传
- **接口**: `POST /api/UploadFile/UploadToOss`
- **认证**: Bearer Token
- **类型**: multipart/form-data

## 活动配置详情

### 时间配置
```javascript
开始时间: 当前时间的第二天 00:00:00
结束时间: 开始时间后第5天 23:59:59
周期轮次: [startTime.getTime(), endTime.getTime()]
```

### 活动参数
```javascript
{
    activityName: "亏损救援金-按比例返还-jili限制_${timestamp}",
    priority: 10,
    cycleRoundDay: 1,
    targetDetail: "3,4,5,6,7,8,9,10,11,12", // VIP等级
    recivedLimitDay: 1, // 每天可领取1次
    codingMultiple: 3 // 打码倍数
}
```

### 奖励配置
```javascript
rewardConfigDetail: {
    rewardType: 0, // 按比例返还
    rewardConfig: [
        { index: 1, minLossAmount: 100, returnRate: 1, maxReturnAmount: 1 },
        { index: 2, minLossAmount: 1000, returnRate: 2, maxReturnAmount: 15 },
        { index: 3, minLossAmount: 10000, returnRate: 5, maxReturnAmount: 500 }
    ]
}
```

### 游戏限制
- **厂商**: JILI
- **游戏数量**: 190+ 款游戏
- **游戏代码**: 详见代码中的gameCode数组

### 多语言支持
- **印地语** (hi): हानि राहत कोष - आनुपातिक वापसी
- **英语** (en): Loss Relief Fund - Proportional Refund
- **中文** (zh): 亏损救援金-按比例返还

## 使用方法

### 基本用法

```javascript
import { createRescue } from './createRescue.js';

export default function(data) {
    const result = createRescue(data);
    
    if (result.success) {
        console.log('活动创建成功');
    } else {
        console.log('活动创建失败:', result.message);
    }
}
```

### 数据对象要求

```javascript
const data = {
    token: 'YOUR_TOKEN_HERE', // 必需
    rescueImagePath: 'xxx', // 可选，如果已上传
    rescueRuleImageHi: 'xxx', // 可选，如果已上传
    rescueRuleImageEn: 'xxx', // 可选，如果已上传
    rescueRuleImageZh: 'xxx' // 可选，如果已上传
};
```

## 特性

### 1. 智能图片上传
- 自动检测图片是否已上传
- 失败自动重试（间隔2秒）
- 支持图片缓存，避免重复上传

### 2. 时间自动计算
- 开始时间：第二天00:00:00
- 结束时间：开始后第5天23:59:59
- 自动生成周期轮次时间戳

### 3. 活动名称唯一性
- 自动添加时间戳后缀
- 格式：`亏损救援金-按比例返还-jili限制_${timestamp}`

### 4. 完整的错误处理
- Token验证
- 图片上传失败处理
- API调用失败处理
- 详细的日志记录

### 5. 图片路径处理
- 活动封面使用相对路径（imageUrl）
- 规则描述使用完整URL（包含域名）
- 自动构建正确的图片URL

## 返回结果

```javascript
{
    success: boolean,
    tag: 'createRescue',
    message: string
}
```

## 测试示例

参考文件：`k6/tests/api/activity/rescue/example.js`

```bash
# 运行示例
k6 run k6/tests/api/activity/rescue/example.js
```

## 注意事项

1. **Token必需**: 必须提供有效的Bearer Token
2. **图片准备**: 确保所有图片文件存在于指定路径
3. **规则图片**: 当前使用占位符，实际使用时需要替换
4. **时间计算**: 活动时间自动计算，无需手动设置
5. **活动名称**: 自动添加时间戳，确保唯一性
6. **图片URL**: 
   - imageUrl使用相对路径（如：3004/other/xxx.webp）
   - ruleDescription使用完整URL（如：https://sit.arsaassit-pub.club/3004/other/xxx.webp）

## 后续优化建议

1. 添加活动状态查询功能
2. 支持活动编辑和删除
3. 添加更多的活动配置选项
4. 支持批量创建活动
5. 添加活动数据统计功能

## 相关文档

- [README.md](../k6/tests/api/activity/rescue/README.md) - 详细使用说明
- [example.js](../k6/tests/api/activity/rescue/example.js) - 使用示例
- [图片说明](../k6/tests/api/uploadFile/img/rescue/README.md) - 图片要求说明
