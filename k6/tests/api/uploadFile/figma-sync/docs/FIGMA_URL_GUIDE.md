# Figma URL 快速扫描指南

## 🚀 快速开始

只需要一个命令，粘贴 Figma URL 即可：

```bash
cd k6/tests/api/uploadFile

# 方式1: 使用快捷脚本（推荐）
./figma-quick-scan.sh "https://www.figma.com/design/xkOpdVjdK9RSxGEnUrfOwd/..."

# 方式2: 直接使用 Node.js
node get-figma-nodes.js "https://www.figma.com/design/xkOpdVjdK9RSxGEnUrfOwd/..."
```

## 📋 功能特性

### 1. 自动提取 File Key
不需要手动复制 File Key，直接粘贴完整的 Figma URL 即可。

支持的 URL 格式：
- `https://www.figma.com/design/FILE_KEY/...`
- `https://www.figma.com/file/FILE_KEY/...`

### 2. 按页面分类显示
自动遍历所有页面（首页_home、活动_Activity 等），按页面分类显示节点。

输出示例：
```
📄 页面: 首页_home
   Page ID: 15-2410
   节点数: 25
   ----------------------------------------------------------------------------
   ├─ [FRAME] banner区域
   │  ID: 15-2411
   ├─ [IMAGE] banner1.png
   │  ID: 15-2412

📄 页面: 活动_Activity
   Page ID: 20-3000
   节点数: 18
   ----------------------------------------------------------------------------
   ├─ [FRAME] 签到活动
   │  ID: 20-3001
```

### 3. 过滤和搜索

#### 只查看特定页面
```bash
./figma-quick-scan.sh "https://..." --page="首页_home"
./figma-quick-scan.sh "https://..." --page="活动"
```

#### 过滤节点名称
```bash
./figma-quick-scan.sh "https://..." --filter="banner"
./figma-quick-scan.sh "https://..." --filter="签到"
```

#### 组合使用
```bash
./figma-quick-scan.sh "https://..." --page="活动_Activity" --filter="签到"
```

### 4. 生成配置模板

自动生成 `figma-sync-config.json` 格式的配置：

```bash
./figma-quick-scan.sh "https://..." --template
```

输出示例：
```json
{
  "figmaFileKey": "xkOpdVjdK9RSxGEnUrfOwd",
  "figmaAccessToken": "YOUR_FIGMA_ACCESS_TOKEN_HERE",
  "categories": {
    "首页home": {
      "1.png": "15-2411",
      "2.png": "15-2412"
    },
    "活动activity": {
      "1.png": "20-3001",
      "2.png": "20-3002"
    }
  }
}
```

### 5. 按类型分组

按节点类型（FRAME、IMAGE、COMPONENT 等）分组显示：

```bash
./figma-quick-scan.sh "https://..." --group
```

## 🔧 完整工作流程

### 场景1: 新项目初始化

```bash
# 1. 扫描所有页面，生成配置模板
./figma-quick-scan.sh "https://www.figma.com/design/NEW_PROJECT/..." --template > temp-config.json

# 2. 查看配置，复制需要的部分到 figma-sync-config.json
cat temp-config.json

# 3. 编辑配置文件，调整分类和文件名
vim figma-sync-config.json

# 4. 测试连接
node test-figma-connection.js

# 5. 同步图片
./sync-figma.sh
```

### 场景2: 查找特定图片的节点 ID

```bash
# 在所有页面中搜索"banner"
./figma-quick-scan.sh "https://..." --filter="banner"

# 只在首页搜索
./figma-quick-scan.sh "https://..." --page="首页_home" --filter="banner"
```

### 场景3: 更新现有项目

```bash
# 1. 扫描新的 Figma 文件
./figma-quick-scan.sh "https://www.figma.com/design/UPDATED_PROJECT/..."

# 2. 对比节点 ID，更新配置文件
# 3. 重新同步图片
./sync-figma.sh
```

## 📝 多项目管理

### 方法1: 使用不同的配置文件

```bash
# 项目A
cp figma-sync-config.json figma-sync-config-projectA.json
./figma-quick-scan.sh "https://PROJECT_A_URL" --template > temp-A.json

# 项目B
cp figma-sync-config.json figma-sync-config-projectB.json
./figma-quick-scan.sh "https://PROJECT_B_URL" --template > temp-B.json

# 切换项目时，复制对应的配置文件
cp figma-sync-config-projectA.json figma-sync-config.json
```

### 方法2: 在配置文件中管理多个项目

编辑 `figma-sync-config.json`：

```json
{
  "projects": {
    "projectA": {
      "figmaFileKey": "FILE_KEY_A",
      "categories": { ... }
    },
    "projectB": {
      "figmaFileKey": "FILE_KEY_B",
      "categories": { ... }
    }
  },
  "figmaAccessToken": "YOUR_TOKEN"
}
```

## 🎯 常用命令速查

```bash
# 查看所有页面和节点
./figma-quick-scan.sh "FIGMA_URL"

# 只看首页
./figma-quick-scan.sh "FIGMA_URL" --page="首页_home"

# 搜索banner相关节点
./figma-quick-scan.sh "FIGMA_URL" --filter="banner"

# 生成配置模板
./figma-quick-scan.sh "FIGMA_URL" --template

# 按类型分组查看
./figma-quick-scan.sh "FIGMA_URL" --group

# 组合使用
./figma-quick-scan.sh "FIGMA_URL" --page="活动" --filter="签到" --template
```

## ⚙️ 环境变量

```bash
# 设置 Figma Access Token（推荐）
export FIGMA_ACCESS_TOKEN="figd_your_token_here"

# 或者在配置文件中设置
# figma-sync-config.json 中的 figmaAccessToken 字段
```

## 🔍 故障排查

### 问题1: 无法提取 File Key
确保 URL 格式正确：
- ✅ `https://www.figma.com/design/FILE_KEY/...`
- ✅ `https://www.figma.com/file/FILE_KEY/...`
- ❌ `https://www.figma.com/proto/...` (不支持)

### 问题2: API 连接失败
检查 Access Token：
```bash
# 测试连接
node test-figma-connection.js

# 设置环境变量
export FIGMA_ACCESS_TOKEN="your_token"
```

### 问题3: 找不到节点
- 确保节点在 Figma 中可见（未隐藏）
- 使用 `--page` 参数指定正确的页面
- 使用 `--filter` 参数搜索节点名称

## 📚 相关文档

- [快速开始指南](./QUICK_START.md)
- [Figma 同步详细说明](./FIGMA_SYNC_README.md)
- [完整设置总结](./SETUP_SUMMARY.md)
