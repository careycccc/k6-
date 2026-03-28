# Figma 图片自动同步系统

## 📦 系统概述

这是一个完整的 Figma 图片自动同步解决方案，可以自动从 Figma 下载图片并更新到项目中，无需手动操作。

## 🗂️ 文件说明

### 核心文件

| 文件 | 说明 | 用途 |
|------|------|------|
| `sync-figma-images.js` | Node.js 同步脚本 | 核心功能：调用 Figma API 下载图片 |
| `sync-figma.sh` | Shell 包装脚本 | 便捷入口：简化命令行操作 |
| `get-figma-nodes.js` | 节点 ID 获取工具 | 辅助工具：列出 Figma 文件中的所有节点 |
| `figma-sync-config.json` | 配置文件 | 存储 token、文件 key 和映射关系 |

### 文档文件

| 文件 | 说明 |
|------|------|
| `QUICK_START.md` | 快速入门指南（5分钟配置） |
| `FIGMA_SYNC_README.md` | 完整使用文档 |
| `README_FIGMA_SYNC.md` | 本文件（系统总览） |

### 示例文件

| 文件 | 说明 |
|------|------|
| `figma-sync-config.example.json` | 配置文件模板 |
| `.gitignore.example` | Git 忽略规则建议 |

## 🚀 快速开始

### 1. 首次配置（5分钟）

```bash
# 1. 复制配置文件模板
cp figma-sync-config.example.json figma-sync-config.json

# 2. 设置环境变量（推荐）
export FIGMA_ACCESS_TOKEN="figd_你的token"

# 3. 编辑配置文件，填写 File Key 和节点 ID
nano figma-sync-config.json

# 4. 测试同步
./sync-figma.sh banner
```

详细步骤请查看：[QUICK_START.md](./QUICK_START.md)

### 2. 日常使用

```bash
# 同步所有图片
./sync-figma.sh

# 只同步某个分类
./sync-figma.sh signin
```

## 🔑 获取必需信息

### Figma Access Token

1. 访问：https://www.figma.com/settings
2. 找到 "Personal Access Tokens"
3. 点击 "Create new token"
4. 复制生成的 token

### Figma File Key

从 URL 中提取：
```
https://www.figma.com/file/abc123xyz/MyDesign
                            ^^^^^^^^^ 
                            File Key
```

### 节点 ID

使用辅助工具获取：
```bash
# 列出所有节点
node get-figma-nodes.js <FILE_KEY>

# 过滤特定节点
node get-figma-nodes.js <FILE_KEY> --filter="banner"

# 生成配置模板
node get-figma-nodes.js <FILE_KEY> --filter="banner" --template
```

## 📋 工作流程

### 新项目初始化

```bash
# 1. 获取 Figma 信息
export FIGMA_ACCESS_TOKEN="figd_你的token"
FILE_KEY="abc123xyz"

# 2. 查看文件结构
node get-figma-nodes.js $FILE_KEY

# 3. 为每个分类生成配置
node get-figma-nodes.js $FILE_KEY --filter="banner" --template
node get-figma-nodes.js $FILE_KEY --filter="signin" --template

# 4. 编辑配置文件，合并所有模板
nano figma-sync-config.json

# 5. 首次同步
./sync-figma.sh

# 6. 验证结果
ls -la img/*/
```

### 日常更新流程

```bash
# 设计师在 Figma 中更新设计后...

# 1. 同步图片
./sync-figma.sh

# 2. 查看变化
git status
git diff

# 3. 提交更新
git add k6/tests/api/uploadFile/img/
git commit -m "chore: update activity images from Figma"
git push
```

### 新增图片分类

```bash
# 1. 在 Figma 中准备好新分类的图片

# 2. 获取节点 ID
node get-figma-nodes.js <FILE_KEY> --filter="newCategory" --template

# 3. 将输出的配置添加到 figma-sync-config.json

# 4. 同步新分类
./sync-figma.sh newCategory
```

## 🎯 使用场景

### 场景 1: 新建前台，批量更新所有图片

```bash
# 在 Figma 中准备好所有新设计
# 更新配置文件中的节点 ID
# 一键同步所有图片
./sync-figma.sh
```

### 场景 2: 只更新某个活动的图片

```bash
# 只更新签到活动
./sync-figma.sh signin

# 只更新充值转盘
./sync-figma.sh rechargeWheel
```

### 场景 3: 批量更新多个活动

```bash
# 创建批量脚本
for category in banner signin dailyTasks rechargeWheel; do
    echo "更新 $category..."
    ./sync-figma.sh "$category"
done
```

### 场景 4: 定期自动同步（Cron）

```bash
# 添加到 crontab
# 每天凌晨 2 点自动同步
0 2 * * * cd /path/to/project && source .env && ./sync-figma.sh >> sync.log 2>&1
```

