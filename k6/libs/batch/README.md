# 批量操作公共库

## 概述

`BatchOperationBase.js` 提供了通用的批量操作功能，支持报表查询、活动创建等多种批量操作场景。

## 核心类

### BatchOperationBase

批量操作基类，提供以下通用功能：

#### 主要方法

- `setup()` - 通用初始化，获取登录Token
- `execute()` - 通用批量执行逻辑
- `executeItem()` - 执行单个项目
- `generateSummary()` - 生成汇总统计
- `performComparison()` - 执行对比分析
- `generateHandleSummary()` - 生成报告

#### 通用特性

- ✅ 实时进度显示
- ✅ 性能指标记录
- ✅ 错误处理
- ✅ 数据汇总
- ✅ 对比分析
- ✅ 多格式报告

### BatchReportOperation

报表查询操作类，继承自 `BatchOperationBase`：

#### 特化功能

- 报表记录数统计
- 报表数据对比
- 报表模拟数据生成

### BatchActivityOperation

活动创建操作类，继承自 `BatchOperationBase`：

#### 特化功能

- 活动ID显示
- 活动类型对比
- 活动详情展示
- 活动模拟数据生成

## 使用方法

### 1. 创建新的批量操作类

```javascript
import { BatchOperationBase } from '../../../libs/batch/BatchOperationBase.js';

export class BatchCustomOperation extends BatchOperationBase {
  constructor() {
    super('自定义操作');
  }

  // 重写显示信息
  getItemDisplayInfo(result) {
    return `自定义信息: ${result.customField}`;
  }

  // 重写模拟数据
  generateMockData(tag) {
    return {
      customField: 'mock_data',
      tag: tag,
      timestamp: new Date().toISOString()
    };
  }
}
```

### 2. 创建执行脚本

```javascript
import { BatchCustomOperation } from '../../../libs/batch/BatchOperationBase.js';
import { getCustomItemsByPriority } from '../../../config/custom.js';

const customOperation = new BatchCustomOperation();

export const options = customOperation.getOptions();
export const metrics = customOperation.metrics;

export function setup() {
  return customOperation.setup();
}

export default function (data) {
  const itemList = getCustomItemsByPriority();

  function executeCustom(item, data) {
    return item.func(data);
  }

  return customOperation.execute(data, itemList, executeCustom);
}

export function handleSummary(data) {
  return customOperation.generateHandleSummary(data);
}
```

## 配置文件结构

### 报表配置 (reports.js)

```javascript
export const reportConfigs = [
  {
    name: '报表名称',
    tag: 'unique_tag',
    func: reportFunction,
    priority: 1,
    description: '报表描述',
    category: 'category_name'
  }
];
```

### 活动配置 (activities.js)

```javascript
export const activityConfigs = [
  {
    name: '活动名称',
    tag: 'unique_activity_tag',
    func: activityFunction,
    priority: 1,
    description: '活动描述',
    category: 'category_name'
  }
];
```

## 指标说明

### 通用指标

- `{operation}_duration` - 操作耗时
- `{operation}_success` - 操作成功率
- `{operation}_count` - 操作总数
- `{operation}_data_size` - 数据量

### 示例

- `report_duration` - 报表查询耗时
- `activity_success` - 活动创建成功率

## 扩展点

### 1. 自定义显示信息

```javascript
getItemDisplayInfo(result) {
    // 返回要在控制台显示的信息
    return `自定义: ${result.customField}`;
}
```

### 2. 自定义对比信息

```javascript
getComparisonDisplayInfo(item1, item2) {
    // 返回对比时要显示的信息
    return `自定义对比: ${item1.data.field} vs ${item2.data.field}`;
}
```

### 3. 自定义模拟数据

```javascript
generateMockData(tag) {
    // 返回模拟数据
    return {
        mock: true,
        tag: tag,
        customField: 'mock_value'
    };
}
```

### 4. 自定义记录数计算

```javascript
countRecords(data) {
    // 自定义记录数计算逻辑
    if (data.customList) {
        return data.customList.length;
    }
    return 0;
}
```

## 迁移指南

### 从旧版本迁移

1. **替换导入**：

```javascript
// 旧版本
import { Trend, Rate, Counter } from 'k6/metrics';
import { AdminLogin } from '../login/adminlogin.test.js';

// 新版本
import { BatchReportOperation } from '../../../libs/batch/BatchOperationBase.js';
```

2. **简化脚本**：

```javascript
// 旧版本（大量重复代码）
export const options = { /* 复杂配置 */ };
export const metrics = { /* 指标定义 */ };
export function setup() { /* setup逻辑 */ };
export default function(data) { /* 执行逻辑 */ };
export function handleSummary(data) { /* 报告逻辑 */ };

// 新版本（简洁代码）
const reportOperation = new BatchReportOperation();
export const options = reportOperation.getOptions();
export const metrics = reportOperation.metrics;
export function setup() { return reportOperation.setup(); }
export default function(data) { return reportOperation.execute(data, reportList, executeFunction); }
export function handleSummary(data) { return reportOperation.generateHandleSummary(data); }
```

## 最佳实践

1. **配置分离** - 将项目配置放在独立的配置文件中
2. **函数命名** - 使用描述性的函数名，如 `queryDashboardFunc`
3. **错误处理** - 在具体函数中添加适当的错误处理
4. **数据验证** - 验证返回数据的格式和完整性
5. **日志记录** - 使用统一的日志记录方式

## 性能优化

1. **并行执行** - 对于独立的项目，可以考虑并行执行
2. **缓存机制** - 对重复查询的数据添加缓存
3. **批量请求** - 将多个小请求合并为批量请求
4. **连接复用** - 复用HTTP连接减少开销

## 故障排查

### 常见问题

1. **Token获取失败** - 检查登录配置和网络连接
2. **函数未定义** - 确保配置文件中的函数正确导入
3. **数据格式错误** - 检查返回数据的格式是否符合预期
4. **权限不足** - 确认Token具有执行相应操作的权限

### 调试技巧

1. **启用详细日志** - 在配置中增加日志级别
2. **单步执行** - 临时减少项目数量进行调试
3. **数据检查** - 在函数中添加数据验证和日志
4. **网络监控** - 使用网络工具监控请求过程
