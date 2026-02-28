# AI安全测试 - 测试用例覆盖情况

本文档记录了Excel测试用例与自动化脚本的对应关系。

## 1. 接口安全测试 (12个用例)

| 用例编号 | 测试场景 | 优先级 | 自动化状态 | 文件位置 |
|---------|---------|--------|-----------|---------|
| API-001 | 未认证访问AI接口 | P0 | ✅ 已实现 | 1-api-security/api-security.test.js |
| API-002 | Token伪造/篡改 | P0 | ✅ 已实现 | 1-api-security/api-security.test.js |
| API-003 | 接口参数篡改 | P0 | ✅ 已实现 | 1-api-security/api-security.test.js |
| API-004 | 接口频率限制（防刷） | P0 | ✅ 已实现 | 1-api-security/api-security.test.js |
| API-005 | 超大输入攻击 | P0 | ✅ 已实现 | 1-api-security/api-security.test.js |
| API-006 | SQL注入测试 | P0 | ✅ 已实现 | 1-api-security/api-security.test.js |
| API-007 | XSS注入测试 | P0 | ✅ 已实现 | 1-api-security/api-security.test.js |
| API-008 | SSRF测试 | P0 | ✅ 已实现 | 1-api-security/api-security.test.js |
| API-009 | 路径遍历测试 | P1 | ⏭️ 跳过 | 不涉及文件操作 |
| API-010 | 请求重放攻击 | P1 | ✅ 已实现 | 1-api-security/api-security.test.js |
| API-011 | WebSocket安全 | P0 | ⚠️ 需手动 | 1-api-security/api-security.test.js |
| API-012 | HTTPS/TLS安全 | P0 | ⚠️ 需手动 | 需要专门工具检测 |

**覆盖率: 8/12 (67%) - 自动化实现**
**注: API-009不适用，API-011和API-012需要手动或专门工具验证**

## 2. 数据隔离测试 (12个用例)

### 2.1 多租户数据隔离 (7个用例)

| 用例编号 | 测试场景 | 优先级 | 自动化状态 | 文件位置 |
|---------|---------|--------|-----------|---------|
| TENANT-001 | 跨租户数据查询隔离 | P0 | ✅ 已实现 | 2-data-isolation/data-isolation.test.js |
| TENANT-002 | 伪造租户ID进行跨租户访问 | P0 | ✅ 已实现 | 2-data-isolation/data-isolation.test.js |
| TENANT-003 | 跨租户知识库隔离 | P0 | ✅ 已实现 | 2-data-isolation/data-isolation.test.js |
| TENANT-004 | 跨租户聊天记录隔离 | P0 | ✅ 已实现 | 2-data-isolation/data-isolation.test.js |
| TENANT-005 | LLM上下文中的跨租户泄露 | P0 | ⏭️ 跳过 | 需要高并发场景 |
| TENANT-006 | 租户ID缺失时的默认行为 | P0 | ✅ 已实现 | 2-data-isolation/data-isolation.test.js |
| TENANT-007 | 删除租户后数据访问 | P1 | ⏭️ 跳过 | 需要管理员权限删除租户 |

### 2.2 用户数据隔离 (5个用例)

| 用例编号 | 测试场景 | 优先级 | 自动化状态 | 文件位置 |
|---------|---------|--------|-----------|---------|
| UISO-001 | 同租户跨用户聊天记录隔离 | P0 | ✅ 已实现 | 2-data-isolation/data-isolation.test.js |
| UISO-002 | 用户上下文不交叉 | P0 | ✅ 已实现 | 2-data-isolation/data-isolation.test.js |
| UISO-003 | 遍历会话ID获取他人记录 | P0 | ⏭️ 跳过 | 需要大量会话ID遍历 |
| UISO-004 | 用户注销后聊天记录处理 | P1 | ⏭️ 跳过 | 需要注销用户操作 |
| UISO-005 | 多设备同一用户会话隔离 | P1 | ⏭️ 跳过 | 需要多设备模拟 |

**覆盖率: 7/12 (58%) - 自动化实现**
**注: 部分用例需要特殊场景或管理员操作**

## 3. 服务器探测测试 (8个用例)

