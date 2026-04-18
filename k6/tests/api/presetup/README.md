# 批量注册前置脚本

## 整体流程

```
1. 运行 batchRegister.test.js  →  注册账号  →  token 注入 Redis
2. 运行 frontendOnlyRecharge.test.js  →  从 Redis 取 token  →  压测充值
```

---

## 前置条件

确保 Redis 已启动（默认 localhost:6379），或通过环境变量指定：
```bash
-e REDIS_URL=redis://192.168.1.100:6379
```

---

## 步骤一：生成 Token 池

### 场景A：普通注册（租户不需要邀请码）
```bash
k6 run -e TENANT_ID=3001 -e COUNT=100 batchRegister.test.js
```

### 场景A：第一次报"邀请码不能为空"后，带邀请码重跑
```bash
k6 run -e TENANT_ID=3001 -e COUNT=100 -e INVITE_CODE=L746TDN batchRegister.test.js
```
> 幂等性保证：重跑时自动读取 Redis 已有数量，只补足差额，不重复注册

### 场景B：多层级邀请注册（100人，5层）
```bash
k6 run -e TENANT_ID=3001 -e COUNT=100 -e INVITE_CODE=L746TDN -e LEVELS=5 batchRegister.test.js
```

---

## 步骤二：执行压测

### 5套预设方案

| 方案 | 命令参数 | 适用场景 |
|------|----------|----------|
| 冒烟测试 | `-e SCENARIO=smoke` | 验证脚本无误，1VU跑一次 |
| 基准测试 | `-e SCENARIO=baseline` | 摸清正常负载基线，10VU×5min |
| 负载测试 | `-e SCENARIO=load` | 模拟业务高峰，阶梯爬坡到100VU |
| 压力测试 | `-e SCENARIO=stress` | 找系统极限，加压到500VU |
| 尖刺测试 | `-e SCENARIO=spike` | 模拟活动开始瞬间，30s内500VU |

```bash
# 示例：负载测试
k6 run -e TENANT_ID=3001 -e SCENARIO=load frontendOnlyRecharge.test.js

# 多租户并行压测
k6 run -e TENANTS=3001,3002,3003 -e SCENARIO=load frontendOnlyRecharge.test.js
```

---

## Redis Token 池管理

### 查看池状态
```bash
redis-cli LLEN token_pool:3001
redis-cli LRANGE token_pool:3001 0 4
```

### 清理 Token 池（测试完毕后执行）

**方式一：k6 脚本（推荐，无额外依赖）**
```bash
# 清空单个租户
k6 run -e TENANT_ID=3001 clearTokenPool.test.js

# 清空多个租户
k6 run -e TENANTS=3001,3002,3003 clearTokenPool.test.js

# 清空所有已知租户（3001~3007）
k6 run -e TENANTS=all clearTokenPool.test.js
```

**方式二：Node.js 脚本（适合 CI/CD 流水线）**
```bash
# 安装依赖（只需一次）
npm install ioredis

# 清空单个租户
node clearTokenPool.js --tenant=3001

# 清空多个租户
node clearTokenPool.js --tenants=3001,3002,3003

# 清空所有租户
node clearTokenPool.js --tenants=all

# 预览模式（不实际删除，先看看有多少）
node clearTokenPool.js --tenants=all --dry-run

# 指定 Redis 地址
node clearTokenPool.js --redis=redis://192.168.1.100:6379 --tenants=all
```

---

## 自定义业务指标（Grafana 面板）

| 指标名 | 类型 | 说明 |
|--------|------|------|
| `recharge_success_total` | Counter | 充值成功总次数 |
| `recharge_fail_total` | Counter | 充值失败总次数 |
| `recharge_success_rate` | Rate | 充值成功率（阈值 >80%）|
| `recharge_duration_ms` | Trend | 充值全流程耗时 |
| `token_expired_total` | Counter | 过期 token 跳过次数 |
