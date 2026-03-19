# K6 性能测试框架 - 可视化测试平台

专为复杂业务系统设计的 K6 性能测试框架，集成自动签名、Token 管理、批量操作、实时监控和可视化报告。

![Platform](https://img.shields.io/badge/Platform-Docker-blue)
![K6](https://img.shields.io/badge/K6-v1.5.0-green)
![Grafana](https://img.shields.io/badge/Grafana-10.2.0-orange)
![Node.js](https://img.shields.io/badge/Node.js-14+-brightgreen)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## 🔥 快速链接

**最新更新 (2026-02-22)**:

- 📖 [当前状态和使用指南](README_CURRENT_STATE.md) - 完整的功能状态和推荐工作流
- 🚀 [Grafana 快速修复](GRAFANA_QUICK_FIX.md) - Grafana 问题快速解决方案
- 📝 [viz-backend 日志说明](VIZ_BACKEND_LOGS_EXPLANATION.md) - 实时日志功能说明
- 📊 [完整状态文档](CURRENT_STATUS.md) - 详细的功能说明和故障排查

**重要提示**:
- ✅ Grafana 网络吞吐量负数问题已修复
- ✅ 报表查询成功率面板已修复
- ⚠️ viz-backend 实时日志功能有限（推荐使用命令行查看详细日志）
- 💡 推荐工作流：命令行运行测试 + Grafana 查看结果

---

## 📋 目录

- [功能特性](#-功能特性)
- [系统架构](#-系统架构)
- [快速开始](#-快速开始)
- [核心能力](#-核心能力)
- [项目结构](#-项目结构)
- [测试场景](#-测试场景)
- [配置说明](#-配置说明)
- [使用指南](#-使用指南)
- [开发指南](#-开发指南)
- [故障排除](#-故障排除)

---

## ✨ 功能特性

### 核心功能
| 功能 | 描述 |
|------|------|
| 🔐 **企业级认证** | OAuth2 + Token 自动管理与刷新机制 |
| ✍️ **自动签名** | 内置请求签名系统，支持多种签名算法 |
| 🔄 **批量操作** | 批量测试基类，支持大规模并发测试 |
| 📊 **实时监控** | Grafana + InfluxDB 实时性能数据可视化 |
| 📝 **脚本管理** | Web 界面在线管理测试脚本 |
| 📈 **多维指标** | 响应时间（P90/P95/P99）、吞吐量、错误率、VU 数 |
| 📄 **自动报告** | 测试完成自动生成 HTML 报告 |
| 🎯 **场景丰富** | 冒烟、负载、压力、耐力、容量等多种测试场景 |
| 🐳 **容器化部署** | Docker Compose 一键启动全套服务 |
| ✅ **数据验证** | 集成 Zod 进行响应数据校验 |

### 测试覆盖
- **活动模块**：优惠券、签到、礼包、红包雨、大奖赛、邀请转盘等 20+ 活动接口
- **报表模块**：日报、会员报表、统计数据、账户变动、手动充值等
- **登录模块**：前台登录、后台登录、移动端自动登录

---

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    K6 可视化测试平台架构                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐      ┌──────────┐      ┌──────────┐          │
│  │  Viz     │─────▶│  K6      │─────▶│ InfluxDB │          │
│  │ Platform │      │ Runner   │      │  :8086   │          │
│  │  :8080   │      │          │      │          │          │
│  └──────────┘      └──────────┘      └────┬─────┘          │
│       │                                    │                │
│       │                              ┌─────▼─────┐          │
│       │                              │  Grafana  │          │
│       │                              │  :3000    │          │
│       │                              │ Dashboard │          │
│       │                              └───────────┘          │
│       │                                                     │
│  ┌────▼─────┐                                              │
│  │  HTML    │                                              │
│  │  Report  │                                              │
│  └──────────┘                                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 组件说明

| 组件 | 端口 | 说明 | 技术栈 |
|------|------|------|--------|
| **Viz Platform** | 8080 | Web 管理界面（脚本管理、测试执行、报告查看） | Node.js + Express |
| **Grafana** | 3000 | 实时监控仪表板（预配置 K6 Dashboard） | Grafana 10.2.0 |
| **InfluxDB** | 8086 | 时序数据存储（K6 测试指标） | InfluxDB 1.8 |
| **K6 Runner** | - | 性能测试执行器（支持自动签名、Token 管理） | K6 v1.5.0 |

---

## 🚀 快速开始

### 前置要求

- Docker & Docker Compose（推荐）
- Node.js 14+ 和 npm 6+（本地开发）
- K6（本地运行测试脚本）

### 方式一：Docker 部署（推荐）

```bash
# 1. 克隆项目
git clone <your-repo-url>
cd k6-performance-framework

# 2. 启动所有服务（InfluxDB + Grafana + Viz Platform）
docker-compose up -d

# 3. 等待服务启动（约 30 秒）
docker-compose ps

# 4. 访问服务
open http://localhost:8080    # Viz 平台
open http://localhost:3000    # Grafana 监控（admin/admin123）
```

### 方式二：本地开发

```bash
# 1. 安装项目依赖
npm install

# 2. 配置环境变量（可选）
cp k6/config/envconfig.js k6/config/envconfig.local.js
# 编辑 envconfig.local.js 配置你的测试环境

# 3. 运行单个测试脚本
k6 run index.js

# 4. 运行测试并输出到 InfluxDB
k6 run --out influxdb=http://localhost:8086/k6 index.js

# 5. 启动 Viz 平台（可选）
npm run viz:setup
```

### 快速测试

```bash
# 冒烟测试
npm run test:smoke

# API 测试
npm run test:api

# 负载测试
npm run test:load
```

---

## 🎯 核心能力

### 1. 自动签名系统

框架内置请求签名机制，自动为每个请求添加签名：

```javascript
import { HttpClient } from './k6/libs/http/client.js';

const client = new HttpClient({
  autoSign: true,  // 自动签名
  signOptions: {
    algorithm: 'sha256',
    secretKey: 'your-secret'
  }
});

// 请求会自动添加签名
const response = client.post('/api/activity/coupon', { amount: 100 });
```

### 2. Token 管理

自动管理 Token 生命周期，支持刷新和缓存：

```javascript
import { tokenManager } from './k6/libs/auth/tokenManager.js';

// 获取 Token（自动缓存和刷新）
const token = await tokenManager.getToken({
  username: 'user',
  password: 'pass'
});

// 批量获取多用户 Token
const tokens = await tokenManager.getTokensBatch([
  { username: 'user1', password: 'pass1' },
  { username: 'user2', password: 'pass2' }
]);
```

### 3. 批量操作

使用批量操作基类进行大规模并发测试：

```javascript
import { BatchOperationBase } from './k6/libs/batch/BatchOperationBase.js';

class CouponBatchTest extends BatchOperationBase {
  execute(item) {
    return client.post('/api/coupon/add', item);
  }
}

const batch = new CouponBatchTest({ batchSize: 100 });
batch.run(testData);
```

### 4. 数据验证

使用 Zod 进行响应数据校验：

```javascript
import { z } from 'zod';

const responseSchema = z.object({
  msgCode: z.literal(0),
  msg: z.literal('Succeed'),
  data: z.object({
    token: z.string(),
    userId: z.number()
  })
});

// 自动验证响应
const validated = responseSchema.parse(response.json());
```

---

## 📁 项目结构

```
k6-performance-framework/
├── docker-compose.yml              # Docker 编排配置
├── index.js                        # 测试入口文件
├── package.json                    # 项目依赖和脚本
├── README.md                       # 项目文档
│
├── viz/                            # 可视化平台
│   ├── backend/                    # 后端服务（Express API）
│   │   ├── server.js               # API 服务器
│   │   ├── Dockerfile              # Docker 镜像
│   │   └── package.json            # 后端依赖
│   ├── frontend/                   # 前端界面
│   │   └── index.html              # Web 管理界面
│   ├── reports/                    # 测试报告输出目录
│   └── data/                       # 测试数据存储
│
├── grafana/                        # Grafana 配置
│   └── provisioning/
│       ├── dashboards/             # 仪表板配置
│       │   ├── dashboard.yml       # Dashboard 配置
│       │   └── k6-dashboard.json   # K6 监控面板
│       └── datasources/            # 数据源配置
│           └── influxdb.yml        # InfluxDB 连接配置
│
├── k6/                             # K6 测试框架核心
│   ├── config/                     # 配置文件
│   │   ├── envconfig.js            # 环境配置（URL、账号等）
│   │   ├── scenarios.js            # 测试场景配置
│   │   ├── thresholds.js           # 性能阈值配置
│   │   ├── signature.js            # 签名配置
│   │   ├── load.js                 # 配置加载器
│   │   └── zodSchemas.js           # Zod 数据验证模式
│   │
│   ├── libs/                       # 核心库
│   │   ├── auth/                   # 认证模块
│   │   │   ├── oauth2.js           # OAuth2 实现
│   │   │   └── tokenManager.js     # Token 管理器
│   │   ├── batch/                  # 批量操作
│   │   │   ├── BatchOperationBase.js  # 批量操作基类
│   │   │   └── README.md           # 批量操作文档
│   │   ├── checks/                 # 检查工具
│   │   │   └── apiChecks.js        # API 响应检查
│   │   ├── http/                   # HTTP 客户端
│   │   │   └── client.js           # 自定义 HTTP 客户端
│   │   ├── utils/                  # 工具库
│   │   │   ├── logger.js           # 日志工具
│   │   │   ├── performance.js      # 性能工具
│   │   │   ├── signature.js        # 签名工具
│   │   │   └── signature2.js       # 签名工具 v2
│   │   └── zodValidator.js         # Zod 验证器
│   │
│   └── tests/                      # 测试用例
│       └── api/                    # API 测试
│           ├── common/             # 公共模块
│           │   ├── common.js       # 公共函数
│           │   ├── request.js      # 请求封装
│           │   └── type.js         # 类型定义
│           │
│           ├── activity/           # 活动模块测试（20+ 活动类型）
│           │   ├── coupon/         # 优惠券
│           │   ├── signin/         # 签到
│           │   ├── giftPack/       # 礼包
│           │   ├── redRainActivity/  # 红包雨
│           │   ├── champion/       # 大奖赛
│           │   ├── inviteTurntable/  # 邀请转盘
│           │   ├── dailyTasks/     # 每日任务
│           │   ├── ranking/        # 排行榜
│           │   └── ...             # 更多活动
│           │
│           ├── formdata/           # 报表模块测试
│           │   ├── Dashboard/      # 仪表板
│           │   ├── MemberReport/   # 会员报表
│           │   ├── Statistics/     # 统计数据
│           │   ├── accountChanges/ # 账户变动
│           │   └── ...             # 更多报表
│           │
│           ├── login/              # 登录模块测试
│           │   ├── desklogin.test.js      # 前台登录
│           │   ├── adminlogin.test.js     # 后台登录
│           │   └── MobileAutoLogin.test.js  # 移动端登录
│           │
│           ├── message/            # 消息模块测试
│           └── script/             # 批量测试脚本
│               ├── README_BATCH_ACTIVITIES.md  # 批量活动测试文档
│               └── README_BATCH_REPORTS.md     # 批量报表测试文档
│
└── docker/                         # Docker 配置（备用）
    ├── Dockerfile
    └── docker-compose.yml
```

---

## 🎭 测试场景

框架提供多种预配置测试场景，可根据需求选择：

### 1. 冒烟测试（Smoke Test）
快速验证系统基本功能是否正常。

```javascript
import { getScenario } from './k6/config/scenarios.js';

export const options = {
  scenarios: {
    smoke: getScenario('smoke')
  }
};
// 配置：1 VU，10 次迭代，最长 5 分钟
```

### 2. 负载测试（Load Test）

#### 正常负载
```javascript
export const options = {
  scenarios: {
    normal_load: getScenario('load.normal')
  }
};
// 配置：1→10→50→10 VU，持续 3 分钟
```

#### 高负载
```javascript
export const options = {
  scenarios: {
    high_load: getScenario('load.high')
  }
};
// 配置：5→100→300→100→10 VU，持续 5.5 分钟
```

### 3. 压力测试（Stress Test）

#### 尖峰测试
```javascript
export const options = {
  scenarios: {
    spike: getScenario('stress.spike')
  }
};
// 配置：快速上升到 500 VU，模拟流量突增
```

#### 浸泡测试
```javascript
export const options = {
  scenarios: {
    soak: getScenario('stress.soak')
  }
};
// 配置：50 VU 持续 30 分钟，检测内存泄漏
```

### 4. 耐力测试（Endurance Test）
```javascript
export const options = {
  scenarios: {
    endurance: getScenario('endurance.long')
  }
};
// 配置：10 VU 持续 8 小时
```

### 5. 容量测试（Capacity Test）
```javascript
export const options = {
  scenarios: {
    capacity: getScenario('capacity.find_limits')
  }
};
// 配置：逐步增加负载，找到系统极限
```

### 自定义场景

```javascript
import { getScenario, adaptScenarioForEnvironment } from './k6/config/scenarios.js';

// 根据环境自动调整负载
const scenario = adaptScenarioForEnvironment(
  getScenario('load.high'),
  'staging'  // local: 10%, dev: 50%, staging: 80%, production: 100%
);

export const options = { scenarios: { custom: scenario } };
```

---

## ⚙️ 配置说明

### 环境配置

编辑 `k6/config/envconfig.js`：

```javascript
export const ENV_CONFIG = {
  BASE_ADMIN_URL: "https://your-admin-url.com",  // 管理后台地址
  BASE_DESK_URL: "https://your-frontend-url.com",  // 前台地址
  PAGESIZE: 200,                                   // 分页大小
  PAGENO: 1,                                       // 页码
  ADMIN_USERNAME: "admin",                         // 管理员账号
  ADMIN_PASSWORD: "password",                      // 管理员密码
  START_TIME: "2026-01-08 00:00:00",              // 查询开始时间
  END_TIME: "2026-01-08 23:59:59"                 // 查询结束时间
};
```

### 性能阈值配置

编辑 `k6/config/thresholds.js` 设置性能指标阈值：

```javascript
export const thresholds = {
  http_req_duration: ['p(95)<500', 'p(99)<1000'],  // 95% 请求 < 500ms
  http_req_failed: ['rate<0.01'],                   // 错误率 < 1%
  http_reqs: ['rate>100']                           // 吞吐量 > 100 RPS
};
```

### Docker Compose 配置

主要服务配置（`docker-compose.yml`）：

```yaml
services:
  influxdb:
    image: influxdb:1.8
    ports: ["8086:8086"]
    environment:
      INFLUXDB_DB: k6
  
  grafana:
    image: grafana/grafana:10.2.0
    ports: ["3000:3000"]
    environment:
      GF_SECURITY_ADMIN_USER: admin
      GF_SECURITY_ADMIN_PASSWORD: admin123
  
  viz-backend:
    build: ./viz/backend
    ports: ["8080:8080"]
    volumes:
      - ./k6:/app/k6
      - ./viz/reports:/app/viz/reports
```

---

## 📖 使用指南

### 通过 Viz 平台运行测试

1. **访问平台**
   ```bash
   open http://localhost:8080
   ```

2. **脚本管理**
   - 查看 `k6/tests/api/` 目录下的所有测试脚本
   - 在线编辑和创建测试脚本

3. **执行测试**
   - 选择测试脚本
   - 配置参数：VU 数、持续时间、环境
   - 点击"开始测试"

4. **查看报告**
   - 测试完成后在 `viz/reports/` 目录查看 HTML 报告
   - 报告包含：性能指标、成功率、响应时间分布

### 通过命令行运行测试

```bash
# 运行单个测试文件
k6 run index.js

# 运行并输出到 InfluxDB
k6 run --out influxdb=http://localhost:8086/k6 index.js

# 使用预定义场景
npm run test:smoke    # 冒烟测试
npm run test:load     # 负载测试
npm run test:stress   # 压力测试

# 自定义 VU 和持续时间
k6 run --vus 10 --duration 30s index.js

# 生成 HTML 报告
k6 run --out json=results.json index.js
npm run report
```

### 查看实时监控（Grafana）

1. **访问 Grafana**
   ```bash
   open http://localhost:3000
   ```
   登录：admin / admin123

2. **查看仪表板**
   - 进入 "K6 Performance Dashboard"
   - 选择测试 ID 筛选特定测试数据

3. **监控指标**
   - 📈 响应时间趋势（P50/P90/P95/P99）
   - 🚀 请求速率（RPS）
   - 👥 虚拟用户数变化
   - ❌ 错误率和失败请求
   - 📊 HTTP 状态码分布

4. **自定义视图**
   - 调整时间范围（默认最近 1 小时）
   - 添加自定义面板
   - 设置告警规则



---

## 🔧 常用命令

```bash
# 启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down

# 清理数据（包括 InfluxDB 和 Grafana 数据）
docker-compose down -v

# 重启特定服务
docker-compose restart viz-backend
```

---

## 🐛 故障排除

### 问题 1：Viz 平台显示 "Cannot GET /"

**解决**：
```bash
# 重启 viz-backend 服务
docker-compose restart viz-backend
```

### 问题 2：Grafana 显示 "NO data"

**解决**：
1. 检查时间范围（右上角选择 "Last 1 hour"）
2. 选择特定测试 ID（顶部下拉框）
3. 确认测试已正常运行并写入数据

### 问题 3：端口被占用

**解决**：
```bash
# 查找并杀掉占用端口的进程
kill -9 $(lsof -ti:8080) 2>/dev/null
kill -9 $(lsof -ti:3000) 2>/dev/null
```

### 问题 4：容器冲突

**解决**：
```bash
# 清理旧容器
docker stop $(docker ps -a | grep k6- | awk '{print $1}') 2>/dev/null
docker rm $(docker ps -a | grep k6- | awk '{print $1}') 2>/dev/null
```

---

## 🛠️ 开发指南

### 编写测试脚本

1. **创建测试文件**
   ```bash
   # 在 k6/tests/api/ 下创建测试文件
   touch k6/tests/api/mytest/mytest.test.js
   ```

2. **使用公共请求函数**
   ```javascript
   import { sendRequest } from '../common/request.js';
   
   export default function() {
     const payload = {
       userId: 123,
       action: 'test'
     };
     
     const response = sendRequest(
       payload,
       '/api/test',      // API 路径
       'my_test',        // 标签
       true,             // isDesk（前台/后台）
       ''                // token（可选）
     );
   }
   ```

3. **使用 HTTP 客户端**
   ```javascript
   import { httpClient } from '../../libs/http/client.js';
   
   export default function() {
     // 自动签名的 POST 请求
     const response = httpClient.post('/api/test', {
       data: 'value'
     }, {
       autoSign: true
     });
     
     // GET 请求
     const getResponse = httpClient.get('/api/query', {
       id: 123
     });
   }
   ```

4. **添加数据验证**
   ```javascript
   import { z } from 'zod';
   
   const schema = z.object({
     msgCode: z.literal(0),
     data: z.object({
       id: z.number(),
       name: z.string()
     })
   });
   
   const validated = schema.parse(response.json());
   ```

### 常用命令

```bash
# 项目管理
npm install                    # 安装依赖
npm run lint                   # 代码检查
npm run format                 # 代码格式化
npm run clean                  # 清理报告和日志

# Docker 管理
npm run docker:up              # 启动所有服务
npm run docker:down            # 停止所有服务
npm run docker:logs            # 查看日志
npm run docker:clean           # 清理数据卷

# Viz 平台
npm run viz:install            # 安装 Viz 依赖
npm run viz:start              # 启动 Viz 平台
npm run viz:dev                # 开发模式启动

# 测试执行
npm run test:smoke             # 冒烟测试
npm run test:api               # API 测试
npm run test:load              # 负载测试
npm run test:stress            # 压力测试
npm run test:endurance         # 耐力测试
npm run test:all               # 运行所有测试

# 安全检查
npm run security:check         # 检查依赖漏洞
npm run security:fix           # 修复依赖漏洞
```

### 目录规范

```
k6/tests/api/
├── common/              # 公共模块（必须）
│   ├── common.js        # 公共函数
│   ├── request.js       # 请求封装
│   └── type.js          # 类型定义
│
├── [module]/            # 业务模块
│   └── [feature]/       # 功能模块
│       └── [feature].test.js  # 测试文件
│
└── script/              # 批量测试脚本
    └── batch_*.js       # 批量测试
```

### 最佳实践

1. **使用场景配置**：不要硬编码 VU 和持续时间，使用 `scenarios.js`
2. **复用 HTTP 客户端**：使用 `httpClient` 而不是原生 `http`
3. **启用自动签名**：对需要签名的接口启用 `autoSign`
4. **Token 管理**：使用 `tokenManager` 自动管理 Token
5. **数据验证**：使用 Zod 验证响应数据结构
6. **批量操作**：继承 `BatchOperationBase` 实现批量测试
7. **日志记录**：使用 `logger` 而不是 `console.log`

---

## 📚 技术栈

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| **测试引擎** | K6 | v1.5.0 | 性能测试核心 |
| **后端** | Node.js + Express | 14+ | Viz 平台 API |
| **前端** | HTML + CSS + JavaScript | - | Viz 管理界面 |
| **数据库** | InfluxDB | 1.8 | 时序数据存储 |
| **监控** | Grafana | 10.2.0 | 可视化仪表板 |
| **容器化** | Docker + Docker Compose | - | 服务编排 |
| **数据验证** | Zod | 4.3.6+ | 响应数据校验 |
| **代码质量** | ESLint + Prettier | - | 代码规范 |

---

## 🔧 常见问题

### Q: 如何修改测试环境？
A: 编辑 `k6/config/envconfig.js`，修改 `BASE_ADMIN_URL` 和 `BASE_DESK_URL`。

### Q: 如何添加新的测试场景？
A: 在 `k6/config/scenarios.js` 中添加新场景配置，参考现有场景格式。

### Q: 如何自定义性能阈值？
A: 编辑 `k6/config/thresholds.js`，设置响应时间、错误率等阈值。

### Q: 测试报告在哪里？
A: HTML 报告自动生成在 `viz/reports/` 目录，文件名包含时间戳。

### Q: 如何禁用自动签名？
A: 在请求时传入 `{ autoSign: false }` 或在 HttpClient 初始化时设置。

### Q: 支持哪些签名算法？
A: 支持 MD5、SHA256 等，在 `k6/libs/utils/signature.js` 中配置。


### Q：如何启动把本地端口映射到公网：
bore local 8080 --to bore.pub
访问：bore.pub：xxx端口号

### Q：如何启动本地的模型
ollama serve
---

## 📄 许可证

MIT License

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

### 贡献指南
1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

---

## 📞 联系方式

- 项目地址：https://github.com/your-org/k6-test-framework
- 问题反馈：https://github.com/your-org/k6-test-framework/issues

---

**Happy Testing! 🚀**