| 用例编号 | 测试场景 | 优先级 | 自动化状态 | 文件位置 |
|---------|---------|--------|-----------|---------|
| SRV-001 | 错误信息泄露 | P0 | ✅ 已实现 | 3-server-probe/server-probe.test.js |
| SRV-002 | HTTP响应头安全 | P0 | ⚠️ 需手动 | 需要检查响应头 |
| SRV-003 | 目录遍历探测 | P0 | ✅ 已实现 | 3-server-probe/server-probe.test.js |
| SRV-004 | 端口扫描防护 | P1 | ⚠️ 需手动 | 需要专门的端口扫描工具 |
| SRV-005 | API文档泄露 | P0 | ✅ 已实现 | 3-server-probe/server-probe.test.js |
| SRV-006 | 健康检查端点安全 | P1 | ⏭️ 跳过 | 可选检查 |
| SRV-007 | 日志文件访问 | P0 | ✅ 已实现 | 3-server-probe/server-probe.test.js |
| SRV-008 | 内网信息探测（通过AI） | P0 | ✅ 已实现 | 3-server-probe/server-probe.test.js |

**覆盖率: 5/8 (63%) - 自动化实现**
**注: SRV-002和SRV-004需要专门工具**

## 4. 输入验证与边界安全测试 (5个用例)

| 用例编号 | 测试场景 | 优先级 | 自动化状态 | 文件位置 |
|---------|---------|--------|-----------|---------|
| INPUT-001 | 特殊字符注入 | P0 | ✅ 已实现 | 4-input-validation/input-validation.test.js |
| INPUT-002 | 超长输入 | P0 | ✅ 已实现 | 4-input-validation/input-validation.test.js |
| INPUT-003 | 空输入/纯空格 | P1 | ✅ 已实现 | 4-input-validation/input-validation.test.js |
| INPUT-004 | 二进制/非文本数据 | P1 | ✅ 已实现 | 4-input-validation/input-validation.test.js |
| INPUT-005 | 前端URL参数篡改 | P0 | ✅ 已实现 | 4-input-validation/input-validation.test.js |

**覆盖率: 5/5 (100%) - 自动化实现**

## 总体覆盖情况

| 测试类别 | 总用例数 | 已实现 | 需手动 | 跳过 | 覆盖率 |
|---------|---------|--------|--------|------|--------|
| 接口安全 | 12 | 8 | 2 | 2 | 67% |
| 数据隔离 | 12 | 7 | 0 | 5 | 58% |
| 服务器探测 | 8 | 5 | 2 | 1 | 63% |
| 输入验证 | 5 | 5 | 0 | 0 | 100% |
| **总计** | **37** | **25** | **4** | **8** | **68%** |

## 未实现用例说明

### 需要手动验证的用例 (4个)
1. **API-011 WebSocket安全**: k6对WebSocket支持有限，建议使用浏览器开发者工具
2. **API-012 HTTPS/TLS安全**: 需要使用SSL Labs或nmap等专门工具
3. **SRV-002 HTTP响应头安全**: 需要手动检查响应头配置
4. **SRV-004 端口扫描防护**: 需要使用nmap等端口扫描工具

### 跳过的用例 (8个)
1. **API-009 路径遍历**: 本系统不涉及文件操作
2. **TENANT-005 LLM上下文跨租户泄露**: 需要高并发压测场景
3. **TENANT-007 删除租户后数据访问**: 需要管理员权限删除租户
4. **UISO-003 遍历会话ID**: 需要大量会话ID遍历，效率低
5. **UISO-004 用户注销后记录处理**: 需要注销用户操作
6. **UISO-005 多设备会话隔离**: 需要多设备模拟
7. **SRV-006 健康检查端点**: 可选检查项

## 未包含的测试类别

以下测试类别未实现自动化（根据需求，本系统不涉及身份证相关测试）：

1. **数据脱敏测试** (10个用例) - 不涉及身份证，手机号、银行卡等脱敏需根据实际业务实现
2. **Prompt注入与LLM安全** (10个用例) - 需要根据实际LLM实现进行测试
3. **敏感词与违规内容** (5个用例) - 需要根据实际内容审核策略测试
4. **系统探测** (8个用例) - 部分与服务器探测重复
5. **会话安全** (5个用例) - 部分已在数据隔离中覆盖
6. **并发安全与资源耗尽** (5个用例) - 需要专门的压力测试
7. **日志审计安全** (5个用例) - 需要访问日志系统
8. **业务逻辑安全** (8个用例) - 需要根据具体业务逻辑实现
9. **数据安全与隐私** (6个用例) - 需要访问数据库和缓存
10. **第三方依赖安全** (3个用例) - 需要检查配置和密钥管理

## 建议

1. **优先修复P0级别的失败用例**
2. **手动验证需要专门工具的用例**
3. **根据业务需要补充数据脱敏和Prompt注入测试**
4. **定期执行完整测试套件，确保安全性**
5. **将自动化测试集成到CI/CD流程**
