# 标签使用指南

## 标签类型说明

标签系统包含三种类型的标签，每种标签都有独立的数据存储和ID映射。

### 1. 手动标签 (Manual Tags)
**用途**: 人工定义的标签，用于标记特定类型的玩家

**创建的标签**:
- 土豪玩家 (type: 1)
- 平民玩家 (type: 4)
- 异常玩家 (type: 3)

**数据存储**:
```javascript
data.tagList          // 手动标签完整列表
data.tagIdMap         // 手动标签名称到ID的映射
```

**使用示例**:
```javascript
// 获取"土豪玩家"标签的ID
const richPlayerId = data.tagIdMap["土豪玩家"];

// 获取所有手动标签
const allManualTags = data.tagList;
```

---

### 2. 基础标签 (Basic Tags)
**用途**: 基于系统条件自动生成的标签，用于定义玩家的基础属性范围

**创建的标签**:
- 基础标签-重提差 (conditionType: 1, 范围: 100-1000)
- 基础标签-vip (conditionType: 3, 范围: 3-8)
- 基础标签-充值总金额 (conditionType: 4, 范围: 10000-100000)
- 基础标签-提现总金额 (conditionType: 6, 范围: 1000-100000)
- 基础标签-流失天数 (conditionType: 8, 范围: 3-10)
- 基础标签-注册天数 (conditionType: 11, 范围: 2-10)

**数据存储**:
```javascript
data.basicTagList     // 基础标签完整列表
data.basicTagIdMap    // 基础标签名称到ID的映射
```

**使用示例**:
```javascript
// 获取"基础标签-vip"的ID
const vipTagId = data.basicTagIdMap["基础标签-vip"];

// 获取所有基础标签
const allBasicTags = data.basicTagList;
```

---

### 3. 组合标签 (Composite Tags)
**用途**: 由多个基础标签组合而成的复杂条件标签

**创建的标签**:
1. "流失3天以上且vip等级在3以上且充值总金额在10000以上"
   - 包含: 基础标签-流失天数 + 基础标签-vip + 基础标签-充值总金额

2. "重提差在100-1000或注册天数已经有2天以上的或者提现超过1000的会员"
   - 包含: 基础标签-重提差 + 基础标签-注册天数 + 基础标签-提现总金额

**数据存储**:
```javascript
data.compositeTagList    // 组合标签完整列表
data.compositeTagIdMap   // 组合标签名称到ID的映射
```

**使用示例**:
```javascript
// 获取组合标签的ID
const compositeTagId = data.compositeTagIdMap["流失3天以上且vip等级在3以上且充值总金额在10000以上"];

// 获取所有组合标签
const allCompositeTags = data.compositeTagList;
```

---

## 在其他活动中使用标签

### 示例1: 使用手动标签
```javascript
export function createSomeActivity(data) {
    const token = data.token;
    
    // 获取手动标签ID
    const richPlayerId = data.tagIdMap["土豪玩家"];
    const normalPlayerId = data.tagIdMap["平民玩家"];
    
    // 在活动配置中使用
    const payload = {
        activityName: "VIP专属活动",
        targetTags: [richPlayerId, normalPlayerId],
        // ... 其他配置
    };
    
    // 发送请求
    const result = sendRequest(payload, '/api/Activity/Create', 'someActivity', false, token);
}
```

### 示例2: 使用基础标签
```javascript
export function createAnotherActivity(data) {
    const token = data.token;
    
    // 获取基础标签ID
    const vipTagId = data.basicTagIdMap["基础标签-vip"];
    const rechargeTagId = data.basicTagIdMap["基础标签-充值总金额"];
    
    // 在活动配置中使用
    const payload = {
        activityName: "充值活动",
        basicTagIds: [vipTagId, rechargeTagId],
        // ... 其他配置
    };
}
```

### 示例3: 使用组合标签
```javascript
export function createComplexActivity(data) {
    const token = data.token;
    
    // 获取组合标签ID
    const compositeTagId = data.compositeTagIdMap["流失3天以上且vip等级在3以上且充值总金额在10000以上"];
    
    // 在活动配置中使用
    const payload = {
        activityName: "流失用户召回活动",
        compositeTagId: compositeTagId,
        // ... 其他配置
    };
}
```

### 示例4: 混合使用多种标签
```javascript
export function createMixedActivity(data) {
    const token = data.token;
    
    // 获取不同类型的标签ID
    const manualTagId = data.tagIdMap["土豪玩家"];
    const basicTagId = data.basicTagIdMap["基础标签-vip"];
    const compositeTagId = data.compositeTagIdMap["流失3天以上且vip等级在3以上且充值总金额在10000以上"];
    
    // 根据活动需求使用不同类型的标签
    const payload = {
        activityName: "综合营销活动",
        manualTags: [manualTagId],
        basicTags: [basicTagId],
        compositeTags: [compositeTagId],
        // ... 其他配置
    };
}
```

---

## 标签数据结构

### 手动标签数据结构
```javascript
{
    id: 1000007,
    type: 3,
    name: "异常玩家",
    remark: "异常玩家",
    count: 0,
    lastUpdateMan: "carey3004",
    lastUpdateTime: 1772012792250
}
```

### 基础标签数据结构
```javascript
{
    id: 11007,
    tagName: "基础标签-注册天数",
    conditionType: 11,
    conditionMin: 2,
    conditionMax: 10,
    state: 1,
    creator: "carey3004",
    createTime: 1772013996314
}
```

### 组合标签数据结构
```javascript
{
    id: 90032,
    tagName: "重提差在100-1000或注册天数已经有2天以上的或者提现超过1000的会员",
    conditionContent: "(基础标签-提现总金额 OR 基础标签-注册天数 OR 基础标签-重提差)",
    conditionCount: 1,
    packageCount: 0,
    adGroupCount: 0,
    state: 1,
    stateDesc: "启用",
    creator: "carey3004",
    createTime: 1772015167743
}
```

---

## 注意事项

1. **标签优先级**: 标签创建的优先级设置为 0（最高），确保在所有活动创建之前完成

2. **标签依赖关系**:
   - 组合标签依赖基础标签
   - 基础标签和手动标签相互独立

3. **ID映射**: 所有标签都通过名称到ID的映射存储，方便在活动中引用

4. **数据持久化**: 标签数据保存在 `data` 对象中，在整个测试流程中可用

5. **错误处理**: 如果标签创建失败，后续依赖该标签的活动也会失败

---

## 完整执行流程

```
步骤1: 创建手动标签 (3个)
  ↓
步骤2: 查询手动标签列表 → 保存到 data.tagList 和 data.tagIdMap
  ↓
步骤3: 创建基础标签 (6个)
  ↓
步骤4: 查询基础标签列表 → 保存到 data.basicTagList 和 data.basicTagIdMap
  ↓
步骤5: 创建组合标签 (2个，使用基础标签ID)
  ↓
步骤6: 查询组合标签列表 → 保存到 data.compositeTagList 和 data.compositeTagIdMap
  ↓
其他活动可以使用所有标签数据
```
