# Figma 图片同步 - 快速入门指南

## 🎯 5分钟快速配置

### 步骤 1: 获取 Figma Access Token

1. 打开 https://www.figma.com/settings
2. 滚动到 "Personal Access Tokens"
3. 点击 "Create new token"
4. 输入名称（如：`image-sync`），点击生成
5. **立即复制 token**（只显示一次！）

### 步骤 2: 获取 Figma File Key

从你的 Figma 文件 URL 中提取：

```
https://www.figma.com/file/abc123xyz/MyDesign
                            ^^^^^^^^^ 
                            这就是 File Key
```

### 步骤 3: 设置环境变量（推荐）

```bash
# 在终端中设置（临时）
export FIGMA_ACCESS_TOKEN="figd_你的token"

# 或者创建 .env 文件（永久）
echo 'FIGMA_ACCESS_TOKEN="figd_你的token"' > .env
source .env
```

### 步骤 4: 获取节点 ID

```bash
# 列出文件中所有可用的图片节点
node get-figma-nodes.js abc123xyz

# 只看 banner 相关的节点
node get-figma-nodes.js abc123xyz --filter="banner"

# 生成配置模板
node get-figma-nodes.js abc123xyz --filter="banner" --template
```

### 步骤 5: 配置映射关系

编辑 `figma-sync-config.json`：

```json
{
  "figmaAccessToken": "YOUR_FIGMA_ACCESS_TOKEN_HERE",
  "figmaFileKey": "abc123xyz",
  "imageMapping": {
    "banner": {
      "1.png": "123-456",
      "2.png": "123-457"
    }
  }
}
```

**提示**：如果使用了环境变量，`figmaAccessToken` 可以保持占位符。

### 步骤 6: 同步图片

```bash
# 同步所有图片
./sync-figma.sh

# 或只同步某个分类
./sync-figma.sh banner
```

## 🎉 完成！

图片已自动下载到 `img/` 对应的文件夹中。

---

## 📋 常用命令速查

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
./sync-figma.sh signin             # 单个分类

# 批量同步多个分类
for cat in banner signin dailyTasks; do
    ./sync-figma.sh "$cat"
done
```

## 🔧 故障排查

### 问题：提示 "请配置 Figma Access Token"

**解决**：
```bash
# 检查环境变量
echo $FIGMA_ACCESS_TOKEN

# 如果为空，重新设置
export FIGMA_ACCESS_TOKEN="figd_你的token"
```

### 问题：提示 "API 请求失败: 403"

**解决**：Token 无效或过期，重新生成一个新的。

### 问题：节点没有返回图片 URL

**解决**：
1. 检查节点 ID 是否正确（`:` 要替换为 `-`）
2. 在 Figma 中确认该节点是否可见
3. 尝试手动导出该节点，看是否正常

### 问题：下载的图片是空白的

**解决**：
1. 在 Figma 中检查该节点是否有内容
2. 确认节点 ID 是否指向正确的对象
3. 尝试使用 `--filter` 重新查找节点

## 💡 最佳实践

### 1. Figma 文件组织

```
Figma 文件
├── 📄 Banner Images
│   ├── banner-1
│   ├── banner-2
│   └── banner-3
├── 📄 Activity Images
│   ├── signin-1
│   ├── signin-2
│   └── dailyTasks-1
└── ...
```

使用清晰的命名，方便用 `--filter` 过滤。

### 2. 配置文件管理

```bash
# 不要提交 token 到 git
echo "figma-sync-config.json" >> .gitignore

# 创建一个模板文件供团队使用
cp figma-sync-config.json figma-sync-config.example.json
# 然后清空 example 文件中的敏感信息
```

### 3. 自动化工作流

创建 `update-images.sh`：

```bash
#!/bin/bash
# 更新所有活动图片

source .env  # 加载环境变量

categories=(
    "banner"
    "signin"
    "dailyTasks"
    "rechargeWheel"
)

for cat in "${categories[@]}"; do
    echo "更新 $cat..."
    ./sync-figma.sh "$cat"
done

echo "✅ 所有图片更新完成！"
```

### 4. 版本控制

```bash
# 提交前检查变化
git status
git diff k6/tests/api/uploadFile/img/

# 提交
git add k6/tests/api/uploadFile/img/
git commit -m "chore: update activity images from Figma"
```

## 📚 更多信息

详细文档请查看：[FIGMA_SYNC_README.md](./FIGMA_SYNC_README.md)

## 🆘 需要帮助？

1. 查看详细文档：`FIGMA_SYNC_README.md`
2. 运行帮助命令：`./sync-figma.sh --help`
3. 检查 Figma API 文档：https://www.figma.com/developers/api
