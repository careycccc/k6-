# Figma 节点过滤示例

## 过滤模式说明

工具支持 4 种过滤模式：

| 模式 | 说明 | 示例 |
|------|------|------|
| `contains` | 包含关键词（默认） | "活动签到" 匹配 "每日活动签到"、"活动签到页面" |
| `startswith` | 以关键词开头 | "活动" 只匹配 "活动_签到"、"活动_转盘"，不匹配 "每日活动" |
| `endswith` | 以关键词结尾 | "签到" 只匹配 "每日签到"、"活动签到"，不匹配 "签到页面" |
| `exact` | 完全匹配 | "活动" 只匹配名称完全是 "活动" 的节点 |

## 使用场景

### 场景1: 只获取以"活动"开头的节点

根据你的截图，"活动_Activity" 页面中有很多节点：
- 活动_每日签到_可领取金额
- 活动_每日签到_充值任意金额
- 活动_领取成功
- 活动_会员充值
- ...

如果只想要这些以"活动"开头的节点：

```bash
# 方式1: 使用快捷脚本
./figma-quick-scan.sh "https://..." --page="活动" --filter="活动" --filter-mode=startswith

# 方式2: 直接使用脚本
node get-figma-nodes-optimized.js "Lgf7inAbITdEdrWiTN6SWd" --page="活动" --filter="活动" --filter-mode=startswith

# 生成配置模板
./figma-quick-scan.sh "https://..." --page="活动" --filter="活动" --filter-mode=startswith --template
```

### 场景2: 只获取前20个节点

如果节点太多，只想要前面几个：

```bash
./figma-quick-scan.sh "https://..." --page="活动" --filter="活动" --filter-mode=startswith --limit=20
```

### 场景3: 获取特定类型的活动

只获取"签到"相关的活动：

```bash
# 包含"签到"的节点
./figma-quick-scan.sh "https://..." --page="活动" --filter="签到"

# 以"活动_每日签到"开头的节点
./figma-quick-scan.sh "https://..." --page="活动" --filter="活动_每日签到" --filter-mode=startswith
```

### 场景4: 获取多个不同前缀的节点

如果需要多个不同前缀，可以分别获取：

```bash
# 获取"活动"开头的节点
./figma-quick-scan.sh "https://..." --page="活动" --filter="活动" --filter-mode=startswith --template > config-activity.json

# 获取"签到"开头的节点
./figma-quick-scan.sh "https://..." --page="活动" --filter="签到" --filter-mode=startswith --template > config-signin.json

# 获取"转盘"开头的节点
./figma-quick-scan.sh "https://..." --page="活动" --filter="转盘" --filter-mode=startswith --template > config-wheel.json
```

## 实际示例

基于你的 Figma 文件（从截图看到的节点）：

### 示例1: 获取所有"活动_每日签到"相关节点

```bash
./figma-quick-scan.sh "https://www.figma.com/design/xkOpdVjdK9RSxGEnUrfOwd/..." \
  --page="活动" \
  --filter="活动_每日签到" \
  --filter-mode=startswith
```

预期输出：
```
📄 页面: 活动_Activity
   ├─ [FRAME] 活动_每日签到_可领取金额
   │  ID: xxx-xxx
   ├─ [FRAME] 活动_每日签到_充值任意金额
   │  ID: xxx-xxx
   ├─ [FRAME] 活动_每日签到_充值任意金额
   │  ID: xxx-xxx
   ...
```

### 示例2: 获取前10个"活动"开头的节点

```bash
./figma-quick-scan.sh "https://www.figma.com/design/xkOpdVjdK9RSxGEnUrfOwd/..." \
  --page="活动" \
  --filter="活动" \
  --filter-mode=startswith \
  --limit=10
```

### 示例3: 生成配置文件（只包含"活动"开头的节点）

```bash
./figma-quick-scan.sh "https://www.figma.com/design/xkOpdVjdK9RSxGEnUrfOwd/..." \
  --page="活动" \
  --filter="活动" \
  --filter-mode=startswith \
  --template > figma-config-activity-only.json
```

