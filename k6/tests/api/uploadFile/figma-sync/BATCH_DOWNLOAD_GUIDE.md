# Figma 批量下载优化指南

## 🎯 核心优化：从 N 次请求降到 2 次

### 问题背景
之前的实现方式：每张图片都要单独请求一次下载链接
- 13 张图片 = 13 次 API 请求
- 100 张图片 = 100 次 API 请求
- 很容易触发 Figma API 限流（每小时 1000 次）

### 优化方案
新的批量请求方式：无论多少张图片，只需要 2 次 API 请求
1. **第 1 次请求**：获取整个文件的结构（所有页面、图层信息）
2. **第 2 次请求**：批量获取所有图片的下载链接（一次性传入所有 ID）
3. **下载图片**：直接从 Figma CDN 下载，不消耗 API 配额

## 📊 效果对比

| 图片数量 | 旧方式 API 调用 | 新方式 API 调用 | 节省比例 |
|---------|----------------|----------------|---------|
| 13 张   | 14 次          | 2 次           | 85.7%   |
| 50 张   | 51 次          | 2 次           | 96.1%   |
| 100 张  | 101 次         | 2 次           | 98.0%   |

## 🚀 快速开始

### 1. 测试批量下载功能

```bash
# 设置环境变量
export FIGMA_TOKEN="figd_你的Token"
export FIGMA_FILE_KEY="7LqisrlVeOwdEpNyPPxKDZ"

# 运行测试
cd k6/tests/api/uploadFile/figma-sync
node test-batch-download.js

# 或者直接传参
node test-batch-download.js --token=figd_xxx --fileKey=xxx

# 只查看文件信息（不下载）
node test-batch-download.js --info
```

### 2. 在你的任务中使用

```javascript
const { downloadFromFigma } = require('./core/figma-api');

async function myTask() {
    const result = await downloadFromFigma({
        fileKey: 'YOUR_FILE_KEY',
        accessToken: 'YOUR_TOKEN',
        outputFolder: './img/output',
        
        // 过滤选项（可选）
        options: {
            skipHidden: true,        // 跳过隐藏图层
            pageFilter: '活动',      // 只处理特定页面
            nameFilter: 'Banner'     // 只处理特定名称的图层
        },
        
        // 文件名映射（可选）
        fileMapping: {
            'Banner_01.png': '1.png',
            'Banner_02.png': '2.png'
        },
        
        format: 'png',  // png, jpg, svg, pdf
        scale: 2        // 1, 2, 3, 4
    });

    console.log(`API 调用次数: ${result.apiCalls}`);
    console.log(`下载成功: ${result.downloaded} 张`);
}
```

## 🔧 核心实现原理

### 批量获取链接的关键代码

```javascript
// ❌ 旧方式：每张图片单独请求
for (const nodeId of nodeIds) {
    const { data } = await client.get(`/images/${fileKey}?ids=${nodeId}`);
    // 每次循环都是 1 次 API 请求
}

// ✅ 新方式：一次性获取所有图片链接
const allIds = nodeIds.join(',');  // "id1,id2,id3,id4..."
const { data } = await client.get(`/images/${fileKey}?ids=${allIds}`);
// 只有 1 次 API 请求，返回所有图片的链接
```

### 递归查找所有导出节点

```javascript
function findExportableNodes(node, pageName, result = [], options = {}) {
    // 跳过隐藏图层
    if (options.skipHidden && node.visible === false) {
        return result;
    }

    // 检查是否设置了导出
    if (node.exportSettings && node.exportSettings.length > 0) {
        // 应用过滤条件
        if (matchesFilters(node, pageName, options)) {
            result.push({
                id: node.id,
                name: node.name,
                page: pageName,
                type: node.type
            });
        }
    }

    // 递归处理子节点
    if (node.children) {
        node.children.forEach(child => 
            findExportableNodes(child, pageName, result, options)
        );
    }

    return result;
}
```

## 📝 过滤选项详解

### 1. 跳过隐藏图层
```javascript
options: {
    skipHidden: true  // 默认跳过 visible=false 的图层
}
```

### 2. 页面过滤
```javascript
options: {
    pageFilter: '活动'           // 字符串：包含"活动"的页面
    // 或
    pageFilter: /^活动_/         // 正则：以"活动_"开头的页面
}
```

