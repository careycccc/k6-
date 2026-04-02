# Figma 图片同步主控系统使用指南

## 系统概述

这是一个自动化系统，用于管理多个 Figma 图片同步任务。

### 核心功能

1. ✅ 自动扫描 `img/` 目录下的所有任务文件夹
2. ✅ 清空每个文件夹下的旧图片
3. ⏸️ 从 Figma 下载新图片（待实现）
4. ⏸️ 根据配置重命名文件（待实现）

### 当前任务列表

系统检测到以下 14 个任务：

1. banner - 首页 Banner
2. champion - 冠军赛图片
3. customisablepopup - 自定义弹窗
4. dailyTasks - 每日任务
5. faq - 常见问题
6. inmail - 站内信
7. loginafter - 登录后页面
8. order - 订单相关
9. outlink - 外部链接
10. rechargegiftpack - 充值礼包
11. rechargeWheel - 充值转盘
12. rescue - 救援金
13. signin - 签到
14. systemActive - 系统活动

## 快速开始

### 1. 首次运行（生成配置）

```bash
cd k6/tests/api/uploadFile

# 生成默认配置文件
node figma-sync-master.js
```

这会创建 `figma-tasks-config.json` 配置文件。

### 2. 编辑配置文件

```bash
# 复制示例配置
cp figma-tasks-config.example.json figma-tasks-config.json

# 编辑配置
vim figma-tasks-config.json
```

必须配置：
- `figmaFileKey`: 你的 Figma 文件 Key
- `figmaAccessToken`: 你的 Figma Access Token
- 每个任务的 `figmaPage` 和搜索配置

### 3. 预览模式（推荐）

```bash
# 查看会删除哪些文件，不实际执行
node figma-sync-master.js --dry-run
```

### 4. 执行完整流程

```bash
# 清空旧图片 + 下载新图片
node figma-sync-master.js
```

## 使用场景

### 场景1: 只清空图片（不下载）

```bash
# 清空所有任务的图片
node figma-sync-master.js --skip-clean=false

# 或者手动删除
rm -rf img/*/*.png
```

### 场景2: 只处理特定任务

```bash
# 只处理 systemActive 任务
node figma-sync-master.js --task=systemActive

# 只处理 banner 任务
node figma-sync-master.js --task=banner
```

### 场景3: 跳过清空，只下载

```bash
# 保留旧图片，只下载新的
node figma-sync-master.js --skip-clean
```

### 场景4: 批量更新所有图片

```bash
# 1. 预览
node figma-sync-master.js --dry-run

# 2. 确认无误后执行
node figma-sync-master.js
```

## 配置文件说明

### 全局配置

```json
{
  "figmaFileKey": "YOUR_FILE_KEY",
  "figmaAccessToken": "YOUR_TOKEN",
  "tasks": { ... }
}
```

### 任务配置

每个任务包含以下字段：

```json
{
  "enabled": true,              // 是否启用
  "description": "任务描述",
  "figmaPage": "页面名称",       // Figma 中的页面名
  "searchStrategy": "frame",    // 搜索策略: frame | filter | node
  "searchConfig": {             // 搜索配置
    "framePrefix": "活动_",     // FRAME 前缀
    "bannerPrefix": "Banner",   // Banner 前缀
    "targetCount": 13           // 目标数量
  },
  "outputFolder": "systemActive", // 输出文件夹名
  "fileMapping": {              // 文件名映射
    "Banner_01.png": "1.png"
  }
}
```

### 搜索策略说明

#### 1. frame 策略（适合系统活动）

```json
{
  "searchStrategy": "frame",
  "searchConfig": {
    "framePrefix": "活动_",      // 查找以"活动_"开头的 FRAME
    "bannerPrefix": "Banner",    // 在 FRAME 下查找 Banner
    "targetCount": 13            // 找到 13 张就停止
  }
}
```

#### 2. filter 策略（适合其他任务）

```json
{
  "searchStrategy": "filter",
  "searchConfig": {
    "filterPrefix": "签到",      // 过滤关键词
    "filterMode": "contains"     // 匹配模式: contains | startswith | endswith
  }
}
```

#### 3. node 策略（直接指定节点 ID）

```json
{
  "searchStrategy": "node",
  "searchConfig": {
    "nodeIds": [                 // 直接指定节点 ID
      "19847-199418",
      "19847-199453"
    ]
  }
}
```

## 文件名映射

### 自动映射（保持原名）

```json
{
  "fileMapping": {}  // 空对象，保持 Figma 中的原始名称
}
```

### 手动映射（重命名）

```json
{
  "fileMapping": {
    "Banner_01.png": "1.png",
    "Banner_02.png": "2.png",
    "Banner 13 - 每日签到.png": "signin.png"
  }
}
```

## 命令参数

```bash
node figma-sync-master.js [选项]
```

| 参数 | 说明 |
|------|------|
| `--dry-run` | 预览模式，不实际删除或下载 |
| `--skip-clean` | 跳过清空图片步骤 |
| `--task=NAME` | 只处理指定任务 |
| `--help, -h` | 显示帮助信息 |

