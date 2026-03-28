# 🚀 Figma 图片自动同步 - 从这里开始

## 欢迎！

这个工具可以自动从 Figma 下载图片并更新到项目中，彻底解决手动下载、重命名、移动文件的麻烦。

## ⚡ 3 步快速开始

### 第 1 步：获取 Figma 凭证

1. **Access Token**：访问 https://www.figma.com/settings → "Personal Access Tokens" → "Create new token"
2. **File Key**：从 Figma 文件 URL 中提取（`https://www.figma.com/file/abc123xyz/...` 中的 `abc123xyz`）

### 第 2 步：配置环境

```bash
# 设置 token（推荐使用环境变量）
export FIGMA_ACCESS_TOKEN="figd_你的实际token"

# 测试连接
node test-figma-connection.js
```

### 第 3 步：获取节点 ID 并同步

```bash
# 获取节点 ID（生成配置模板）
node get-figma-nodes.js 你的文件key --filter="banner" --template

# 将输出复制到 figma-sync-config.json

# 开始同步
./sync-figma.sh banner
```

## 📚 详细文档

| 文档 | 说明 | 适合 |
|------|------|------|
| **[QUICK_START.md](./QUICK_START.md)** | 5分钟快速配置指南 | 首次使用 |
| [README_FIGMA_SYNC.md](./README_FIGMA_SYNC.md) | 系统概览和工作流程 | 了解全貌 |
| [FIGMA_SYNC_README.md](./FIGMA_SYNC_README.md) | 完整功能文档 | 深入学习 |
| [SETUP_SUMMARY.md](./SETUP_SUMMARY.md) | 安装总结和检查清单 | 验证配置 |

## 🛠️ 工具说明

| 工具 | 用途 | 命令示例 |
|------|------|---------|
| `test-figma-connection.js` | 测试配置是否正确 | `node test-figma-connection.js` |
| `get-figma-nodes.js` | 获取节点 ID | `node get-figma-nodes.js <key> --filter="banner"` |
| `sync-figma.sh` | 同步图片 | `./sync-figma.sh` 或 `./sync-figma.sh banner` |

## 🎯 常用命令

```bash
# 1. 测试连接
node test-figma-connection.js

# 2. 获取节点 ID
node get-figma-nodes.js <FILE_KEY> --filter="banner" --template

# 3. 同步图片
./sync-figma.sh                    # 全部
./sync-figma.sh banner             # 单个分类

# 4. 查看帮助
./sync-figma.sh --help
node get-figma-nodes.js --help
```

## ✅ 配置检查清单

- [ ] 已获取 Figma Access Token
- [ ] 已获取 Figma File Key
- [ ] 已设置环境变量 `FIGMA_ACCESS_TOKEN`
- [ ] 已运行 `test-figma-connection.js` 测试通过
- [ ] 已使用 `get-figma-nodes.js` 获取节点 ID
- [ ] 已配置 `figma-sync-config.json`
- [ ] 已测试同步单个分类

## 🆘 遇到问题？

### 快速诊断

```bash
# 运行连接测试
node test-figma-connection.js
```

这个测试会检查：
- ✅ Access Token 是否配置
- ✅ File Key 是否正确
- ✅ API 连接是否正常
- ✅ 文件访问权限
- ✅ 配置文件格式

### 常见问题

1. **Token 相关**
   ```bash
   # 检查环境变量
   echo $FIGMA_ACCESS_TOKEN
   
   # 重新设置
   export FIGMA_ACCESS_TOKEN="figd_你的token"
   ```

2. **节点 ID 格式**
   - Figma 显示：`123:456`
   - 配置文件：`123-456`（冒号改为短横线）

3. **权限问题**
   - 确保你有该 Figma 文件的访问权限
   - Token 需要有读取文件的权限

## 📖 完整工作流程示例

```bash
# 1. 设置环境
export FIGMA_ACCESS_TOKEN="figd_你的token"

# 2. 测试连接
node test-figma-connection.js

# 3. 查看文件结构
node get-figma-nodes.js abc123xyz

# 4. 为每个分类生成配置
node get-figma-nodes.js abc123xyz --filter="banner" --template > banner.json
node get-figma-nodes.js abc123xyz --filter="signin" --template > signin.json

# 5. 编辑配置文件，合并所有分类
nano figma-sync-config.json

# 6. 测试单个分类
./sync-figma.sh banner

# 7. 同步所有图片
./sync-figma.sh

# 8. 查看变化
git status
git diff

# 9. 提交更新
git add k6/tests/api/uploadFile/img/
git commit -m "chore: update images from Figma"
```

## 🎉 开始使用

现在你已经了解了基本信息，可以开始配置了！

**推荐路径**：
1. 阅读 [QUICK_START.md](./QUICK_START.md)（5分钟）
2. 运行 `node test-figma-connection.js` 测试配置
3. 使用 `get-figma-nodes.js` 获取节点 ID
4. 运行 `./sync-figma.sh` 开始同步

祝使用愉快！🚀

---

**提示**：如果这是你第一次使用，强烈建议先阅读 [QUICK_START.md](./QUICK_START.md)
