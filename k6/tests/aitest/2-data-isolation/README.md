# 数据隔离测试 - 说明文档

## 系统环境

**租户信息：**
- 租户3004（当前测试使用）
- 租户3003
- 租户3002
- 租户3001

**数据库表：**
- 用户表：tab_user

## 测试用例说明

### TENANT-001: 跨租户数据查询隔离
**测试目的：** 验证查询操作是否正确过滤租户数据

**测试方法：**
- 使用租户3004的账号查询所有用户
- 检查返回数据中是否包含其他租户（3003, 3002, 3001）的数据

**预期结果：**
- 只返回租户3004的数据
- 不包含任何其他租户的数据

---

### TENANT-002: 伪造租户ID进行跨租户访问 ⚠️ 重点测试

**测试目的：** 验证系统是否正确处理租户ID篡改攻击

**测试方法：**
使用租户3004的token，在请求参数中尝试篡改tenantId为：
1. 3003（其他存在的租户）
2. 3002（其他存在的租户）
3. 3001（其他存在的租户）
4. 9999（不存在的租户）

**预期结果：**
- 系统应该忽略请求参数中的tenantId
- 始终使用token中解析的租户ID（3004）
- 只返回租户3004的数据，或拒绝请求

**安全风险：**
如果系统使用请求参数中的tenantId，攻击者可以：
- ❌ 访问任意租户的数据
- ❌ 造成严重的数据泄露
- ❌ 违反数据隔离原则

**正确实现：**
```javascript
// ✅ 正确：从token中解析租户ID
const tenantId = req.user.tenantId;  // 从认证中间件获取

// ❌ 错误：使用请求参数中的租户ID
const tenantId = req.body.tenantId;  // 不安全！
```

**详细说明：** 查看 [tenant-id-tampering.md](./tenant-id-tampering.md)

---

### TENANT-003: 跨租户知识库隔离
**测试目的：** 验证AI知识库检索是否正确过滤租户

**测试方法：**
- 询问业务规则相关问题
- 检查AI返回的知识库内容是否包含其他租户的信息

**预期结果：**
- 只返回当前租户的知识库内容
- 不泄露其他租户的业务信息

---

### TENANT-004: 跨租户聊天记录隔离
**测试目的：** 验证聊天会话是否正确隔离

**测试方法：**
1. 用租户3004创建一个会话
2. 用租户3002尝试访问该会话

**预期结果：**
- 租户3002无法访问租户3004的会话
- 返回权限错误或空数据

---

### TENANT-006: 租户ID缺失时的默认行为
**测试目的：** 验证系统是否依赖token而不是请求参数

**测试方法：**
- 发送请求时不传递tenantId参数
- 检查系统是否能正常工作

**预期结果：**
- 系统从token中解析租户ID
- 正常返回当前租户的数据

---

### UISO-001: 同租户跨用户聊天记录隔离
**测试目的：** 验证同租户内不同用户的会话隔离

**测试方法：**
1. 用限制权限用户创建会话
2. 用管理员尝试访问该会话

**预期结果：**
- 根据业务需求，管理员可能有权限查看
- 普通用户之间应该无法互相访问

---

### UISO-002: 用户上下文不交叉
**测试目的：** 验证不同用户的AI对话上下文是否隔离

**测试方法：**
1. 用户A讨论签到活动
2. 用户B讨论充值活动
3. 用户A继续对话，检查是否提到充值

**预期结果：**
- 用户A的上下文只包含签到活动
- 不包含用户B讨论的充值活动

## 运行测试

```bash
# 运行数据隔离测试
./k6/tests/aitest/run-data-isolation.sh

# 或使用k6命令
k6 run k6/tests/aitest/2-data-isolation/data-isolation.test.js
```

## 测试结果说明

### ✓ 通过
- 系统正确实现了数据隔离
- 租户ID从token中解析
- 不信任请求参数

### ✗ 失败
- 存在安全漏洞
- 需要立即修复
- 可能导致数据泄露

### ⚠ 警告
- 需要人工确认
- 可能是业务需求
- 建议review代码

## 修复建议

如果TENANT-002测试失败，说明存在严重的安全漏洞，建议：

### 1. 后端代码修复
```javascript
// 在所有API接口中
function handleRequest(req, res) {
    // ✅ 从token中获取租户ID
    const tenantId = req.user.tenantId;
    
    // ✅ 验证请求参数（可选）
    if (req.body.tenantId && req.body.tenantId !== tenantId) {
        return res.status(403).json({
            msgCode: 403,
            msg: '租户ID验证失败'
        });
    }
    
    // ✅ 使用token中的租户ID查询数据
    const data = await queryData({ tenantId });
    return res.json(data);
}
```

### 2. 数据库查询
```sql
-- 所有查询必须包含租户ID过滤
SELECT * FROM tab_user 
WHERE tenant_id = ? 
AND ...
```

### 3. 中间件验证
```javascript
// 添加租户ID验证中间件
app.use((req, res, next) => {
    // 从token中解析租户ID
    const tenantId = parseToken(req.headers.authorization);
    
    // 强制使用token中的租户ID
    req.tenantId = tenantId;
    req.user = { ...req.user, tenantId };
    
    next();
});
```

### 4. ORM配置
```javascript
// 使用ORM时添加全局过滤器
Model.addScope('defaultScope', {
    where: {
        tenantId: req.user.tenantId
    }
});
```

## 安全检查清单

- [ ] 所有API接口都从token中获取租户ID
- [ ] 不信任请求参数中的租户ID
- [ ] 所有数据库查询都包含租户ID过滤
- [ ] 知识库检索包含租户ID过滤
- [ ] 聊天会话包含租户ID和用户ID验证
- [ ] 有完善的审计日志记录跨租户访问尝试

## 相关文档

- [tenant-id-tampering.md](./tenant-id-tampering.md) - 租户ID篡改详细说明
- [../CONFIG.md](../CONFIG.md) - 配置说明
- [../TEST_COVERAGE.md](../TEST_COVERAGE.md) - 测试覆盖情况
