# AI安全测试 - 配置说明

## 系统架构说明

**重要：** AI是嵌入在系统中的功能，不是独立的服务。

### AI使用流程
1. 用户先登录系统（使用 AdminLogin）
2. 登录成功后获得token
3. 点击AI按钮打开AI对话框
4. 通过AI接口发送消息（携带登录token）
5. 租户之间通过租户ID区分（从token中解析）

### 登录说明
- 登录逻辑在 `k6/tests/api/login/adminlogin.test.js`
- 测试脚本会自动调用 `AdminLogin()` 方法获取token
- token中包含租户ID信息，无需手动传递

## 重要配置项

### 1. AI接口地址配置

AI接口地址需要在 `k6/tests/aitest/common/aiTestUtils.js` 文件中修改。

**当前配置:**
```javascript
const api = '/api/ai/chat';  // 第23行，这是假设的地址
```

**修改方法:**
请修改为实际的AI接口地址，例如：
```javascript
const api = '/api/ai/chat';           // AI对话接口
const api = '/api/assistant/message'; // 助手消息接口
const api = '/api/ai/conversation';   // AI会话接口
```

**如何找到实际接口地址：**
1. 登录系统后台
2. 打开浏览器开发者工具（F12）
3. 点击AI按钮，打开AI对话框
4. 在Network标签中发送一条消息
5. 查看请求的URL，那就是AI接口地址

### 2. 租户和用户配置

租户和用户配置在 `k6/config/envconfig.js` 文件中。

**当前配置 (租户3004):**
```javascript
export const ENV_CONFIG = {
    BASE_ADMIN_URL: "https://arsitasdfghjklusa.com",
    BASE_DESK_URL: "https://arplatsaassit4.club.club",
    TENANTID: 3004,                          // 当前租户ID
    ADMIN_USERNAME: "carey3004",             // 系统管理员账号
    ADMIN_PASSWORD: "qwer1234",
    LimitedPermissions: "carey3004_001",     // 限制权限账号
    LimitedPermissionsPassWord: "qwer1234"
};
```

**租户说明：**
- 租户之间通过租户ID区分
- 登录时会自动获取租户信息（包含在token中）
- 测试脚本会自动使用配置的租户账号
- 无需在AI请求中手动传递租户ID

### 3. 多租户测试配置

如果需要测试跨租户数据隔离，需要配置第二个租户的账号。

**方式1：在envconfig.js中添加租户3002配置**
```javascript
// 取消注释租户3002的配置
export const ENV_CONFIG = {
    BASE_ADMIN_URL: 'https://arsitasdfghjklg.com',
    BASE_DESK_URL: 'https://arplatsaassit2.club',
    TENANTID: 3002,
    ADMIN_USERNAME: 'carey3002',
    ADMIN_PASSWORD: 'qwer1234'
};
```

**方式2：在测试文件中直接配置**
在 `k6/tests/aitest/2-data-isolation/data-isolation.test.js` 中修改：
```javascript
// 第37行附近
const tenant3002Token = AITestUtils.loginWithCredentials(
    'carey3002',  // 租户3002的管理员账号
    'qwer1234'    // 密码
);
```

## AI接口请求格式

### 当前使用的请求方式

测试脚本使用项目现有的 `sendRequest` 方法，会自动处理：
- ✅ 签名 (signature)
- ✅ 时间戳 (timestamp)
- ✅ 随机数 (random)
- ✅ 语言 (language)
- ✅ Token认证

### 基本请求格式

```javascript
{
    message: "用户输入的消息",
    sessionId: "会话ID",
    // sendRequest会自动添加以下字段：
    // random: "随机数",
    // language: "语言",
    // signature: "签名",
    // timestamp: "时间戳"
}
```

### 如果你的AI接口格式不同

请修改 `k6/tests/aitest/common/aiTestUtils.js` 中的 `sendAIRequest` 方法（第23-45行）：

```javascript
static sendAIRequest(message, token, options = {}) {
    const api = '/api/ai/chat';  // 修改接口地址
    
    // 根据实际接口修改请求体结构
    const payload = {
        content: message,      // 有些接口用 content 而不是 message
        conversationId: options.sessionId,  // 有些接口用 conversationId
        // 添加其他必需字段
    };
    
    // 使用sendRequest会自动处理签名等
    const result = sendRequest(payload, api, 'ai_test', false, token);
    return this.parseResponse(result);
}
```

## 响应格式

### 当前假设的响应格式

项目使用统一的响应格式：
```javascript
{
    msgCode: 0,        // 业务状态码，0表示成功
    msg: "Succeed",    // 消息
    data: {            // 数据
        // AI返回的内容
        reply: "AI的回复",
        // 其他字段...
    }
}
```

### 响应解析

`sendRequest` 方法会自动解析响应，返回格式为：
```javascript
{
    msgCode: 0,
    msg: "Succeed",
    data: { ... }
}
```

测试脚本会检查 `msgCode === 0` 来判断请求是否成功。

### 如果你的响应格式不同

请修改 `k6/tests/aitest/common/aiTestUtils.js` 中的 `parseResponse` 方法（第50-70行）。

## 测试环境切换

如果需要切换测试环境，修改 `k6/config/envconfig.js`：

```javascript
// 开发环境
export const ENV_CONFIG = {
    BASE_ADMIN_URL: "https://dev.example.com",
    // ...
};

// 测试环境
export const ENV_CONFIG = {
    BASE_ADMIN_URL: "https://test.example.com",
    // ...
};

// 生产环境（谨慎使用）
export const ENV_CONFIG = {
    BASE_ADMIN_URL: "https://prod.example.com",
    // ...
};
```

## 常见问题

### Q1: 测试一直失败，提示401/403错误
A: 检查以下几点：
1. 用户名密码是否正确
2. 登录接口地址是否正确
3. Token是否正确传递

### Q2: AI接口返回404
A: 检查 `aiTestUtils.js` 中的 `api` 变量是否配置正确

### Q3: 跨租户测试无法执行
A: 确保配置了第二个租户的账号信息

### Q4: 测试报告在哪里
A: 测试报告保存在项目根目录的 `reports/` 文件夹中

## 调试技巧

### 1. 查看详细日志
测试执行时会输出详细的日志信息，包括：
- 请求的URL
- 请求的参数
- 响应的状态码
- 响应的内容

### 2. 单独测试某个用例
可以注释掉其他测试用例，只运行需要调试的用例。

### 3. 修改测试数据
在各个测试文件中，可以修改测试数据以适应实际情况。

## 联系支持

如有问题，请查看：
1. README.md - 基本使用说明
2. 各测试文件中的注释
3. k6官方文档: https://k6.io/docs/
