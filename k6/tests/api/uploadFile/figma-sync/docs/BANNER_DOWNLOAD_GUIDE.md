# Banner 图片下载指南

## 快速开始

已优化脚本，现在会：
1. ✅ 只遍历"活动_"开头的 83 个 FRAME 节点（不是全部 13192 个）
2. ✅ 查找 Banner 1-13 的图片
3. ✅ 找齐 13 张就自动停止
4. ✅ 按编号命名（Banner_01.png, Banner_02.png, ...）
5. ✅ 自动去重和跳过已存在的文件

## 使用命令

```bash
cd k6/tests/api/uploadFile

# 下载活动页面的 Banner 1-13
./download-activity-banners.sh "https://www.figma.com/design/xkOpdVjdK9RSxGEnUrfOwd/..."

# 预览模式（不实际下载）
./download-activity-banners.sh "https://www.figma.com/design/xkOpdVjdK9RSxGEnUrfOwd/..." --dry-run

# 自定义数量（比如只要前10张）
node download-banners.js "xkOpdVjdK9RSxGEnUrfOwd" --page="活动" --count=10
```

## 优化说明

### 之前的问题
- 遍历所有 13192 个 FRAME（太慢）
- 没有编号识别
- 不会自动停止

### 现在的优化
- 只遍历 83 个"活动_"开头的 FRAME
- 提取 Banner 编号（Banner 13 -> 13）
- 找齐目标数量就停止
- 文件名按编号命名：Banner_01.png, Banner_02.png, ...

## 输出示例

```
🚀 开始处理...
📁 File Key: xkOpdVjdK9RSxGEnUrfOwd
📄 页面: 活动
🔍 Banner 前缀: banner
🎯 目标数量: 13 张
📂 输出目录: downloaded-banners

📥 获取页面列表...
✅ 找到页面: 🌈活动_Activity

📥 获取页面详细信息...

🔍 查找"活动"相关的 FRAME 节点...
✅ 找到 83 个"活动"FRAME

🔍 查找 Banner（目标: 13 张）...
处理 25/83: 活动_每日签到_可领取金额... (已找到 13/13)
✅ 已找到 13 张不同编号的 Banner，停止搜索

✅ 共找到 15 个 Banner
📊 找到的编号: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13

📋 找到的 Banner:
  📦 活动_每日签到_可领取金额
     ├─ Banner 13 - 每日签到 [#13]
     ├─ Banner 12 - 每日每周任务 [#12]
  
  📦 活动_会员洗码
     ├─ Banner 10 - 会员洗码 [#10]
  ...

⬇️  开始下载图片...
  ✅ 下载: Banner 13 - 每日签到 [#13] -> Banner_13.png
  ✅ 下载: Banner 12 - 每日每周任务 [#12] -> Banner_12.png
  ✅ 下载: Banner 10 - 会员洗码 [#10] -> Banner_10.png
  ...

================================================================================
✅ 完成！
📊 统计:
   - 总共找到: 15 个 Banner
   - 去重后: 13 个
   - 已下载: 13 个
   - 已跳过: 0 个
📂 保存位置: downloaded-banners
```

## 文件命名规则

- 有编号的：`Banner_01.png`, `Banner_02.png`, ..., `Banner_13.png`
- 无编号的：使用原始名称（清理特殊字符）

## 常见问题

### Q1: 为什么只找到 12 张，缺少某个编号？

可能原因：
1. Figma 中确实没有这个编号的 Banner
2. Banner 名称格式不对（不是 "Banner X" 格式）

解决方法：
```bash
# 查看所有找到的 Banner
./download-activity-banners.sh "URL" --dry-run
```

### Q2: 如何下载其他数量的 Banner？

```bash
# 下载 Banner 1-15
node download-banners.js "FILE_KEY" --page="活动" --count=15

# 下载 Banner 1-10
node download-banners.js "FILE_KEY" --page="活动" --count=10
```

### Q3: 如何只下载特定编号的 Banner？

```bash
# 只下载 Banner 13
./download-activity-banners.sh "URL" --prefix="Banner 13"

# 只下载 Banner 10-13
# 需要手动运行多次或修改脚本
```

### Q4: 下载的图片在哪里？

默认保存在 `k6/tests/api/uploadFile/downloaded-banners/` 目录

自定义目录：
```bash
node download-banners.js "FILE_KEY" --page="活动" --output="./my-banners"
```

## 性能对比

| 场景 | 之前 | 现在 |
|------|------|------|
| 遍历节点数 | 13192 个 FRAME | 83 个 FRAME |
| 预计时间 | 30-60 分钟 | 2-5 分钟 |
| 停止条件 | 遍历完所有 | 找齐就停止 |
| 文件命名 | 原始名称 | 按编号命名 |

## 技术细节

### 查找逻辑
1. 获取"活动_Activity"页面
2. 查找顶层"活动_"开头的 FRAME（depth <= 2）
3. 逐个遍历这些 FRAME
4. 在每个 FRAME 下查找 "Banner" 开头的节点
5. 提取编号（正则: `/Banner\s+(\d+)/i`）
6. 记录已找到的编号
7. 当找齐目标数量时停止

### 去重策略
- 按编号去重（每个编号只保留一个）
- 如果同一编号有多个，保留名称最短的（更可能是主要的）

### 文件命名
- 有编号：`Banner_${编号.padStart(2, '0')}.png`
- 无编号：`${清理后的名称}.png`

## 下一步

下载完成后，你可以：
1. 检查 `downloaded-banners` 目录
2. 确认是否有缺失的编号
3. 将图片上传到你的系统
4. 更新配置文件中的图片路径
