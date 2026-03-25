# 注册接口 Payload 规范文档

## 目录
1. [注册接口 Payload](#注册接口-payload)
2. [发送验证码接口 Payload](#发送验证码接口-payload)

---

## 注册接口 Payload

### API 端点
`POST /api/Home/Register`

### 四种注册方式的 Payload 对比

### 1. 手机邀请注册 (phoneRegisterByInvite)

```json
{
  "userName": "913024199731",
  "inviteCode": "QD4WMKN",
  "loginType": "Mobile",
  "turnstileToken": "",
  "password": "qwer1234",
  "code": "175674",
  "language": "en",
  "random": 463462571939,
  "signature": "",
  "timestamp": 1774354524
}
```

**字段说明：**
- `userName`: 手机号
- `inviteCode`: 邀请码（必填）
- `loginType`: "Mobile"
- `turnstileToken`: 空字符串（必须有）
- `password`: 密码
- `code`: 验证码
- `language`: 语言
- `random`: 随机数
- `signature`: 空字符串（必须预先包含，httpClient会自动填充正确签名）
- `timestamp`: 时间戳

**特点：**
- 有 `turnstileToken` 字段
- 有 `signature: ""` 字段（初始为空字符串）
- 没有 `captchaId`, `deviceId`, `browserId`, `packageName`

---

### 2. 邮箱邀请注册 (emailRegisterByInvite)

```json
{
  "userName": "44535@qq.com",
  "inviteCode": "QD4WMKN",
  "loginType": "Email",
  "turnstileToken": "",
  "password": "qwer1234",
  "code": "685444",
  "language": "en",
  "random": 217690177522,
  "signature": "",
  "timestamp": 1774355930
}
```

**字段说明：**
- `userName`: 邮箱地址
- `inviteCode`: 邀请码（必填）
- `loginType`: "Email"
- 其他字段同手机邀请注册

**特点：**
- 结构与手机邀请注册完全一致
- 只是 `loginType` 和 `userName` 类型不同

---

### 3. 手机前台注册 (phoneRegister)

```json
{
  "loginType": "Mobile",
  "userName": "913024199720",
  "password": "qwer1234",
  "inviteCode": "",
  "code": "382332",
  "captchaId": null,
  "deviceId": "",
  "browserId": "b112fc9264007eb8d433bd23b4b3bd46",
  "packageName": "",
  "language": "en",
  "random": 451671375259,
  "signature": "",
  "timestamp": 1774355990
}
```

**字段说明：**
- `loginType`: "Mobile"
- `userName`: 手机号
- `password`: 密码
- `inviteCode`: 空字符串（可选）
- `code`: 验证码
- `captchaId`: null
- `deviceId`: 空字符串
- `browserId`: 浏览器ID（32位随机字符串）
- `packageName`: 空字符串
- `language`: 语言
- `random`: 随机数
- `signature`: 签名（自动生成）
- `timestamp`: 时间戳

**特点：**
- 有 `captchaId`, `deviceId`, `browserId`, `packageName` 字段
- 没有 `turnstileToken` 字段
- `inviteCode` 为空字符串

---

### 4. 邮箱前台注册 (emailRegister)

```json
{
  "loginType": "Email",
  "userName": "yuiuiyiy@qq.com",
  "password": "1234qwer",
  "inviteCode": "",
  "code": "488617",
  "captchaId": null,
  "deviceId": "",
  "browserId": "b112fc9264007eb8d433bd23b4b3bd46",
  "packageName": "",
  "language": "en",
  "random": 542383833761,
  "signature": "",
  "timestamp": 1774356053
}
```

**字段说明：**
- `loginType`: "Email"
- `userName`: 邮箱地址
- 其他字段同手机前台注册

**特点：**
- 结构与手机前台注册完全一致
- 只是 `loginType` 和 `userName` 类型不同

---

## 关键差异总结

### 邀请注册 vs 前台注册

| 字段 | 邀请注册 | 前台注册 |
|------|---------|---------|
| `turnstileToken` | ✅ 有（空字符串） | ❌ 无 |
| `captchaId` | ❌ 无 | ✅ 有（null） |
| `deviceId` | ❌ 无 | ✅ 有（空字符串） |
| `browserId` | ❌ 无 | ✅ 有（32位随机字符串） |
| `packageName` | ❌ 无 | ✅ 有（空字符串） |
| `inviteCode` | 必填（有值） | 可选（空字符串） |

### 手机 vs 邮箱

| 字段 | 手机注册 | 邮箱注册 |
|------|---------|---------|
| `loginType` | "Mobile" | "Email" |
| `userName` | 手机号 | 邮箱地址 |

---

## 重要提示

1. **签名字段**：
   - 所有注册方式都需要 `signature` 字段
   - payload 中必须预先包含 `signature: ""`（空字符串）
   - `httpClient` 会自动将空签名替换为正确的签名值
   
2. **字段顺序**：邀请注册的字段顺序与前台注册不同，但不影响功能

3. **不要混用字段**：
   - 邀请注册：必须有 `turnstileToken`，不要加 `captchaId`, `deviceId`, `browserId`, `packageName`
   - 前台注册：必须有 `captchaId`, `deviceId`, `browserId`, `packageName`，不要加 `turnstileToken`
   
4. **验证码类型**：
   - 手机邀请注册：`verifyCodeType=1, codeType=19`
   - 邮箱邀请注册：`verifyCodeType=2, codeType=20`
   - 手机前台注册：`verifyCodeType=1, codeType=1`
   - 邮箱前台注册：`verifyCodeType=2, codeType=2`

---

## 代码实现对应

- `phoneRegisterByInvite()` → 手机邀请注册
- `emailRegisterByInvite()` → 邮箱邀请注册
- `phoneRegister()` → 手机前台注册
- `emailRegister()` → 邮箱前台注册

**文档创建时间：** 2026-03-24  
**最后更新：** 2026-03-24

---

## 发送验证码接口 Payload

### API 端点
`POST /api/Home/SendVerifiyCode`

### 四种注册方式的发送验证码 Payload

#### 1. 手机邀请注册 - 发送验证码

```json
{
  "verifyCodeType": 1,
  "phoneOrEmail": "913025199711",
  "codeType": 19,
  "language": "en",
  "random": 716623680958,
  "signature": "E0EE093F54C64615E5AF5C7298FEFC5E",
  "timestamp": 1774408678
}
```

**字段说明：**
- `verifyCodeType`: 1 (手机号)
- `phoneOrEmail`: 手机号
- `codeType`: 19 (邀请注册验证码)
- `language`: 语言
- `random`: 随机数
- `signature`: 签名（自动生成）
- `timestamp`: 时间戳

---

#### 2. 邮箱邀请注册 - 发送验证码

```json
{
  "verifyCodeType": 2,
  "phoneOrEmail": "qwee@qq.com",
  "codeType": 20,
  "language": "en",
  "random": 573736381023,
  "signature": "A14B7EABAF88D53A4B32D2C0A5D50A35",
  "timestamp": 1774408747
}
```

**字段说明：**
- `verifyCodeType`: 2 (邮箱)
- `phoneOrEmail`: 邮箱地址
- `codeType`: 20 (邮箱邀请注册验证码)
- 其他字段同手机邀请注册

---

#### 3. 手机前台注册 - 发送验证码

```json
{
  "verifyCodeType": 1,
  "phoneOrEmail": "913025199711",
  "codeType": 1,
  "language": "en",
  "random": 663201069551,
  "signature": "6EF8094924FC9B595A9B8449BBECDB3C",
  "timestamp": 1774408803
}
```

**字段说明：**
- `verifyCodeType`: 1 (手机号)
- `phoneOrEmail`: 手机号
- `codeType`: 1 (手机前台注册验证码)
- 其他字段同上

---

#### 4. 邮箱前台注册 - 发送验证码

```json
{
  "verifyCodeType": 2,
  "phoneOrEmail": "ewwee@qq.com",
  "codeType": 2,
  "language": "en",
  "random": 551093384060,
  "signature": "2B4EFFAAA2EF5C73EBBE78FB3A9C049C",
  "timestamp": 1774408865
}
```

**字段说明：**
- `verifyCodeType`: 2 (邮箱)
- `phoneOrEmail`: 邮箱地址
- `codeType`: 2 (邮箱前台注册验证码)
- 其他字段同上

---

### 验证码类型 (codeType) 对照表

| 注册方式 | verifyCodeType | codeType | 说明 |
|---------|---------------|----------|------|
| 手机邀请注册 | 1 | 19 | 推广页手机注册 |
| 邮箱邀请注册 | 2 | 20 | 推广页邮箱注册 |
| 手机前台注册 | 1 | 1 | 手机前台注册 |
| 邮箱前台注册 | 2 | 2 | 邮箱前台注册 |

### verifyCodeType 说明

- `1`: 手机号验证
- `2`: 邮箱验证

---

## 完整流程总结

### 邀请注册流程
1. 调用 `/api/Home/SendVerifiyCode` 发送验证码 (codeType=19/20)
2. 等待2秒
3. 查询验证码 `/api/Users/GetVerifyCodePageList`
4. 调用 `/api/Home/Register` 注册 (payload包含turnstileToken)

### 前台注册流程
1. 调用 `/api/Home/SendVerifiyCode` 发送验证码 (codeType=1/2)
2. 等待2秒
3. 查询验证码 `/api/Users/GetVerifyCodePageList`
4. 调用 `/api/Home/Register` 注册 (payload包含captchaId等字段)
