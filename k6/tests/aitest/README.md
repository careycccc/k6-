# AI智能助手系统 - 安全测试自动化

本目录包含AI智能助手系统的安全测试用例自动化脚本，基于Excel测试用例文档生成。

## 系统说明

**重要：** AI是嵌入在系统中的功能，使用流程如下：

```
用户登录系统 → 获取token（包含租户ID） → 点击AI按钮 → 打开AI对话框 → 发送消息
```

**特点：**
- AI不是独立服务，是系统的一部分
- 需要先登录系统才能使用AI
- 租户之间通过租户ID区分（从token中解析）
- 测试脚本使用项目现有的登录方法（AdminLogin）

## 快速开始

### 1. 找到AI接口地址

登录系统 → F12开发者工具 → 点击AI按钮 → 发送消息 → 在Network中查看请求URL

### 2. 修改配置

编辑 `k6/tests/aitest/common/aiTestUtils.js` 第23行：
```javascript
const api = '/api/ai/chat';  // 改为实际的AI接口地址
```

### 3. 运行测试

```bash
# 运行所有测试
./k6/tests/aitest/run-all.sh

# 或单独运行某个类别
./k6/tests/aitest/run-api-security.sh
```

详细说明请查看 [QUICKSTART.md](QUICKSTART.md)

## 测试类别

### 1. 接口安全测试 (1-api-security)
- API-001: 未认证访问AI接口
- API-002: Token伪造/篡改
- API-003: 接口参数篡改
- API-004: 接口频率限制
- API-005: 超大输入攻击
- API-006: SQL注入测试
- API-007: XSS注入测试
- API-008: SSRF测试
- API-010: 请求重放攻击
- API-011: WebSocket安全

### 2. 数据隔离测试 (2-data-isolation)
- TENANT-001: 跨租户数据查询隔离
- TENANT-002: 伪造租户ID进行跨租户访问
- TENANT-003: 跨租户知识库隔离
- TENANT-004: 跨租户聊天记录隔离
- TENANT-006: 租户ID缺失时的默认行为
- UISO-001: 同租户跨用户聊天记录隔离
- UISO-002: 用户上下文不交叉

### 3. 服务器探测测试 (3-server-probe)
- SRV-001: 错误信息泄露
- SRV-003: 目录遍历探测
- SRV-005: API文档泄露
- SRV-007: 日志文件访问
- SRV-008: 内网信息探测（通过AI）

### 4. 输入验证与边界安全测试 (4-input-validation)
- INPUT-001: 特殊字符注入
- INPUT-002: 超长输入
- INPUT-003: 空输入/纯空格
- INPUT-004: 二进制/非文本数据
- INPUT-005: 前端URL参数篡改

## 执行方式

### 运行所有测试
```bash
k6 run k6/tests/aitest/run-all-tests.js
```

### 单独运行某个测试类别

#### 1. 接口安全测试
```bash
k6 run k6/tests/aitest/1-api-security/api-security.test.js
```

#### 2. 数据隔离测试
```bash
k6 run k6/tests/aitest/2-data-isolation/data-isolation.test.js
```

#### 3. 服务器探测测试
```bash
k6 run k6/tests/aitest/3-server-probe/server-probe.test.js
```

#### 4. 输入验证与边界安全测试
```bash
k6 run k6/tests/aitest/4-input-validation/input-validation.test.js
```

## 配置说明

### 环境配置
测试使用 `k6/config/envconfig.js` 中的配置：
- 租户ID: 3004
- 管理员账号: carey3004
- 限制权限账号: carey3004_001
- AI接口地址: /api/apitest (需要根据实际情况修改)

### 修改AI接口地址
如果AI接口地址不是 `/api/apitest`，请修改 `k6/tests/aitest/common/aiTestUtils.js` 中的 `api` 变量。

## 测试报告

测试完成后会生成HTML报告，保存在 `reports/` 目录下。

## 注意事项

1. 测试前请确保：
   - 已配置正确的环境变量
   - 测试账号有足够的权限
   - AI接口地址正确

2. 某些测试用例需要多个租户才能完整测试：
   - 跨租户数据隔离测试需要配置租户3002的账号

3. 测试优先级：
   - P0: 必须在上线前100%通过
   - P1: 通过率应≥90%

4. 测试结果说明：
   - ✓ 表示测试通过
   - ✗ 表示测试失败
   - ⚠ 表示警告或需要手动验证

## 扩展测试

如需添加新的测试用例，请参考现有测试文件的结构：
1. 在对应目录下创建测试文件
2. 实现测试函数
3. 在 `run-all-tests.js` 中导入并执行