生成的配置示例：
```json
{
  "figmaFileKey": "xkOpdVjdK9RSxGEnUrfOwd",
  "figmaAccessToken": "YOUR_FIGMA_ACCESS_TOKEN_HERE",
  "categories": {
    "活动activity": {
      "1.png": "xxx-xxx",  // 活动_每日签到_可领取金额
      "2.png": "xxx-xxx",  // 活动_每日签到_充值任意金额
      "3.png": "xxx-xxx",  // 活动_领取成功
      ...
    }
  }
}
```

## 组合使用技巧

### 技巧1: 分类获取不同活动类型

```bash
# 1. 每日签到活动
./figma-quick-scan.sh "URL" --page="活动" --filter="活动_每日签到" --filter-mode=startswith --template > signin.json

# 2. 会员活动
./figma-quick-scan.sh "URL" --page="活动" --filter="活动_会员" --filter-mode=startswith --template > vip.json

# 3. 充值活动
./figma-quick-scan.sh "URL" --page="活动" --filter="活动_充值" --filter-mode=startswith --template > recharge.json
```

### 技巧2: 先预览再生成配置

```bash
# 第一步：预览有哪些节点
./figma-quick-scan.sh "URL" --page="活动" --filter="活动" --filter-mode=startswith

# 第二步：确认无误后生成配置
./figma-quick-scan.sh "URL" --page="活动" --filter="活动" --filter-mode=startswith --template
```

### 技巧3: 控制节点数量

```bash
# 只要前5个节点（快速测试）
./figma-quick-scan.sh "URL" --page="活动" --filter="活动" --filter-mode=startswith --limit=5

# 要所有匹配的节点
./figma-quick-scan.sh "URL" --page="活动" --filter="活动" --filter-mode=startswith --limit=9999
```

## 常见问题

### Q1: 如何知道节点的确切名称？

先不加过滤器，查看所有节点：
```bash
./figma-quick-scan.sh "URL" --page="活动"
```

### Q2: 过滤器不区分大小写吗？

是的，过滤器不区分大小写。`--filter="活动"` 会匹配 "活动"、"Activity"、"ACTIVITY" 等。

### Q3: 可以使用正则表达式吗？

当前版本不支持正则表达式，但支持 4 种过滤模式已经能满足大部分需求。

### Q4: 如何排除某些节点？

目前不支持排除模式，建议使用更精确的过滤条件。例如：
- 不要用 `--filter="活动"`（太宽泛）
- 改用 `--filter="活动_每日签到"` 或 `--filter="活动_会员"`（更精确）

## 命令速查表

```bash
# 查看所有页面
./figma-quick-scan.sh "FIGMA_URL"

# 查看特定页面的所有节点
./figma-quick-scan.sh "FIGMA_URL" --page="活动"

# 只看以"活动"开头的节点
./figma-quick-scan.sh "FIGMA_URL" --page="活动" --filter="活动" --filter-mode=startswith

# 只看前20个
./figma-quick-scan.sh "FIGMA_URL" --page="活动" --filter="活动" --filter-mode=startswith --limit=20

# 生成配置
./figma-quick-scan.sh "FIGMA_URL" --page="活动" --filter="活动" --filter-mode=startswith --template

# 保存到文件
./figma-quick-scan.sh "FIGMA_URL" --page="活动" --filter="活动" --filter-mode=startswith --template > config.json
```

## 完整工作流程示例

```bash
# 1. 查看文件有哪些页面
./figma-quick-scan.sh "https://www.figma.com/design/xkOpdVjdK9RSxGEnUrfOwd/..."

# 2. 查看"活动"页面有哪些节点（预览）
./figma-quick-scan.sh "https://..." --page="活动" | head -50

# 3. 只看以"活动"开头的节点（预览）
./figma-quick-scan.sh "https://..." --page="活动" --filter="活动" --filter-mode=startswith

# 4. 确认无误，生成配置文件
./figma-quick-scan.sh "https://..." --page="活动" --filter="活动" --filter-mode=startswith --template > figma-activity-config.json

# 5. 编辑配置文件，调整文件名
vim figma-activity-config.json

# 6. 同步图片
./sync-figma.sh
```
