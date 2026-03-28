# Figma 图片自动同步系统 - 安装完成

## ✅ 已创建的文件

### 核心工具（3个）
- ✅ `sync-figma-images.js` - Node.js 同步脚本（核心功能）
- ✅ `sync-figma.sh` - Shell 包装脚本（便捷入口）
- ✅ `get-figma-nodes.js` - 节点 ID 获取工具（辅助工具）

### 配置文件（2个）
- ✅ `figma-sync-config.json` - 主配置文件（需要填写）
- ✅ `figma-sync-config.example.json` - 配置模板（供参考）

### 文档文件（4个）
- ✅ `QUICK_START.md` - 快速入门指南（5分钟配置）
- ✅ `FIGMA_SYNC_README.md` - 完整使用文档
- ✅ `README_FIGMA_SYNC.md` - 系统总览
- ✅ `SETUP_SUMMARY.md` - 本文件（安装总结）

### 其他文件（1个）
- ✅ `.gitignore.example` - Git 忽略规则建议

## 🎯 下一步操作

### 步骤 1: 获取 Figma 凭证（5分钟）

#### 1.1 获取 Access Token
1. 访问：https://www.figma.com/settings
2. 找到 "Personal Access Tokens" 部分
3. 点击 "Create new token"
4. 输入名称（如：`image-sync`）
5. **立即复制生成的 token**（只显示一次！）

#### 1.2 获取 File Key
从你的 Figma 文件 URL 中提取：
```
https://www.figma.com/file/abc123xyz/MyDesign
                            ^^^^^^^^^ 
                            这就是 File Key
```

### 步骤 2: 配置环境（2分钟）

#### 方式 A: 使用环境变量（推荐）

```bash
# 临时设置（当前终端会话）
export FIGMA_ACCESS_TOKEN="figd_你的实际token"

# 或者创建 .env 文件（永久）
cat > .env << 'EOF'
FIGMA_ACCESS_TOKEN="figd_你的实际token"
EOF

# 使用时加载
source .env
```

#### 方式 B: 直接在配置文件中填写

```bash
# 编辑配置文件
nano figma-sync-config.json

# 填写以下内容：
# {
#   "figmaAccessToken": "figd_你的实际token",
#   "figmaFileKey": "你的文件key",
#   ...
# }
```

### 步骤 3: 获取节点 ID（10分钟）

```bash
# 设置环境变量（如果还没设置）
export FIGMA_ACCESS_TOKEN="figd_你的token"

# 列出文件中所有可用节点
node get-figma-nodes.js 你的文件key

# 过滤特定分类的节点
node get-figma-nodes.js 你的文件key --filter="banner"

# 生成配置模板（推荐）
node get-figma-nodes.js 你的文件key --filter="banner" --template
```

**输出示例**：
```json
{
  "banner": {
    "1.png": "123-456",
    "2.png": "123-457",
    "3.png": "123-458"
  }
}
```

将输出的内容复制到 `figma-sync-config.json` 的 `imageMapping` 部分。

### 步骤 4: 配置映射关系（15分钟）

编辑 `figma-sync-config.json`：

```json
{
  "figmaAccessToken": "YOUR_FIGMA_ACCESS_TOKEN_HERE",
  "figmaFileKey": "你的文件key",
  "imageMapping": {
    "banner": {
      "1.png": "123-456",
      "2.png": "123-457",
      "3.png": "123-458"
    },
    "signin": {
      "1.png": "789-101",
      "2.png": "789-102"
    }
    // ... 其他分类
  }
}
```

**提示**：
- 为每个分类运行 `get-figma-nodes.js --filter="分类名" --template`
- 将生成的配置合并到 `imageMapping` 中
- 节点 ID 格式：Figma 中的 `123:456` 要写成 `123-456`

### 步骤 5: 测试同步（2分钟）

```bash
# 测试单个分类
./sync-figma.sh banner

# 如果成功，同步所有图片
./sync-figma.sh
```

### 步骤 6: 安全配置（3分钟）

```bash
# 1. 将敏感文件添加到 .gitignore
cat >> .gitignore << 'EOF'

# Figma 同步工具
k6/tests/api/uploadFile/figma-sync-config.json
k6/tests/api/uploadFile/.env
EOF

# 2. 验证 .gitignore 生效
git status

# 3. 提交工具代码（不包含配置）
git add k6/tests/api/uploadFile/*.js
git add k6/tests/api/uploadFile/*.sh
git add k6/tests/api/uploadFile/*.md
git add k6/tests/api/uploadFile/figma-sync-config.example.json
git commit -m "feat: add Figma image sync tool"
```

## 📋 快速命令参考

```bash
# 查看帮助
./sync-figma.sh --help
node get-figma-nodes.js --help

# 获取节点 ID
node get-figma-nodes.js <FILE_KEY>
node get-figma-nodes.js <FILE_KEY> --filter="关键词"
node get-figma-nodes.js <FILE_KEY> --template

# 同步图片
./sync-figma.sh                    # 全部
./sync-figma.sh banner             # 单个分类

# 批量同步
for cat in banner signin dailyTasks; do
    ./sync-figma.sh "$cat"
done
```

## 🎉 完成检查清单

- [ ] 已获取 Figma Access Token
- [ ] 已获取 Figma File Key
- [ ] 已设置环境变量或配置文件
- [ ] 已使用 `get-figma-nodes.js` 获取节点 ID
- [ ] 已配置 `figma-sync-config.json` 的映射关系
- [ ] 已测试同步单个分类（`./sync-figma.sh banner`）
- [ ] 已测试同步所有图片（`./sync-figma.sh`）
- [ ] 已将敏感文件添加到 `.gitignore`
- [ ] 已提交工具代码到 Git

## 📚 文档导航

根据你的需求选择阅读：

| 文档 | 适合场景 |
|------|---------|
| [QUICK_START.md](./QUICK_START.md) | 首次配置，快速上手 |
| [README_FIGMA_SYNC.md](./README_FIGMA_SYNC.md) | 了解系统概览和工作流程 |
| [FIGMA_SYNC_README.md](./FIGMA_SYNC_README.md) | 深入了解所有功能和高级用法 |

## ❓ 遇到问题？

### 常见问题速查

1. **提示 "请配置 Figma Access Token"**
   ```bash
   # 检查环境变量
   echo $FIGMA_ACCESS_TOKEN
   
   # 重新设置
   export FIGMA_ACCESS_TOKEN="figd_你的token"
   ```

2. **提示 "API 请求失败: 403"**
   - Token 无效或过期
   - 重新生成一个新的 token

3. **节点没有返回图片 URL**
   - 检查节点 ID 格式（`:` 要改为 `-`）
   - 在 Figma 中确认节点是否可见
   - 尝试手动导出该节点

4. **下载的图片是空白的**
   - 在 Figma 中检查节点内容
   - 确认节点 ID 是否正确
   - 使用 `--filter` 重新查找节点

### 获取帮助

1. 查看详细文档：[FIGMA_SYNC_README.md](./FIGMA_SYNC_README.md)
2. 运行帮助命令：`./sync-figma.sh --help`
3. 查看 Figma API 文档：https://www.figma.com/developers/api

## 🚀 开始使用

现在你可以开始使用 Figma 图片自动同步工具了！

```bash
# 首次配置
export FIGMA_ACCESS_TOKEN="figd_你的token"
node get-figma-nodes.js 你的文件key --filter="banner" --template

# 编辑配置文件
nano figma-sync-config.json

# 开始同步
./sync-figma.sh
```

祝使用愉快！🎉
