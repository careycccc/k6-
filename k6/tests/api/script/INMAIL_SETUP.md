# 站内信活动配置说明

## 问题说明

站内信活动需要图片资源才能创建，如果在批量创建时没有提供图片资源，会看到以下错误：

```
[ERROR] [createInmail] 缺少图片资源，无法创建站内信
```

这是正常的跳过行为，站内信活动会被自动跳过，不影响其他活动的创建。

## 解决方案

### 方案 1: 使用默认图片资源（已配置）

现在 `batchCreateActivities.js` 已经配置了默认的图片资源：

```javascript
const imageSrc = 'https://example.com/default-banner.jpg';
const imageUrl = '/default-banner.jpg';
```

**直接运行即可**：
```bash
k6 run k6/tests/api/script/batchCreateActivities.js
```

站内信活动会使用默认图片资源进行创建。

### 方案 2: 使用自定义图片资源

通过环境变量提供真实的图片资源：

```bash
k6 run -e IMAGE_SRC=https://cdn.example.com/banner.jpg \
       -e IMAGE_URL=/uploads/banner.jpg \
       k6/tests/api/script/batchCreateActivities.js
```

### 方案 3: 跳过站内信活动

如果你不想创建站内信活动，可以：

#### 3.1 临时从配置中移除

编辑 `k6/config/activities.js`，注释掉站内信活动：

```javascript
export const createActivityConfigs = [
    // ... 其他活动
    // {
    //     title: '运营管理->站内信活动',
    //     name: 'Inmail',
    //     tag: createInmailTag,
    //     func: createInmail,
    //     priority: 24,
    //     description: '创建站内信活动'
    // }
];
```

#### 3.2 修改站内信逻辑，让它总是跳过

编辑 `k6/tests/api/activity/inmail/createInmail.js`：

```javascript
export function createInmail(data) {
    logger.info(`[${createInmailTag}] 开始创建站内信活动`);
    
    // 临时跳过站内信创建
    return {
        success: false,
        tag: createInmailTag,
        message: '站内信活动暂时禁用，跳过创建'
    };
}
```

## 当前配置

### batchCreateActivities.js 的 setup 函数

```javascript
export function setup() {
    const baseData = activityOperation.setup();
    
    // 为站内信活动添加图片资源
    // 可以从环境变量获取，或使用默认值
    const imageSrc = __ENV.IMAGE_SRC || 'https://example.com/default-banner.jpg';
    const imageUrl = __ENV.IMAGE_URL || '/default-banner.jpg';
    
    return {
        ...baseData,
        uploadedSrc: [imageSrc],
        uploadedUrls: [imageUrl]
    };
}
```

### 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| IMAGE_SRC | 图片完整URL | `https://example.com/default-banner.jpg` |
| IMAGE_URL | 图片相对路径 | `/default-banner.jpg` |

## 使用示例

### 示例 1: 使用默认图片

```bash
k6 run k6/tests/api/script/batchCreateActivities.js
```

### 示例 2: 使用真实图片

```bash
k6 run -e IMAGE_SRC=https://cdn.yoursite.com/images/activity-banner.jpg \
       -e IMAGE_URL=/images/activity-banner.jpg \
       k6/tests/api/script/batchCreateActivities.js
```

### 示例 3: 单独测试站内信

```bash
# 使用调试脚本
./k6/tests/api/script/debug.sh Inmail your-token \
    https://cdn.yoursite.com/banner.jpg \
    /banner.jpg

# 或使用 k6 命令
k6 run -e ACTIVITY_NAME=Inmail \
       -e TOKEN=your-token \
       -e IMAGE_SRC=https://cdn.yoursite.com/banner.jpg \
       -e IMAGE_URL=/banner.jpg \
       k6/tests/api/script/debugSingleActivity.js
```

## 验证配置

运行批量创建后，查看输出：

### 成功创建站内信

```
[INFO] [createInmail] 开始创建站内信活动
[INFO] [createInmail] 准备创建 19 条站内信
[INFO] [createInmail] 创建站内信成功: 充值站内信
...
[INFO] [createInmail] 站内信活动创建并启用成功，共创建 19 条站内信

[DEBUG] 总活动数: 24, 已创建: 24, 已跳过: 0
```

### 跳过站内信

```
[INFO] [createInmail] 开始创建站内信活动
[ERROR] [createInmail] 缺少图片资源，无法创建站内信

[DEBUG] 总活动数: 24, 已创建: 23, 已跳过: 1
[DEBUG] 跳过的活动:
  - Inmail (createInmail): 缺少图片资源（uploadedSrc 或 uploadedUrls），跳过站内信活动创建
```

## 注意事项

1. **默认图片**: 默认图片 URL 是示例，实际使用时应该替换为真实的图片地址
2. **图片要求**: 
   - `uploadedSrc`: 完整的图片 URL（带域名）
   - `uploadedUrls`: 图片的相对路径
3. **站内信数量**: 会创建 19 条站内信（根据 jumpType 数量）
4. **执行时间**: 约需 20 秒（每条间隔 1 秒）
5. **跳过不是错误**: 如果没有图片资源，跳过是正常行为

## 推荐做法

### 开发环境

使用默认图片或测试图片：

```bash
k6 run k6/tests/api/script/batchCreateActivities.js
```

### 生产环境

使用真实的图片资源：

```bash
k6 run -e IMAGE_SRC=https://cdn.production.com/banner.jpg \
       -e IMAGE_URL=/uploads/banner.jpg \
       k6/tests/api/script/batchCreateActivities.js
```

### 调试阶段

单独测试站内信活动：

```bash
./k6/tests/api/script/debug.sh Inmail your-token \
    https://cdn.test.com/test-banner.jpg \
    /test-banner.jpg
```

## 常见问题

### Q1: 为什么站内信需要图片资源？

A: 站内信的内容中包含图片，需要提供图片 URL 才能正确显示。

### Q2: 可以不创建站内信吗？

A: 可以，有三种方式：
1. 不提供图片资源（自动跳过）
2. 从配置中移除站内信活动
3. 修改站内信逻辑让它总是返回 `success: false`

### Q3: 默认图片会影响其他活动吗？

A: 不会，只有站内信活动会使用这些图片资源。

### Q4: 如何验证图片资源是否正确？

A: 使用调试脚本单独测试站内信活动，查看创建结果。

## 总结

现在 `batchCreateActivities.js` 已经配置了默认图片资源，你可以：

1. **直接运行** - 使用默认图片创建站内信
2. **自定义图片** - 通过环境变量提供真实图片
3. **跳过站内信** - 不提供图片资源或从配置中移除

选择最适合你的方式即可！
