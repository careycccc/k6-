# AI安全测试自动化 - 项目总结

## 项目概述

本项目基于《AI智能助手系统_安全测试用例_20260227_094235.xlsx》文档，为AI智能助手系统生成了自动化安全测试脚本。

## 系统架构说明

**AI系统特点：**
1. AI是嵌入在系统中的功能，不是独立服务
2. 用户需要先登录系统才能使用AI
3. 登录后点击AI按钮打开对话框
4. 租户之间通过租户ID区分（从token中解析）
5. 测试脚本使用项目现有的登录方法（AdminLogin）

**登录流程：**
```
用户 → 登录系统 → 获取token（包含租户ID） → 点击AI按钮 → 发送AI请求（携带token）
```

## 已完成的工作

### 1. 测试框架搭建
- ✅ 创建了通用的AI测试工具类 (`common/aiTestUtils.js`)
- ✅ 实现了登录、请求发送、响应解析等基础功能
- ✅ 提供了统一的测试报告生成机制

### 2. 测试用例实现

#### 接口安全测试 (1-api-security/)
实现了10个自动化测试用例：
- API-001: 未认证访问AI接口
- API-002: Token伪造/篡改
- API-003: 接口参数篡改
- API-004: 接口频率限制
- API-005: 超大输入攻击
- API-006: SQL注入测试
- API-007: XSS注入测试
- API-008: SSRF测试
- API-010: 请求重放攻击
- API-011: WebSocket安全（标记需手动验证）

#### 数据隔离测试 (2-data-isolation/)
实现了7个自动化测试用例：
- TENANT-001: 跨租户数据查询隔离
- TENANT-002: 伪造租户ID进行跨租户访问
- TENANT-003: 跨租户知识库隔离
- TENANT-004: 跨租户聊天记录隔离
- TENANT-006: 租户ID缺失时的默认行为
- UISO-001: 同租户跨用户聊天记录隔离
- UISO-002: 用户上下文不交叉

#### 服务器探测测试 (3-server-probe/)
实现了5个自动化测试用例：
- SRV-001: 错误信息泄露
- SRV-003: 目录遍历探测
- SRV-005: API文档泄露
- SRV-007: 日志文件访问
- SRV-008: 内网信息探测（通过AI）

#### 输入验证与边界安全测试 (4-input-validation/)
实现了5个自动化测试用例：
- INPUT-001: 特殊字符注入
- INPUT-002: 超长输入
- INPUT-003: 空输入/纯空格
- INPUT-004: 二进制/非文本数据
- INPUT-005: 前端URL参数篡改

### 3. 执行脚本
- ✅ 创建了总执行脚本 (`run-all-tests.js`)
- ✅ 为每个测试类别创建了独立的Shell脚本
- ✅ 所有脚本已添加执行权限

### 4. 文档
- ✅ README.md - 完整使用说明
- ✅ QUICKSTART.md - 快速开始指南
- ✅ CONFIG.md - 配置说明
- ✅ TEST_COVERAGE.md - 测试覆盖情况
- ✅ SUMMARY.md - 项目总结（本文档）

## 项目结构

```
k6/tests/aitest/
├── common/
│   └── aiTestUtils.js              # 通用测试工具类
├── 1-api-security/
│   └── api-security.test.js        # 接口安全测试
├── 2-data-isolation/
│   └── data-isolation.test.js      # 数据隔离测试
├── 3-server-probe/
│   └── server-probe.test.js        # 服务器探测测试
├── 4-input-validation/
│   └── input-validation.test.js    # 输入验证测试
├── run-all-tests.js                # 总执行脚本
├── run-all.sh                      # 总执行Shell脚本
├── run-api-security.sh             # 接口安全测试脚本
├── run-data-isolation.sh           # 数据隔离测试脚本
├── run-server-probe.sh             # 服务器探测测试脚本
├── run-input-validation.sh         # 输入验证测试脚本
├── README.md                       # 使用说明
├── QUICKSTART.md                   # 快速开始
├── CONFIG.md                       # 配置说明
├── TEST_COVERAGE.md                # 测试覆盖情况
└── SUMMARY.md                      # 项目总结
```

## 使用方式

### 快速开始
```bash
# 1. 修改AI接口地址
vim k6/tests/aitest/common/aiTestUtils.js

# 2. 运行所有测试
./k6/tests/aitest/run-all.sh

# 3. 查看报告
open reports/ai-security-test-*.html
```

### 单独运行
```bash
# 接口安全测试
./k6/tests/aitest/run-api-security.sh

# 数据隔离测试
./k6/tests/aitest/run-data-isolation.sh

# 服务器探测测试
./k6/tests/aitest/run-server-probe.sh

# 输入验证测试
./k6/tests/aitest/run-input-validation.sh
```

## 测试覆盖率

