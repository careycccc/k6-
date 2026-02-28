# AI安全测试 - 更新说明

## 更新日期
2026-02-27

## 更新内容

### 1. 系统架构说明更新

**原来的假设：**
- AI是独立的服务
- 直接调用AI接口

**实际情况：**
- ✅ AI是嵌入在系统中的功能
- ✅ 需要先登录系统才能使用
- ✅ 登录后点击AI按钮打开对话框
- ✅ 租户之间通过租户ID区分（从token中解析）

### 2. 登录方式更新

**更新前：**
```javascript
// 自己实现的登录方法
static login(username, password, isAdmin) {
    const api = '/api/Login/Login';
    // ... 自己实现登录逻辑
}
```

**更新后：**
```javascript
// 使用项目现有的登录方法
import { AdminLogin } from '../../api/login/adminlogin.test.js';

static login() {
    // 调用项目现有的登录方法
    const token = AdminLogin();
    return token;
}

// 新增：使用指定账号登录
static loginWithCredentials(username, password) {
    const api = '/api/Login/Login';
    const result = sendRequest(payload, api, 'login', false);
    return result.data.token;
}
```

### 3. AI请求方式更新

**更新前：**
```javascript
// 直接使用httpClient
const response = httpClient.post(api, payload, options, isDesk);
```

**更新后：**
```javascript
// 使用项目的sendRequest方法，自动处理签名等
import { sendRequest } from '../../api/common/request.js';

const result = sendRequest(
    payload,
    api,
    'ai_test',
    false,  // isDesk: false 表示后台接口
    token   // 传入登录token
);
```

**优势：**
- ✅ 自动处理签名 (signature)
- ✅ 自动处理时间戳 (timestamp)
- ✅ 自动处理随机数 (random)
- ✅ 自动处理语言 (language)
- ✅ 统一的错误处理

### 4. 租户ID处理更新

**更新前：**
```javascript
// 需要手动传递租户ID
const payload = {
    message: message,
    tenantId: ENV_CONFIG.TENANTID  // 手动传递
};
```

**更新后：**
```javascript
// 租户ID从token中解析，无需手动传递
const payload = {
    message: message,
    sessionId: options.sessionId
    // 不需要传递tenantId，后端从token中解析
};
```

**说明：**
- 登录时token中已包含租户ID
- 后端应该从token中获取租户信息
- 如果后端依赖请求参数中的tenantId，这是一个安全风险

### 5. 文件更新列表

#### 核心文件
- ✅ `common/aiTestUtils.js` - 完全重写
  - 使用项目的 sendRequest 方法
  - 使用项目的 AdminLogin 方法
  - 新增 loginWithCredentials 方法

#### 测试文件
- ✅ `2-data-isolation/data-isolation.test.js` - 更新登录调用
  - 使用 `AITestUtils.login()` 获取默认账号token
  - 使用 `AITestUtils.loginWithCredentials()` 登录其他账号

#### 文档文件
- ✅ `CONFIG.md` - 更新配置说明
  - 添加系统架构说明
  - 添加如何找到AI接口地址的方法
  - 更新租户ID处理说明

- ✅ `QUICKSTART.md` - 更新快速开始指南
  - 添加系统说明
  - 添加如何找到AI接口地址的步骤

- ✅ `SUMMARY.md` - 更新项目总结
  - 添加系统架构说明
  - 更新配置要点
  - 更新注意事项

## 配置检查清单

使用前请确认以下配置：

### ✅ 必须配置
1. **AI接口地址** (`common/aiTestUtils.js` 第23行)
   ```javascript
   const api = '/api/ai/chat';  // 改为实际接口
   ```
   
   **如何找到：**
   - 登录系统 → F12 → 点击AI按钮 → 发送消息 → 查看Network

2. **账号配置** (`k6/config/envconfig.js`)
   ```javascript
   ADMIN_USERNAME: "carey3004",
   ADMIN_PASSWORD: "qwer1234",
   TENANTID: 3004
   ```

### ⚠️ 可选配置
1. **第二个租户账号**（用于跨租户测试）
   - 在 `2-data-isolation/data-isolation.test.js` 第37行
   - 修改 carey3002 的账号密码

2. **限制权限账号**（用于权限隔离测试）
   - 在 `envconfig.js` 中配置
   - LimitedPermissions 和 LimitedPermissionsPassWord

## 使用说明

### 1. 修改AI接口地址
```bash
vim k6/tests/aitest/common/aiTestUtils.js
# 修改第23行的 api 变量
```

### 2. 运行测试
```bash
# 运行所有测试
./k6/tests/aitest/run-all.sh

# 或单独运行某个类别
./k6/tests/aitest/run-api-security.sh
```

### 3. 查看结果
- 控制台会显示实时结果
- HTML报告保存在 `reports/` 目录

## 常见问题

### Q1: 测试一直失败，提示登录失败
**A:** 检查 `envconfig.js` 中的账号密码是否正确

### Q2: AI接口返回404
**A:** 需要修改 `aiTestUtils.js` 中的 api 变量为实际接口地址

### Q3: 跨租户测试无法执行
**A:** 需要配置第二个租户的账号（carey3002）

### Q4: 提示 sendRequest is not defined
**A:** 确保导入了 `import { sendRequest } from '../../api/common/request.js';`

## 技术说明

### 为什么使用 sendRequest 而不是 httpClient？

**原因：**
1. **统一性** - 项目其他测试都使用 sendRequest
2. **自动化** - 自动处理签名、时间戳等字段
3. **维护性** - 如果签名算法变化，只需修改一处
4. **一致性** - 与现有测试保持一致的请求格式

### 为什么使用 AdminLogin 而不是自己实现？

**原因：**
1. **可靠性** - 使用已验证的登录方法
2. **维护性** - 登录逻辑变化时不需要修改测试代码
3. **一致性** - 与项目其他测试保持一致

## 后续工作

### 短期
1. 根据实际接口修改 api 变量
2. 运行测试验证配置正确
3. 根据测试结果修复安全问题

### 中期
1. 补充更多测试用例
2. 集成到CI/CD流程
3. 定期执行安全测试

### 长期
1. 建立安全测试最佳实践
2. 持续优化测试覆盖率
3. 自动化安全报告生成

## 联系支持

如有问题，请查看：
1. CONFIG.md - 详细配置说明
2. QUICKSTART.md - 快速开始指南
3. EXAMPLES.md - 使用示例
4. 各测试文件中的注释
