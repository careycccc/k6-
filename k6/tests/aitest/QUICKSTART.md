# AI安全测试 - 快速开始指南

## 系统说明

**重要：** AI是嵌入在系统中的功能，使用流程如下：
1. 用户登录系统（后台管理系统）
2. 登录成功后点击AI按钮
3. 打开AI对话框进行交互
4. 租户之间通过租户ID区分（从登录token中解析）

## 前置条件

1. 已安装 k6
   ```bash
   # macOS
   brew install k6
   
   # Windows
   choco install k6
   
   # Linux
   sudo apt-get install k6
   ```

2. 已配置测试环境（见 CONFIG.md）

## 5分钟快速开始

### 步骤1: 找到AI接口地址

**重要：** 需要先找到实际的AI接口地址

1. 登录系统后台
2. 打开浏览器开发者工具（F12）
3. 点击AI按钮，打开AI对话框
4. 在Network标签中发送一条消息
5. 查看请求的URL，例如：`/api/ai/chat`

### 步骤2: 修改AI接口地址

编辑 `k6/tests/aitest/common/aiTestUtils.js`，修改第23行：

```javascript
const api = '/api/ai/chat';  // 改为你在步骤1中找到的实际接口地址
```

### 步骤3: 确认账号配置

检查 `k6/config/envconfig.js` 中的账号配置是否正确：
- ADMIN_USERNAME: carey3004（租户3004的管理员）
- ADMIN_PASSWORD: qwer1234
- TENANTID: 3004

**说明：**
- 测试脚本会使用这个账号登录系统
- 登录后会获得token，token中包含租户ID
- 所有AI请求都会携带这个token

### 步骤4: 运行测试

#### 方式1: 使用Shell脚本（推荐）

```bash
# 运行所有测试
./k6/tests/aitest/run-all.sh

# 或单独运行某个测试类别
./k6/tests/aitest/run-api-security.sh        # 接口安全
./k6/tests/aitest/run-data-isolation.sh      # 数据隔离
./k6/tests/aitest/run-server-probe.sh        # 服务器探测
./k6/tests/aitest/run-input-validation.sh    # 输入验证
```

#### 方式2: 直接使用k6命令

```bash
# 运行所有测试
k6 run k6/tests/aitest/run-all-tests.js

# 或单独运行某个测试类别
k6 run k6/tests/aitest/1-api-security/api-security.test.js
k6 run k6/tests/aitest/2-data-isolation/data-isolation.test.js
k6 run k6/tests/aitest/3-server-probe/server-probe.test.js
k6 run k6/tests/aitest/4-input-validation/input-validation.test.js
```

### 步骤4: 查看测试结果

测试完成后：
1. 控制台会显示测试结果摘要
2. HTML报告保存在 `reports/` 目录
3. 打开HTML报告查看详细结果

## 测试结果说明

### 符号含义
- ✓ 测试通过
- ✗ 测试失败（需要修复）
- ⚠ 警告（需要关注）

### 优先级
- P0: 严重问题，必须修复
- P1: 重要问题，建议修复

## 常见测试场景

### 场景1: 首次运行测试

```bash
# 1. 修改AI接口地址
vim k6/tests/aitest/common/aiTestUtils.js

# 2. 运行接口安全测试（最基础）
./k6/tests/aitest/run-api-security.sh

# 3. 查看结果，确认配置正确
```

### 场景2: 完整安全测试

```bash
# 运行所有测试类别
./k6/tests/aitest/run-all.sh

# 查看HTML报告
open reports/ai-security-test-*.html
```

### 场景3: 针对性测试

```bash
# 只测试数据隔离
./k6/tests/aitest/run-data-isolation.sh

# 只测试输入验证
./k6/tests/aitest/run-input-validation.sh
```

## 测试时间估算

- 接口安全测试: 约2-3分钟
- 数据隔离测试: 约2-3分钟
- 服务器探测测试: 约1-2分钟
- 输入验证测试: 约1-2分钟
- 完整测试套件: 约8-10分钟

## 下一步

1. 查看 README.md 了解详细的测试用例说明
2. 查看 CONFIG.md 了解高级配置选项
3. 根据测试结果修复发现的安全问题
4. 将测试集成到CI/CD流程

## 故障排除

### 问题1: 命令找不到
```bash
# 确保脚本有执行权限
chmod +x k6/tests/aitest/*.sh
```

### 问题2: 登录失败
```bash
# 检查账号配置
cat k6/config/envconfig.js

# 手动测试登录
k6 run k6/tests/api/login/adminlogin.test.js
```

### 问题3: AI接口404
```bash
# 检查接口地址配置
grep "const api" k6/tests/aitest/common/aiTestUtils.js
```

## 获取帮助

- 查看 README.md - 完整文档
- 查看 CONFIG.md - 配置说明
- 查看测试文件中的注释 - 了解测试逻辑
