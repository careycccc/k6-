# Figma 图片自动同步工具

## 📖 简介

这个工具可以自动从 Figma 下载图片并更新到项目中，无需手动下载、重命名和移动文件。

## 🚀 快速开始

### 1. 获取 Figma Access Token

1. 登录 Figma
2. 进入设置页面：https://www.figma.com/settings
3. 找到 "Personal Access Tokens" 部分
4. 点击 "Create new token"
5. 输入 token 名称（如：`image-sync`）
6. 复制生成的 token（只显示一次，请妥善保管）

### 2. 获取 Figma File Key

Figma 文件的 URL 格式：
```
https://www.figma.com/file/{FILE_KEY}/文件名
```

例如：
```
https://www.figma.com/file/abc123xyz/MyDesign
```
这里的 `abc123xyz` 就是 File Key。

### 3. 获取图片节点 ID

在 Figma 中：
1. 选中要导出的图片/组件
2. 右键 → "Copy/Paste as" → "Copy link"
3. 链接格式：`https://www.figma.com/file/{FILE_KEY}/...?node-id={NODE_ID}`
4. 提取 `node-id` 参数的值（如：`123:456`）

**注意**：节点 ID 中的冒号 `:` 需要替换为 `-`，例如：
- Figma 显示：`123:456`
- 配置文件中：`123-456`

### 4. 配置文件

编辑 `figma-sync-config.json`：

```json
{
  "figmaAccessToken": "figd_YOUR_ACTUAL_TOKEN_HERE",
  "figmaFileKey": "abc123xyz",
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
  }
}
```

**配置说明**：
- `figmaAccessToken`: 你的 Figma 访问令牌
- `figmaFileKey`: Figma 文件的 Key
- `imageMapping`: 图片映射关系
  - 键：分类文件夹名（如 `banner`, `signin`）
  - 值：文件名到节点 ID 的映射

### 5. 运行同步

```bash
# 方法1: 使用 shell 脚本（推荐）
./sync-figma.sh                    # 同步所有图片
./sync-figma.sh banner             # 只同步 banner 分类

# 方法2: 直接使用 Node.js
node sync-figma-images.js
node sync-figma-images.js --category=banner
```

## 🔐 安全建议

### 方式1: 使用环境变量（推荐）

不要在配置文件中直接写入 token，而是使用环境变量：

```bash
# 临时设置（当前终端会话）
export FIGMA_ACCESS_TOKEN="figd_YOUR_TOKEN_HERE"
./sync-figma.sh

# 或者一行命令
FIGMA_ACCESS_TOKEN="figd_YOUR_TOKEN_HERE" ./sync-figma.sh
```

在配置文件中保持占位符：
```json
{
  "figmaAccessToken": "YOUR_FIGMA_ACCESS_TOKEN_HERE",
  ...
}
```

### 方式2: 使用 .env 文件

创建 `.env` 文件（记得添加到 .gitignore）：
```bash
FIGMA_ACCESS_TOKEN=figd_YOUR_TOKEN_HERE
```

然后使用：
```bash
source .env
./sync-figma.sh
```

## 📁 目录结构

```
k6/tests/api/uploadFile/
├── img/                          # 图片存储目录
│   ├── banner/                   # 各个分类
│   ├── signin/
│   └── ...
├── figma-sync-config.json        # 配置文件
├── sync-figma-images.js          # Node.js 同步脚本
├── sync-figma.sh                 # Shell 包装脚本
└── FIGMA_SYNC_README.md          # 本文档
```

## 🎯 使用场景

### 场景1: 新建前台，更新所有图片

```bash
# 1. 在 Figma 中准备好新的设计
# 2. 更新配置文件中的节点 ID
# 3. 运行同步
./sync-figma.sh
```

### 场景2: 只更新某个活动的图片

```bash
# 只更新签到活动的图片
./sync-figma.sh signin

# 只更新充值转盘的图片
./sync-figma.sh rechargeWheel
```

### 场景3: 批量更新多个分类

```bash
# 创建一个批量脚本
for category in banner signin dailyTasks; do
    ./sync-figma.sh "$category"
done
```

## 🔧 高级配置

### 自定义图片格式和缩放

修改 `sync-figma-images.js` 中的导出参数：

```javascript
// 找到这一行
const endpoint = `/v1/images/${fileKey}?ids=${encodeURIComponent(nodeIdsParam)}&format=png&scale=2`;

// 可选参数：
// format: png, jpg, svg, pdf
// scale: 0.5, 1, 2, 3, 4 (PNG/JPG only)
```

### 添加新的图片分类