## 输出示例

```
╔════════════════════════════════════════════════════════════════╗
║           Figma 图片同步主控系统 v1.0                          ║
╚════════════════════════════════════════════════════════════════╝

📁 步骤 1: 扫描任务文件夹...
✅ 找到 14 个任务文件夹
   1. banner                (5 张图片)
   2. champion              (3 张图片)
   3. systemActive          (13 张图片)
   ...

⚙️  步骤 2: 加载配置文件...
✅ 配置加载成功
   Figma File Key: Lgf7inAbITdEdrWiTN6SWd
   配置任务数: 14

🗑️  步骤 3: 清空旧图片...
   ✅ banner: 已删除 5 张图片
   ✅ champion: 已删除 3 张图片
   ✅ systemActive: 已删除 13 张图片
   ...

✅ 总计已删除 45 张图片

📥 步骤 4: 执行 Figma 同步任务...
   将执行 14 个任务

================================================================================
📋 任务: systemActive
📝 描述: 系统活动 Banner 图片
📄 Figma 页面: 活动
📂 输出目录: img/systemActive
⏸️  Figma 同步功能待实现
================================================================================

📊 执行结果:
================================================================================
✅ 成功: 0 个任务
❌ 失败: 14 个任务 (功能待实现)
================================================================================
```

## 工作流程

```
┌─────────────────────────────────────────────────────────────┐
│  1. 扫描 img/ 目录                                           │
│     └─ 发现 14 个任务文件夹                                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  2. 加载配置文件                                             │
│     └─ figma-tasks-config.json                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  3. 清空旧图片                                               │
│     ├─ img/banner/*.png        → 删除                       │
│     ├─ img/systemActive/*.png  → 删除                       │
│     └─ ...                                                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  4. 执行 Figma 同步任务（待实现）                            │
│     ├─ 任务1: systemActive                                  │
│     │   ├─ 连接 Figma API                                   │
│     │   ├─ 查找"活动"页面                                   │
│     │   ├─ 搜索 Banner 1-13                                 │
│     │   ├─ 下载图片                                         │
│     │   └─ 重命名: Banner_01.png → 1.png                    │
│     ├─ 任务2: banner                                        │
│     ├─ 任务3: signin                                        │
│     └─ ...                                                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  5. 显示结果                                                 │
│     └─ 成功/失败统计                                         │
└─────────────────────────────────────────────────────────────┘
```

## 目录结构

```
k6/tests/api/uploadFile/
├── figma-sync-master.js           # 主控脚本
├── figma-tasks-config.json        # 配置文件（需创建）
├── figma-tasks-config.example.json # 配置示例
├── download-banners.js            # Banner 下载模块（待集成）
├── get-figma-nodes-optimized.js   # 节点查询模块（待集成）
├── img/                           # 图片目录
│   ├── banner/                    # 任务1
│   ├── champion/                  # 任务2
│   ├── systemActive/              # 任务3
│   └── ...                        # 其他任务
└── MASTER_SYSTEM_GUIDE.md         # 本文档
```

## 下一步开发

### 待实现功能

1. ⏸️ 集成 Figma 下载模块
   - 使用 `download-banners.js` 的逻辑
   - 支持三种搜索策略
   - 实现文件名映射

2. ⏸️ 添加进度显示
   - 实时显示下载进度
   - 显示剩余时间

3. ⏸️ 错误处理和重试
   - API 限流处理
   - 下载失败重试

4. ⏸️ 日志记录
   - 保存执行日志
   - 记录错误详情

### 开发接口

在 `figma-sync-master.js` 中预留了接口：

```javascript
async function executeFigmaTask(taskName, taskConfig, globalConfig) {
    // TODO: 实现 Figma 下载逻辑
    // 1. 根据 searchStrategy 查找节点
    // 2. 下载图片
    // 3. 根据 fileMapping 重命名
}
```

## 故障排查

### 问题1: 配置文件不存在

```bash
# 首次运行会自动创建
node figma-sync-master.js
```

### 问题2: 某个任务失败

```bash
# 只运行失败的任务
node figma-sync-master.js --task=systemActive --dry-run
```

### 问题3: API 限流（429 错误）

等待 10-15 分钟后重试，或使用 `--task` 参数逐个处理。

## 最佳实践

1. ✅ 首次使用先运行 `--dry-run`
2. ✅ 定期备份 `img/` 目录
3. ✅ 使用版本控制管理配置文件
4. ✅ 分批处理任务避免 API 限流
5. ✅ 保持配置文件的 `fileMapping` 更新

## 总结

这个系统提供了一个统一的入口来管理所有 Figma 图片同步任务。当前已实现：
- ✅ 任务扫描
- ✅ 配置管理
- ✅ 图片清空

待实现：
- ⏸️ Figma 下载
- ⏸️ 文件重命名
- ⏸️ 进度显示