### 3. 图层名称过滤
```javascript
options: {
    nameFilter: 'Banner'         // 字符串：包含"Banner"的图层
    // 或
    nameFilter: /^Banner_\d+$/   // 正则：Banner_01, Banner_02 等
}
```

### 4. 节点类型过滤
```javascript
options: {
    typeFilter: ['FRAME', 'COMPONENT']  // 只处理 Frame 和 Component
}
```

### 5. 组合使用
```javascript
options: {
    skipHidden: true,
    pageFilter: '活动',
    nameFilter: /^Banner_/,
    typeFilter: ['FRAME']
}
```

## 🎨 文件名映射

### 自动映射规则
```javascript
fileMapping: {
    'Banner_01.png': '1.png',
    'Banner_02.png': '2.png',
    'Banner_03.png': '3.png'
}
```

### 保持原名
```javascript
fileMapping: {}  // 空对象表示保持 Figma 中的原始名称
```

## ⚠️ 注意事项

### 1. Figma API 限制
- 免费版：每小时 1000 次请求
- 专业版：每小时 5000 次请求
- 使用批量方式后，即使下载 500 张图片也只消耗 2 次请求

### 2. 图层必须设置导出
在 Figma 中，需要导出的图层必须：
1. 选中图层
2. 右侧面板找到 "Export"
3. 点击 "+" 添加导出设置
4. 选择格式（PNG、JPG 等）

### 3. 命名冲突
如果不同页面有同名图层，建议：
- 使用 `pageFilter` 分别处理不同页面
- 或者在 `fileMapping` 中指定不同的目标文件名

### 4. 下载超时
- 单个图片下载超时：60 秒
- API 请求超时：30 秒
- 如果网络不稳定，可以在代码中调整 `timeout` 参数

## 📦 完整示例

### 示例 1：下载所有活动 Banner
```javascript
const result = await downloadFromFigma({
    fileKey: '7LqisrlVeOwdEpNyPPxKDZ',
    accessToken: 'figd_xxx',
    outputFolder: './img/systemActive',
    options: {
        skipHidden: true,
        pageFilter: '活动',
        nameFilter: /^Banner_\d{2}$/  // Banner_01 到 Banner_99
    },
    fileMapping: {
        'Banner_01.png': '1.png',
        'Banner_02.png': '2.png',
        // ... 更多映射
    },
    format: 'png',
    scale: 2
});
```

### 示例 2：下载所有页面的所有导出图层
```javascript
const result = await downloadFromFigma({
    fileKey: '7LqisrlVeOwdEpNyPPxKDZ',
    accessToken: 'figd_xxx',
    outputFolder: './img/all',
    options: {
        skipHidden: true
        // 不设置其他过滤，处理所有页面
    },
    fileMapping: {},  // 保持原名
    format: 'png',
    scale: 2
});
```

### 示例 3：只下载特定类型的节点
```javascript
const result = await downloadFromFigma({
    fileKey: '7LqisrlVeOwdEpNyPPxKDZ',
    accessToken: 'figd_xxx',
    outputFolder: './img/components',
    options: {
        skipHidden: true,
        typeFilter: ['COMPONENT', 'COMPONENT_SET']  // 只下载组件
    },
    format: 'png',
    scale: 2
});
```

## 🐛 故障排查

### 问题 1：API 返回 403 Forbidden
- 检查 Token 是否正确
- 检查 Token 是否有访问该文件的权限

### 问题 2：找不到任何图层
- 确认图层在 Figma 中设置了导出
- 检查 `options` 过滤条件是否太严格
- 使用 `--info` 参数查看文件结构

### 问题 3：下载的图片是空的
- 检查图层是否真的有内容
- 尝试不同的 `scale` 参数（1, 2, 3, 4）
- 检查 Figma 中图层的可见性

### 问题 4：仍然触发限流
- 确认使用的是 `core/figma-api.js` 中的批量方法
- 检查是否有其他脚本在同时调用 API
- 查看 API 调用统计：`result.apiCalls` 应该是 2

## 📚 相关文档

- [Figma API 官方文档](https://www.figma.com/developers/api)
- [Figma Images API](https://www.figma.com/developers/api#get-images-endpoint)
- [项目 README](./README.md)
