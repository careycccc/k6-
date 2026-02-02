# K6 性能测试框架 - 可视化测试平台

企业级 K6 性能测试与自动化接口测试框架，集成可视化 Web 界面、实时监控仪表板和自动化测试报告。

![Platform](https://img.shields.io/badge/Platform-Docker-blue)
![K6](https://img.shields.io/badge/K6-v1.5.0-green)
![Grafana](https://img.shields.io/badge/Grafana-10.2.0-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## 📋 目录

- [功能特性](#-功能特性)
- [系统架构](#-系统架构)
- [快速开始](#-快速开始)
- [使用指南](#-使用指南)
- [项目结构](#-项目结构)
- [配置说明](#-配置说明)
- [故障排除](#-故障排除)

---

## ✨ 功能特性

| 功能 | 描述 |
|------|------|
| 📝 **脚本管理** | 在线查看、编辑、创建 K6 测试脚本 |
| ▶️ **测试执行** | 通过 Web 界面配置并运行测试 |
| 📊 **实时监控** | Grafana 仪表板实时展示测试数据 |
| 📈 **性能指标** | 响应时间、吞吐量、错误率、虚拟用户数等 |
| 📄 **测试报告** | 自动生成美观的 HTML 测试报告 |
| 🎨 **现代 UI** | 基于 Web 的美观管理界面 |
| 🐳 **容器化** | Docker Compose 一键部署 |

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

| 组件 | 端口 | 说明 |
|------|------|------|
| **Viz Platform** | 8080 | Web 管理界面（脚本管理、测试执行、报告查看） |
| **Grafana** | 3000 | 实时监控仪表板 |
| **InfluxDB** | 8086 | 时序数据存储 |
| **K6** | - | 性能测试执行器（内嵌在 Viz Platform 中） |

---

## 🚀 快速开始

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
open http://localhost:3000    # Grafana 监控
```

**默认账号密码**：
- Grafana: admin / admin123

### 方式二：本地开发

```bash
# 1. 安装依赖
npm install

# 2. 启动 Viz 平台后端
cd viz/backend && npm install && npm start

# 3. 打开浏览器访问
open http://localhost:8080
```

---

## 📖 使用指南

### 1. 脚本管理

1. 访问 http://localhost:8080
2. 点击 **"脚本管理"** 标签
3. 查看 `k6/tests/api/script` 目录下的所有测试脚本
4. 点击脚本名称查看/编辑代码
5. 支持在线创建新脚本

### 2. 运行测试

1. 点击 **"测试执行"** 标签
2. 选择要运行的测试脚本
3. 配置参数：
   - **虚拟用户数 (VUs)**: 并发用户数
   - **持续时间**: 测试运行时长（如 30s, 1m, 5m）
   - **环境**: local/dev/staging/prod
4. 点击 **"开始测试"**
5. 在 **"测试记录"** 中查看运行状态

### 3. 查看实时监控（Grafana）

1. 访问 http://localhost:3000
2. 登录（admin/admin123）
3. 进入 **"K6 实时监控仪表板"**
4. 选择 **测试ID** 筛选特定测试
5. 实时查看：
   - ⏱️ 响应时间趋势（含 P90、P95）
   - 🚀 请求速率 (RPS)
   - 👥 虚拟用户数
   - ❌ 错误率

**提示**：
- 仪表板每 5 秒自动刷新
- 选择特定测试 ID 可精确查看单个测试的数据
- 时间范围可调（默认显示最近 1 小时）

### 4. 查看测试报告

1. 测试完成后，在 **"测试记录"** 中找到对应测试
2. 点击 **"报告"** 按钮
3. 查看 HTML 测试报告，包含：
   - 测试概览
   - 性能指标（平均响应时间、P95、P99）
   - 成功率、总请求数
   - 虚拟用户数
   - 执行日志

---

## 📁 项目结构

```
k6-performance-framework/
├── docker-compose.yml          # Docker 编排配置
├── README.md                   # 项目文档
│
├── viz/                        # 可视化平台
│   ├── backend/                # 后端服务
│   │   ├── server.js           # Express API
│   │   ├── Dockerfile          # Docker 镜像
│   │   └── package.json
│   ├── frontend/               # 前端界面
│   │   └── index.html          # Web 管理界面
│   ├── reports/                # 测试报告输出
│   └── data/                   # 测试数据存储
│
├── grafana/                    # Grafana 配置
│   └── provisioning/
│       ├── dashboards/         # 仪表板配置
│       └── datasources/        # 数据源配置
│
├── k6/                         # K6 测试脚本
│   ├── tests/                  # 测试用例
│   │   └── api/                # API 测试
│   │       └── script/         # 脚本目录
│   ├── config/                 # 配置文件
│   └── libs/                   # 工具库
│
└── package.json                # 项目依赖
```

---

## ⚙️ 配置说明

### 环境变量

创建 `viz/.env` 文件：

```env
# Viz Platform 端口
VIZ_PORT=8080

# InfluxDB 配置
INFLUXDB_URL=http://influxdb:8086
INFLUXDB_DB=k6

# Grafana 配置（可选）
GRAFANA_URL=http://localhost:3000
```

### Docker Compose 配置

主要服务配置：

```yaml
services:
  influxdb:
    image: influxdb:1.8
    ports:
      - "8086:8086"
    environment:
      - INFLUXDB_DB=k6
  
  grafana:
    image: grafana/grafana:10.2.0
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=admin123
  
  viz-backend:
    build: ./viz/backend
    ports:
      - "8080:8080"
    volumes:
      - ./k6:/app/k6
      - ./viz/reports:/app/viz/reports
```

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

## 📚 技术栈

- **后端**: Node.js + Express
- **前端**: 原生 HTML + CSS + JavaScript
- **性能测试**: k6 v1.5.0
- **数据存储**: InfluxDB 1.8
- **监控仪表板**: Grafana 10.2.0
- **容器化**: Docker + Docker Compose

---

## 📄 许可证

MIT License

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

**Happy Testing! 🚀**
