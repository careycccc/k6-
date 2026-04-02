# Upload File 目录说明

## 目录结构

```
uploadFile/
├── sync-all.sh                  # 主启动脚本
├── README.md                    # 本文档
├── figma-sync/                  # Figma 同步系统（新）
│   ├── master.js                # 主控脚本
│   ├── README.md                # 系统文档
│   ├── core/                    # 核心模块
│   │   ├── download-banners.js  # Banner 下载
│   │   ├── get-nodes.js         # 节点查询
│   │   └── test-connection.js   # 连接测试
│   ├── tasks/                   # 任务模块
│   │   ├── index.js             # 任务索引
│   │   ├── systemActive.js      # 系统活动
│   │   ├── banner.js            # 首页 Banner
│   │   └── ...                  # 其他任务
│   ├── config/                  # 配置文件
│   │   └── global-config.json   # 全局配置
│   └── docs/                    # 文档
│       └── ...
├── img/                         # 图片目录
│   ├── systemActive/            # 系统活动图片
│   ├── banner/                  # Banner 图片
│   ├── signin/                  # 签到图片
│   └── ...                      # 其他任务图片
└── [旧文件]                     # 待清理的旧文件

```

## 快速开始

### 1. 配置

```bash
# 复制配置示例
cp figma-sync/config/global-config.example.json figma-sync/config/global-config.json

# 编辑配置
vim figma-sync/config/global-config.json
```

配置内容：
```json
{
  "figmaFileKey": "你的 Figma File Key",
  "figmaAccessToken": "你的 Figma Access Token"
}
```

### 2. 运行

```bash
# 预览模式（推荐首次使用）
./sync-all.sh --dry-run

# 完整流程（清空 + 下载）
./sync-all.sh

# 只处理特定任务
./sync-all.sh --task=systemActive

# 跳过清空步骤
./sync-all.sh --skip-clean
```

## 系统说明

### 工作流程

1. **扫描任务** - 自动扫描 `img/` 目录下的文件夹
2. **清空旧图** - 删除每个文件夹下的旧图片
3. **下载新图** - 从 Figma 下载新图片
4. **重命名** - 根据配置重命名文件

### 任务列表

系统自动管理 14 个任务：

| 任务 | 描述 | 状态 |
|------|------|------|
| systemActive | 系统活动 Banner | ✅ 已配置 |
| banner | 首页 Banner | ⏸️ 待实现 |
| champion | 冠军赛图片 | ⏸️ 待实现 |
| customisablepopup | 自定义弹窗 | ⏸️ 待实现 |
| dailyTasks | 每日任务 | ⏸️ 待实现 |
| faq | 常见问题 | ⏸️ 待实现 |
| inmail | 站内信 | ⏸️ 待实现 |
| loginafter | 登录后页面 | ⏸️ 待实现 |
| order | 订单相关 | ⏸️ 待实现 |
| outlink | 外部链接 | ⏸️ 待实现 |
| rechargegiftpack | 充值礼包 | ⏸️ 待实现 |
| rechargeWheel | 充值转盘 | ⏸️ 待实现 |
| rescue | 救援金 | ⏸️ 待实现 |
| signin | 签到 | ⏸️ 待实现 |

## 添加新任务

在 `figma-sync/tasks/` 目录创建新文件：

```javascript
// figma-sync/tasks/newTask.js

const config = {
    name: 'newTask',
    description: '新任务描述',
    enabled: true,
    
    figma: {
        page: 'Figma 页面名',
        searchStrategy: 'filter',
        searchConfig: {
            filterPrefix: '关键词',
            filterMode: 'contains'
        }
    },
    
    output: {
        folder: 'newTask',
        fileMapping: {}
    }
};

async function execute(globalConfig, options = {}) {
    // 实现下载逻辑
    return {
        success: false,
        message: '待实现'
    };
}

module.exports = { config, execute };
```

系统会自动加载新任务。

## 常用命令

```bash
# 查看帮助
./sync-all.sh --help

# 预览所有任务
./sync-all.sh --dry-run

# 执行所有任务
./sync-all.sh

# 只处理系统活动
./sync-all.sh --task=systemActive

# 只处理签到
./sync-all.sh --task=signin

# 跳过清空，只下载
./sync-all.sh --skip-clean
```

## 文档

详细文档请查看：
- [系统指南](./figma-sync/docs/MASTER_SYSTEM_GUIDE.md)
- [系统 README](./figma-sync/README.md)
- [Banner 下载指南](./figma-sync/docs/BANNER_DOWNLOAD_GUIDE.md)

## 旧文件清理

以下文件已移动到 `figma-sync/` 目录，可以删除：

- ~~get-figma-nodes.js~~ → `figma-sync/core/get-nodes.js`
- ~~download-banners.js~~ → `figma-sync/core/download-banners.js`
- ~~test-figma-connection.js~~ → `figma-sync/core/test-connection.js`
- ~~各种 .md 文档~~ → `figma-sync/docs/`

保留的文件：
- `uploadchampion.js` - 旧的上传脚本
- `sync-figma.sh` - 旧的同步脚本
- `figma-sync-config.json` - 旧的配置文件

## 故障排查

### 问题1: 配置文件不存在

```bash
cp figma-sync/config/global-config.example.json figma-sync/config/global-config.json
```

### 问题2: 任务未找到

确保任务文件在 `figma-sync/tasks/` 目录下，且文件名与任务名一致。

### 问题3: API 限流

等待 10-15 分钟，或使用 `--task` 参数逐个处理。

## 开发状态

- ✅ 目录结构已重组
- ✅ 主控系统已完成
- ✅ 任务加载机制已完成
- ⏸️ Figma 下载逻辑待实现
- ⏸️ 其他任务模块待创建