| 测试类别 | 总用例数 | 已实现 | 覆盖率 |
|---------|---------|--------|--------|
| 接口安全 | 12 | 8 | 67% |
| 数据隔离 | 12 | 7 | 58% |
| 服务器探测 | 8 | 5 | 63% |
| 输入验证 | 5 | 5 | 100% |
| **总计** | **37** | **25** | **68%** |

## 配置要点

### 必须配置项

1. **AI接口地址**: `common/aiTestUtils.js` 第23行
   ```javascript
   const api = '/api/ai/chat';  // 这是假设的地址，需要修改
   ```
   
   **如何找到实际接口：**
   - 登录系统后台
   - 打开浏览器F12开发者工具
   - 点击AI按钮，发送一条消息
   - 在Network标签查看请求URL

2. **租户和账号**: `k6/config/envconfig.js`
   ```javascript
   TENANTID: 3004,                    // 当前租户ID
   ADMIN_USERNAME: "carey3004",       // 管理员账号
   ADMIN_PASSWORD: "qwer1234"
   ```
   
   **说明：**
   - 测试脚本会自动调用 AdminLogin() 登录
   - 登录后获得的token包含租户ID
   - 无需在AI请求中手动传递租户ID

### 可选配置项
1. **第二个租户账号**: 用于跨租户测试
   - 在 `2-data-isolation/data-isolation.test.js` 中配置
   - 使用 `loginWithCredentials('carey3002', 'qwer1234')`
   
2. **限制权限账号**: 用于权限隔离测试
   - 配置在 `envconfig.js` 中
   - LimitedPermissions: "carey3004_001"

3. **请求格式**: 根据实际接口调整
   - 测试脚本使用项目的 `sendRequest` 方法
   - 自动处理签名、时间戳、random、language等字段

## 技术特点

### 1. 模块化设计
- 每个测试类别独立文件
- 通用功能抽取到工具类
- 易于维护和扩展

### 2. 灵活执行
- 支持全量测试
- 支持单类别测试
- 支持单用例调试

### 3. 详细报告
- 控制台实时输出
- HTML格式报告
- 测试结果统计

### 4. 易于集成
- 标准k6脚本
- 可集成到CI/CD
- 支持自动化回归

## 注意事项

### 1. AI接口地址
当前假设AI接口为 `/api/ai/chat`，**必须修改为实际接口地址**。

**查找方法：**
1. 登录系统后台
2. F12打开开发者工具
3. 点击AI按钮
4. 发送消息
5. 在Network中查看请求URL

### 2. 登录方式
测试脚本使用项目现有的登录方法：
- 调用 `AdminLogin()` 获取token
- token中包含租户ID和用户信息
- 所有AI请求自动携带token

### 3. 请求格式
使用项目的 `sendRequest` 方法，自动处理：
- ✅ 签名 (signature)
- ✅ 时间戳 (timestamp)  
- ✅ 随机数 (random)
- ✅ 语言 (language)
- ✅ Token认证

### 4. 租户隔离
- 租户ID从登录token中解析
- 无需在请求中手动传递tenantId
- 后端应该从token中获取租户信息，而不是从请求参数

### 5. 多租户测试
完整的跨租户测试需要配置第二个租户的账号（carey3002）。

## 未实现的测试类别

根据需求，以下测试类别未实现自动化：

1. **数据脱敏测试** - 不涉及身份证
2. **Prompt注入与LLM安全** - 需要根据实际LLM实现
3. **敏感词与违规内容** - 需要根据内容审核策略
4. **会话安全** - 部分已在数据隔离中覆盖
5. **并发安全与资源耗尽** - 需要专门的压力测试
6. **日志审计安全** - 需要访问日志系统
7. **业务逻辑安全** - 需要根据具体业务实现
8. **数据安全与隐私** - 需要访问数据库和缓存
9. **第三方依赖安全** - 需要检查配置和密钥管理

## 后续建议

### 短期（1-2周）
1. 根据实际接口调整配置
2. 运行测试并修复发现的问题
3. 补充手动验证项的测试

### 中期（1个月）
1. 根据业务需要补充数据脱敏测试
2. 实现Prompt注入测试
3. 将测试集成到CI/CD流程

### 长期（持续）
1. 定期执行完整测试套件
2. 根据新功能补充测试用例
3. 优化测试性能和覆盖率
4. 建立安全测试最佳实践

## 成果交付

### 代码文件
- 4个测试类别脚本
- 1个通用工具类
- 1个总执行脚本
- 5个Shell执行脚本

### 文档文件
- 5个Markdown文档
- 完整的使用说明
- 配置指南
- 测试覆盖报告

### 测试用例
- 25个自动化测试用例
- 覆盖4个主要安全类别
- 总覆盖率68%

## 联系与支持

如有问题，请参考：
1. QUICKSTART.md - 快速开始
2. CONFIG.md - 配置说明
3. TEST_COVERAGE.md - 测试覆盖情况
4. 各测试文件中的详细注释

---

**项目完成时间**: 2026-02-27
**测试框架**: k6
**编程语言**: JavaScript
**测试类别**: 接口安全、数据隔离、服务器探测、输入验证
