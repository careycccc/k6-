# 站内信活动 - 自动上传图片配置

## ✅ 已集成自动上传功能

`batchCreateActivities.js` 现在会在 setup 阶段自动上传站内信所需的图片。

## 快速开始

### 1. 准备图片文件

```bash
# 创建目录
mkdir -p img/inmail

# 放置图片（命名为 1.png）
cp your-banner.png img/inmail/1.png
```

### 2. 运行批量创建

```bash
k6 run k6/tests/api/script/batchCreateActivities.js
```

系统会自动：
1. 上传 `img/inmail/1.png`
2. 获取真实的图片 URL
3. 使用这些 URL 创建站内信

## 执行流程

```
开始初始化批量创建活动系统...

[1/2] 正在获取登录Token...
[1/2] ✓ Token获取成功

[站内信] 开始上传图片资源...
✓ 成功加载文件: 1.png
[1/1] 正在上传: 1.png (100%)
✓ 文件 1.png 上传成功

===== 上传完成 =====
总计: 1 个文件
成功: 1 个
失败: 0 个
==================

[站内信] ✓ 图片上传成功
[站内信] 上传文件数: 1
```

## 图片要求

- **格式**: PNG
- **命名**: `1.png`
- **位置**: `./img/inmail/1.png`
- **建议尺寸**: 750px - 1200px 宽
- **建议大小**: < 500KB

## 上传失败处理

如果图片文件不存在或上传失败：

```
[站内信] ⚠️  图片上传失败: File not found
[站内信] 站内信活动将被跳过
```

站内信活动会自动跳过，其他活动继续执行。

## 相关文件

- `k6/tests/api/uploadFile/uploadInmail.js` - 上传逻辑
- `k6/tests/api/script/batchCreateActivities.js` - 批量创建脚本
- `img/inmail/1.png` - 图片文件

## 总结

现在只需要：
1. 准备图片：`img/inmail/1.png`
2. 运行脚本：`k6 run k6/tests/api/script/batchCreateActivities.js`

简单、自动、可靠！🎉
