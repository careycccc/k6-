# 租户ID篡改测试说明

## 系统租户信息

**已知租户ID：**
- 3004（当前测试使用）
- 3003
- 3002
- 3001

**用户表名：** tab_user

## TENANT-002 测试用例详细说明

### 测试目的
验证系统是否正确处理租户ID篡改攻击，确保后端从token中解析租户ID，而不是信任请求参数。

### 测试场景

#### 场景1：篡改为其他存在的租户ID
```javascript
// 使用租户3004的token
// 尝试在请求中将tenantId改为3003
{
    message: "查询用户信息",
    tenantId: 3003  // 篡改！
}
```

**预期结果：**
- 系统应该忽略请求中的tenantId
- 只返回租户3004的数据
- 或者拒绝请求

#### 场景2：篡改为不存在的租户ID
```javascript
{
    message: "查询用户信息",
    tenantId: 9999  // 不存在的租户
}
```

**预期结果：**
- 系统应该忽略请求中的tenantId
- 使用token中的租户ID（3004）
- 返回租户3004的数据

### 测试步骤

1. 使用租户3004的账号登录，获取token
2. 发送AI请求，在请求参数中篡改tenantId为：
   - 3003（其他存在的租户）
   - 3002（其他存在的租户）
   - 3001（其他存在的租户）
   - 9999（不存在的租户）
3. 检查响应数据：
   - 是否包含其他租户的数据
   - 是否只包含租户3004的数据

### 安全风险

如果系统使用请求参数中的tenantId而不是token中的，会导致：
- ❌ 跨租户数据泄露
- ❌ 用户可以访问任意租户的数据
- ❌ 严重的安全漏洞

### 正确的实现方式

```javascript
// 后端代码示例（伪代码）
function handleAIRequest(request, token) {
    // ✅ 正确：从token中解析租户ID
    const tenantId = parseTokenAndGetTenantId(token);
    
    // ❌ 错误：使用请求参数中的租户ID
    // const tenantId = request.body.tenantId;
    
    // 使用从token中解析的租户ID查询数据
    const data = queryData(tenantId);
    return data;
}
```

### 测试验证点

1. **响应数据检查**
   - 检查返回的数据中是否包含 `tenantId: 3003/3002/3001`
   - 应该只包含 `tenantId: 3004`

2. **SQL查询检查**（如果可以查看日志）
   - 检查实际执行的SQL是否包含正确的租户ID过滤
   - 例如：`SELECT * FROM tab_user WHERE tenant_id = 3004`

3. **错误处理检查**
   - 如果系统拒绝请求，应该返回明确的错误信息
   - 不应该泄露其他租户的存在

## 相关测试用例

- **TENANT-001**: 跨租户数据查询隔离
- **TENANT-003**: 跨租户知识库隔离
- **TENANT-004**: 跨租户聊天记录隔离

## 修复建议

如果测试失败，建议：

1. **后端修复**
   ```javascript
   // 始终从token中获取租户ID
   const tenantId = req.user.tenantId; // 从认证中间件解析的token
   
   // 忽略请求参数中的tenantId
   // 或者验证请求参数中的tenantId与token中的是否一致
   if (req.body.tenantId && req.body.tenantId !== tenantId) {
       throw new Error('租户ID不匹配');
   }
   ```

2. **数据库查询**
   ```sql
   -- 所有查询都必须包含租户ID过滤
   SELECT * FROM tab_user WHERE tenant_id = ? AND ...
   ```

3. **中间件验证**
   ```javascript
   // 添加租户ID验证中间件
   function validateTenantId(req, res, next) {
       const tokenTenantId = req.user.tenantId;
       const requestTenantId = req.body.tenantId;
       
       if (requestTenantId && requestTenantId !== tokenTenantId) {
           return res.status(403).json({
               msgCode: 403,
               msg: '租户ID验证失败'
           });
       }
       
       // 强制使用token中的租户ID
       req.tenantId = tokenTenantId;
       next();
   }
   ```
