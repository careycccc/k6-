# K6 可视化测试平台 (Viz Platform)

## 概述

K6 可视化测试平台是一个集成到 k6-performance-framework 的 Web 界面，提供：

- 📝 **脚本管理**：在线查看、编辑、创建 K6 测试脚本
- ▶️ **测试执行**：通过 Web 界面配置并运行测试
- 📊 **测试报告**：自动生成美观的 HTML 测试报告
- 📈 **实时监控**：集成 Grafana 仪表板（可选）

## 快速开始

### 1. 安装依赖

```bash
npm run viz:install
```

### 2. 启动可视化平台

```bash
npm run viz:start
```

或者使用开发模式（支持热重载）：

```bash
npm run viz:dev
```

### 3. 打开 Web 界面

```bash
npm run viz:open
```

或者直接访问：http://localhost:8080

## 功能特性

### 脚本管理
- 浏览所有 K6 测试脚本
- 在线编辑脚本内容
- 创建新的测试脚本
- 删除不需要的脚本

### 测试执行
- 选择要运行的测试脚本
- 配置虚拟用户数 (VUs)
- 设置测试持续时间
- 选择运行环境（local/dev/staging/prod）
- 实时查看测试状态

### 测试报告
- 自动收集 K6 测试指标
- 生成美观的 HTML 报告
- 查看响应时间、成功率等关键指标
- 下载或在线查看报告

### 实时监控（可选）
- 集成 Grafana 仪表板
- 实时查看测试指标
- 支持 InfluxDB 数据存储

## 项目结构

```
viz/
├── backend/           # 后端 API 服务
│   ├── server.js     # Express 服务器
│   └── package.json  # 后端依赖
├── frontend/         # 前端 Web 界面
│   └── index.html    # 单页应用
├── reports/          # 生成的测试报告
└── data/             # 测试数据存储
```

## API 接口

### 脚本管理
- `GET /api/scripts` - 获取脚本列表
- `GET /api/scripts/:name` - 获取脚本内容
- `POST /api/scripts` - 保存脚本
- `DELETE /api/scripts/:name` - 删除脚本

### 测试执行
- `POST /api/tests/run` - 运行测试
- `GET /api/tests` - 获取测试列表
- `GET /api/tests/:id` - 获取测试详情
- `POST /api/tests/:id/stop` - 停止测试

### 报告管理
- `GET /api/reports` - 获取报告列表
- `POST /api/reports/:id/generate` - 生成报告

### 健康检查
- `GET /api/health` - 服务健康检查

## 配置选项

可以通过环境变量配置：

```bash
# 设置后端端口（默认 8080）
export VIZ_PORT=8080

# 启动服务
npm run viz:start
```

## 集成 Grafana（可选）

如需完整的实时监控功能，可以集成 Grafana：

1. 安装 Grafana 和 InfluxDB
2. 配置 K6 输出到 InfluxDB
3. 导入 Grafana 仪表板

```bash
k6 run --out influxdb=http://localhost:8086/k6 script.js
```

## 注意事项

1. **K6 依赖**：确保系统已安装 K6
   ```bash
   # macOS
   brew install k6
   
   # 其他系统请参考 K6 官方文档
   ```

2. **Node.js 版本**：需要 Node.js >= 14.0.0

3. **测试执行**：测试在后台异步执行，可以通过界面查看状态

4. **报告生成**：测试完成后自动生成 HTML 报告

## 故障排除

### 端口被占用
如果 8080 端口被占用，可以修改环境变量：
```bash
export VIZ_PORT=3000
npm run viz:start
```

### K6 未找到
确保 K6 已安装并在 PATH 中：
```bash
k6 version
```

### 权限问题
如果遇到权限问题，请检查：
- 脚本目录的读写权限
- 报告目录的写入权限

## 后续计划

- [ ] 支持测试计划调度
- [ ] 多用户协作功能
- [ ] 测试历史趋势分析
- [ ] 集成更多数据源（Prometheus、CloudWatch 等）
- [ ] 支持分布式测试管理

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License
