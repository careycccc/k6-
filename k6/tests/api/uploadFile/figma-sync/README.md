# Figma 图片同步系统

## 目录结构

```
figma-sync/
├── master.js                    # 主控脚本
├── README.md                    # 本文档
├── core/                        # 核心模块
│   ├── download-banners.js      # Banner 下载模块
│   ├── get-nodes.js             # 节点查询模块
│   ├── test-connection.js       # 连接测试
│   └── figma-api.js             # Figma API 封装（待创建）
├── tasks/                       # 任务模块
│   ├── index.js                 # 任务索引
│   ├── systemActive.js          # 系统活动任务
│   ├── banner.js                # 首页 Banner 任务
│   ├── signin.js                # 签到任务（待创建）
│   └── ...                      # 其他任务
├── config/                      # 配置文件
│   ├── global-config.json       # 全局配置
│   └── tasks-config.example.json # 配置示例
└── docs/                        # 文档
    ├── MASTER_SYSTEM_GUIDE.md   # 系统指南
    ├── BANNER_DOWNLOAD_GUIDE.md # Banner 下载指南
    └── ...                      # 其他文档
```

## 快速开始

### 1. 运行主控脚本

```bash
cd k6/tests/api/uploadFile

# 预览模式
./sync-all.sh --dry-run

# 完整流程
./sync-all.sh

# 只处理特定任务
./sync-all.sh --task=systemActive
```

### 2. 添加新任务

在 `tasks/` 目录下创建新文件，例如 `signin.js`：

```javascript
const config = {
    name: 'signin',
    description: '签到任务',
    enabled: true,
    
    figma: {
        page: '活动',
        searchStrategy: 'filter',
        searchConfig: {
            filterPrefix: '签到',
            filterMode: 'contains'
        }
    },
    
    output: {
        folder: 'signin',
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

系统会自动加载新任务，无需修改其他文件。

## 任务模块说明

每个任务模块必须导出：

1. `config` - 任务配置对象
2. `execute(globalConfig, options)` - 执行函数

### config 结构

```javascript
{
    name: '任务名称',
    description: '任务描述',
    enabled: true,  // 是否启用
    
    figma: {
        page: 'Figma 页面名',
        searchStrategy: 'frame' | 'filter' | 'node',
        searchConfig: {
            // 根据 searchStrategy 不同而不同
        }
    },
    
    output: {
        folder: '输出文件夹名',
        fileMapping: {
            // 文件名映射
        }
    }
}
```

### execute 函数

```javascript
async function execute(globalConfig, options = {}) {
    const { dryRun = false } = options;
    
    // 实现下载逻辑
    
    return {
        success: true | false,
        downloaded: 0,  // 下载数量
        skipped: 0,     // 跳过数量
        message: '消息',
        error: '错误信息'  // 如果失败
    };
}
```

## 核心模块

### download-banners.js
Banner 图片下载模块，支持：
- 按 FRAME 查找
- 按编号过滤
- 自动去重

### get-nodes.js
节点查询模块，支持：
- 轻量级 API
- 按页面查询
- 过滤和搜索

### figma-api.js（待创建）
统一的 Figma API 封装，提供：
- 连接管理
- 错误处理
- 限流控制

## 配置文件

### global-config.json

```json
{
  "figmaFileKey": "YOUR_FILE_KEY",
  "figmaAccessToken": "YOUR_TOKEN"
}
```

## 开发指南

### 添加新任务的步骤

1. 在 `tasks/` 目录创建新文件
2. 实现 `config` 和 `execute`
3. 运行测试：`./sync-all.sh --task=新任务名 --dry-run`
4. 完善下载逻辑

### 调试单个任务

```bash
# 只运行特定任务
./sync-all.sh --task=systemActive --dry-run

# 跳过清空步骤
./sync-all.sh --task=systemActive --skip-clean
```

## 当前状态

- ✅ 目录结构已建立
- ✅ 主控脚本已完成
- ✅ 任务加载机制已完成
- ✅ systemActive 任务模板已创建
- ⏸️ Figma 下载逻辑待实现
- ⏸️ 其他任务模块待创建

## 下一步

1. 创建 `core/figma-api.js` 统一 API
2. 实现 `systemActive.js` 的下载逻辑
3. 创建其他 13 个任务模块
4. 测试完整流程