在 `figma-sync-config.json` 中添加：

```json
{
  "imageMapping": {
    "newCategory": {
      "1.png": "NODE_ID_XXX",
      "2.png": "NODE_ID_YYY"
    }
  }
}
```

## ❓ 常见问题

### Q1: 提示 "请配置 Figma Access Token"

**A**: 确保你已经：
1. 在 Figma 设置中创建了 Personal Access Token
2. 在配置文件中填写了正确的 token，或设置了环境变量

### Q2: 提示 "API 请求失败: 403"

**A**: Token 权限不足或已过期，请：
1. 检查 token 是否正确
2. 重新生成一个新的 token

### Q3: 提示 "节点没有返回图片 URL"

**A**: 可能的原因：
1. 节点 ID 不正确（检查是否将 `:` 替换为 `-`）
2. 该节点不是可导出的图片/组件
3. 文件权限不足

### Q4: 下载的图片是空白的

**A**: 可能是：
1. Figma 中该节点是空的或隐藏的
2. 节点 ID 指向了错误的对象
3. 尝试在 Figma 中手动导出该节点，确认是否正常

### Q5: 如何批量获取节点 ID？

**A**: 使用 Figma 插件或脚本：
1. 在 Figma 中选中多个对象
2. 使用插件如 "Node ID" 或 "Figma to Code"
3. 或者使用 Figma API 的 `/v1/files/{file_key}` 端点获取文件结构

## 📝 配置文件模板

完整的配置文件示例：

```json
{
  "figmaAccessToken": "YOUR_FIGMA_ACCESS_TOKEN_HERE",
  "figmaFileKey": "YOUR_FIGMA_FILE_KEY_HERE",
  "imageMapping": {
    "banner": {
      "1.png": "123-456",
      "2.png": "123-457",
      "3.png": "123-458"
    },
    "champion": {
      "1.png": "234-567"
    },
    "customisablepopup": {
      "1.png": "345-678",
      "2.png": "345-679",
      "3.png": "345-680",
      "4.png": "345-681"
    },
    "dailyTasks": {
      "1.png": "456-789",
      "2.png": "456-790",
      "3.png": "456-791"
    },
    "signin": {
      "1.png": "567-890",
      "2.png": "567-891"
    },
    "rechargeWheel": {
      "1.png": "678-901",
      "2.png": "678-902",
      "3.png": "678-903",
      "4.png": "678-904",
      "5.png": "678-905",
      "6.png": "678-906"
    }
  }
}
```

## 🔄 工作流程建议

### 日常更新流程

1. **设计师更新 Figma**
   - 在 Figma 中更新设计
   - 保持节点 ID 不变（不要删除重建）

2. **开发者同步图片**
   ```bash
   ./sync-figma.sh
   ```

3. **验证更新**
   ```bash
   git status  # 查看哪些图片被更新了
   git diff    # 查看图片变化（如果是文本格式）
   ```

4. **提交代码**
   ```bash
   git add k6/tests/api/uploadFile/img/
   git commit -m "chore: update activity images from Figma"
   ```

### 新项目初始化流程

1. **在 Figma 中组织好所有图片**
   - 使用清晰的命名
   - 按分类组织（Frame/Group）

2. **批量获取节点 ID**
   - 使用 Figma API 或插件
   - 记录每个图片的节点 ID

3. **配置映射关系**
   - 编辑 `figma-sync-config.json`
   - 建立文件名到节点 ID 的映射

4. **首次同步**
   ```bash
   ./sync-figma.sh
   ```

5. **验证结果**
   - 检查所有图片是否正确下载
   - 确认文件名和位置正确

## 🛠️ 故障排查

### 启用详细日志

修改 `sync-figma-images.js`，在文件开头添加：

```javascript
const DEBUG = true;

function debugLog(message) {
  if (DEBUG) {
    console.log(`[DEBUG] ${message}`);
  }
}
```

### 测试单个图片

```bash
# 创建一个最小配置文件测试
node sync-figma-images.js --category=banner
```

### 检查 Figma API 响应

使用 curl 测试：

```bash
curl -H "X-Figma-Token: YOUR_TOKEN" \
  "https://api.figma.com/v1/files/YOUR_FILE_KEY"
```

## 📚 相关资源

- [Figma API 文档](https://www.figma.com/developers/api)
- [Figma 图片导出 API](https://www.figma.com/developers/api#get-images-endpoint)
- [Node.js 文档](https://nodejs.org/docs/)

## 🤝 贡献

如果你有改进建议或发现了 bug，欢迎提出！

## 📄 许可

MIT License
