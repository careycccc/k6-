# 账号/邮箱生成改造：引入 xk6-faker（真实感 + 跨年不重复）

> 分支：`feature/viz-integration-v2`
> 核心文件：`k6/tests/utils/accountGenerator.js`、`k6/tests/utils/accountGeneratorFaker.js`

## 一、为什么改

旧手机号由 `accountGenerator.js` 的 `generateRandomPhone` 生成，格式是
`区号 + 月日(4位) + 6位随机`。**年份没进号码**，导致明年同月同日 + 随机段一撞就重复；
6 位随机空间也小，高并发当天就可能撞。

目标：邮箱用 [grafana/xk6-faker](https://github.com/grafana/xk6-faker) 生成真实感前缀，
手机号/邮箱熵源换成含时间戳的构造，让账号**未来几年不重复**。

## 二、改了什么

1. **`accountGenerator.js`（纯 JS 基线，k6/Node 通用）**
   - 新增模块级自增序列 `_seq`。
   - `generateRandomPhone`：号码部分改为 **epoch 秒低 4 位 + 序列 2 位 + 随机**，保持总长 12/13 位，
     首位非 0；随 epoch 单调滚动，**不再跨年系统性重复**。
   - `generateRandomEmail`：前缀 = 随机词 + `base36(Date.now())+base36(_seq++)+base36(随机)` → 实际唯一。

2. **`accountGeneratorFaker.js`（新增，k6 专用）**
   - `import faker from 'k6/x/faker'`，导出与 `accountGenerator.js` 同名接口。
   - 邮箱用 `faker.internet.username()`（兜底 `faker.person.firstName()`）+ 唯一后缀 + 域名，防御式兜底。
   - 手机号/密码 re-export 纯 JS 版（手机号需纯数字定长过后端校验，faker 不适用）。

3. **34 个 k6 脚本切 import**：`.../accountGenerator.js` → `.../accountGeneratorFaker.js`
   （同目录同名导出，调用代码零改动）。

4. **`addWalletApi.js`**：删除私有 `generateRandomEmail`，改 import faker 版。

## 三、⚠️ 本地必做步骤（否则涉及账号的 k6 脚本会报 `module not found: k6/x/faker`）

```bash
# 1. 确认 Go ≥ 1.20（项目 qwen2/ 有 go.mod，可能已装）
go version

# 2. 安装 xk6，确保 %GOPATH%\bin 在 PATH
go install go.k6.io/xk6/cmd/xk6@latest

# 3. 项目根编译带 faker 的 k6（Windows 产出 k6.exe）
xk6 build --with github.com/grafana/xk6-faker@latest

# 4. 用新 k6.exe 覆盖 / 前置于现有 k6
k6 version    # 应显示 xk6 扩展信息

# 5. 冒烟（邮箱应为真实感前缀 + 唯一后缀，注册 code=0）
k6 run -e TENANT=3004 -e TYPE=email -e COUNT=3 scripts/register-account-k6.js
```

- `runner.js` 调用写死 `k6` 命令 → 只要 PATH 指向新二进制即可，无需改。
- 不要设 `XK6_FAKER_SEED`（唯一性由时间戳后缀保证，固定 seed 无必要）。

## 四、验证记录

纯 JS 基线已在 Node 验证：手机号 91→12/880→13/52→12 位、纯数字、首位非 0、格式错误 0；
邮箱连生 20000 个零碰撞。faker 版需 build 完 k6 后按「步骤 5」冒烟。

## 五、说明

- 手机号 10 位十进制空间有限，做到「碰撞率可忽略」而非绝对唯一；但**跨年必重复 bug 已根治**。
- Node 侧脚本（`collect-users.js`、`runner.js`）用不了 `k6/x/faker`，它们不直接生成账号，不受影响。
