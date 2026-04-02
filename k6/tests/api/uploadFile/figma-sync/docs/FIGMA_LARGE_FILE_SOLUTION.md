# Figma 大文件处理方案

## 问题说明

当 Figma 文件过大时，使用标准 API 会遇到以下错误：
```
RangeError: Invalid string length
Cannot create a string longer than 0x1fffffe8 characters
```

这是因为 Node.js 字符串有最大长度限制（约 512MB）。

## 解决方案

我们提供了两个版本的工具：

### 1. 标准版（适合小文件）
- 文件：`get-figma-nodes.js`
- 一次性加载整个文件
- 适合页面数 < 10，节点数 < 1000 的文件

### 2. 优化版（适合大文件）✅ 推荐
- 文件：`get-figma-nodes-optimized.js`
- 使用 Figma 节点 API，按页面分批加载
- 先获取页面列表（轻量级），再按需获取节点详情
- 适合任意大小的文件

## 使用方法

### 快捷脚本（自动使用优化版）

```bash
# 查看所有页面列表
./figma-quick-scan.sh "https://www.figma.com/design/FILE_KEY/..."

# 只获取"活动"页面的节点
./figma-quick-scan.sh "https://..." --page="活动"

# 过滤特定节点
./figma-quick-scan.sh "https://..." --page="活动" --filter="签到"

# 生成配置模板
./figma-quick-scan.sh "https://..." --page="活动" --template
```

### 直接使用优化版脚本

```bash
# 查看所有页面
node get-figma-nodes-optimized.js "FILE_KEY"

# 只看特定页面
node get-figma-nodes-optimized.js "FILE_KEY" --page="活动"

# 生成配置
node get-figma-nodes-optimized.js "FILE_KEY" --page="活动" --template
```

## 工作原理

### 标准版流程
```
1. 调用 /v1/files/{key} → 获取完整文件（可能很大）
2. 解析整个 JSON → 可能超出内存限制 ❌
3. 遍历所有节点
```

### 优化版流程
```
1. 调用 /v1/files/{key}?depth=1 → 只获取页面列表（轻量级）✅
2. 显示所有页面供用户选择
3. 对每个需要的页面：
   - 调用 /v1/files/{key}/nodes?ids={pageId} → 只获取该页面 ✅
   - 解析该页面的节点
4. 按页面分批处理，避免内存溢出
```

## 最佳实践

### 1. 分页面处理（推荐）

不要一次性获取所有页面，而是按需获取：

```bash
# 第一步：查看所有页面
./figma-quick-scan.sh "https://..."

# 输出示例：
# 📄 可用页面:
#    1. 首页_home (ID: 15-2410)
#    2. 活动_Activity (ID: 20-3000)
#    3. 邀请转盘_Invitation Wheel (ID: 25-4000)
#    ...

# 第二步：逐个页面获取节点
./figma-quick-scan.sh "https://..." --page="首页_home" --template > config-home.json
./figma-quick-scan.sh "https://..." --page="活动_Activity" --template > config-activity.json
./figma-quick-scan.sh "https://..." --page="邀请转盘" --template > config-wheel.json
```

### 2. 使用过滤器

如果只需要特定类型的节点：

```bash
# 只获取包含"banner"的节点
./figma-quick-scan.sh "https://..." --page="首页" --filter="banner"

# 只获取签到相关节点
./figma-quick-scan.sh "https://..." --page="活动" --filter="签到"
```

### 3. 控制遍历深度

如果节点嵌套很深，可以限制深度：

```bash
# 只遍历3层
./figma-quick-scan.sh "https://..." --page="活动" --depth=3
```

## 配置文件管理

### 方案1：按页面分文件

```bash
# 为每个页面生成独立配置
./figma-quick-scan.sh "https://..." --page="首页" --template > figma-config-home.json
./figma-quick-scan.sh "https://..." --page="活动" --template > figma-config-activity.json

# 使用时指定配置文件
node sync-figma.js --config=figma-config-home.json
```

### 方案2：手动合并配置

```bash
# 1. 生成各页面配置
./figma-quick-scan.sh "https://..." --page="首页" --template > temp1.json
./figma-quick-scan.sh "https://..." --page="活动" --template > temp2.json

# 2. 手动合并到 figma-sync-config.json
# 复制各个 temp*.json 中的 categories 内容
```

## 故障排查

### 问题1: 仍然报内存错误

如果单个页面仍然太大：

```bash
# 使用过滤器减少节点数量
./figma-quick-scan.sh "https://..." --page="活动" --filter="签到"

# 减少遍历深度
./figma-quick-scan.sh "https://..." --page="活动" --depth=2
```

### 问题2: 找不到节点

确保：
- 页面名称正确（区分大小写）
- 节点在 Figma 中可见（未隐藏）
- 节点类型是支持的类型（FRAME、IMAGE、COMPONENT 等）

### 问题3: API 请求失败

检查：
```bash
# 测试 Access Token
node test-figma-connection.js

# 确认 File Key 正确
echo "File Key: xkOpdVjdK9RSxGEnUrfOwd"
```

## 性能对比

| 场景 | 标准版 | 优化版 |
|------|--------|--------|
| 小文件（< 10 页面） | ✅ 快速 | ✅ 快速 |
| 中等文件（10-50 页面） | ⚠️ 可能慢 | ✅ 稳定 |
| 大文件（> 50 页面） | ❌ 内存溢出 | ✅ 正常工作 |
| 只需要特定页面 | ❌ 仍加载全部 | ✅ 只加载需要的 |

## 命令速查

```bash
# 查看所有页面（不加载节点详情）
./figma-quick-scan.sh "FIGMA_URL"

# 获取特定页面的节点
./figma-quick-scan.sh "FIGMA_URL" --page="页面名"

# 搜索特定节点
./figma-quick-scan.sh "FIGMA_URL" --page="页面名" --filter="关键词"

# 生成配置模板
./figma-quick-scan.sh "FIGMA_URL" --page="页面名" --template

# 限制遍历深度
./figma-quick-scan.sh "FIGMA_URL" --page="页面名" --depth=3

# 组合使用
./figma-quick-scan.sh "FIGMA_URL" --page="活动" --filter="签到" --depth=3 --template
```

## 总结

对于大型 Figma 文件：
1. ✅ 使用 `figma-quick-scan.sh`（已自动使用优化版）
2. ✅ 使用 `--page` 参数按页面处理
3. ✅ 使用 `--filter` 参数减少节点数量
4. ✅ 分批生成配置文件
5. ❌ 不要一次性加载所有页面