## 🔒 安全最佳实践

### 1. 不要提交 Token 到 Git

```bash
# 添加到 .gitignore
echo "figma-sync-config.json" >> .gitignore
echo ".env" >> .gitignore
```

### 2. 使用环境变量

```bash
# 方式 1: 临时设置
export FIGMA_ACCESS_TOKEN="figd_你的token"

# 方式 2: .env 文件（记得加入 .gitignore）
echo 'FIGMA_ACCESS_TOKEN="figd_你的token"' > .env
source .env
```

### 3. 团队协作

```bash
# 提供配置模板给团队成员
cp figma-sync-config.json figma-sync-config.example.json

# 清空敏感信息
# 编辑 example 文件，将 token 和实际节点 ID 替换为占位符

# 提交模板到 Git
git add figma-sync-config.example.json
git commit -m "docs: add Figma sync config template"
```

## 🛠️ 高级功能

### 自定义导出格式

编辑 `sync-figma-images.js`，修改导出参数：

```javascript
// 找到这一行（约第 80 行）
const endpoint = `/v1/images/${fileKey}?ids=${encodeURIComponent(nodeIdsParam)}&format=png&scale=2`;

// 可选参数：
// format: png, jpg, svg, pdf
// scale: 0.5, 1, 2, 3, 4 (仅 PNG/JPG)
```

### 批量处理脚本

创建 `batch-sync.sh`：

```bash
#!/bin/bash
# 批量同步多个 Figma 文件

FILES=(
    "file1_key:banner,signin"
    "file2_key:dailyTasks,rechargeWheel"
)

for entry in "${FILES[@]}"; do
    file_key="${entry%%:*}"
    categories="${entry##*:}"
    
    echo "处理文件: $file_key"
    
    # 临时修改配置文件
    # ... 实现配置切换逻辑
    
    IFS=',' read -ra CATS <<< "$categories"
    for cat in "${CATS[@]}"; do
        ./sync-figma.sh "$cat"
    done
done
```

### 集成到 CI/CD

```yaml
# .github/workflows/sync-figma.yml
name: Sync Figma Images

on:
  schedule:
    - cron: '0 2 * * *'  # 每天凌晨 2 点
  workflow_dispatch:      # 手动触发

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '16'
      
      - name: Sync Images
        env:
          FIGMA_ACCESS_TOKEN: ${{ secrets.FIGMA_ACCESS_TOKEN }}
        run: |
          cd k6/tests/api/uploadFile
          ./sync-figma.sh
      
      - name: Commit Changes
        run: |
          git config --local user.email "action@github.com"
          git config --local user.name "GitHub Action"
          git add k6/tests/api/uploadFile/img/
          git commit -m "chore: auto-sync Figma images" || exit 0
          git push
```

## 📊 命令速查表

| 命令 | 说明 |
|------|------|
| `./sync-figma.sh` | 同步所有图片 |
| `./sync-figma.sh <category>` | 同步指定分类 |
| `./sync-figma.sh --help` | 显示帮助信息 |
| `node get-figma-nodes.js <key>` | 列出所有节点 |
| `node get-figma-nodes.js <key> --filter="text"` | 过滤节点 |
| `node get-figma-nodes.js <key> --template` | 生成配置模板 |
| `node sync-figma-images.js --category=<cat>` | 直接调用 Node.js 脚本 |

## ❓ 常见问题

### Q: 如何获取 Figma Access Token？
A: 访问 https://www.figma.com/settings，在 "Personal Access Tokens" 部分创建。

### Q: 节点 ID 格式是什么？
A: Figma 中显示为 `123:456`，配置文件中需要写成 `123-456`（冒号改为短横线）。

### Q: 如何批量获取节点 ID？
A: 使用 `get-figma-nodes.js` 工具，可以列出文件中所有节点并生成配置模板。

### Q: 可以同步 SVG 格式吗？
A: 可以，修改 `sync-figma-images.js` 中的 `format` 参数为 `svg`。

### Q: 如何处理多个 Figma 文件？
A: 为每个文件创建单独的配置文件，或者创建批量处理脚本。

### Q: Token 过期了怎么办？
A: 在 Figma 设置中重新生成一个新的 token，更新配置或环境变量。

## 📚 相关文档

- [快速入门指南](./QUICK_START.md) - 5分钟快速配置
- [完整使用文档](./FIGMA_SYNC_README.md) - 详细功能说明
- [Figma API 文档](https://www.figma.com/developers/api) - 官方 API 参考

## 🤝 贡献

欢迎提出改进建议或报告问题！

## 📄 许可

MIT License

---

**提示**：首次使用请先阅读 [QUICK_START.md](./QUICK_START.md)
