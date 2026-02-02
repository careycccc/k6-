require('dotenv').config({ path: '../.env' });

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.VIZ_PORT || 8080;

// 辅助函数：安全获取 metric 值（支持 values.xxx 和直接 xxx 两种结构）
function getMetricValue(metricObj, key) {
  if (!metricObj) return null;
  // 优先尝试 values.xxx
  if (metricObj.values && metricObj.values[key] !== undefined) {
    return metricObj.values[key];
  }
  // 然后尝试直接 xxx
  if (metricObj[key] !== undefined) {
    return metricObj[key];
  }
  return null;
}

// 数据存储路径
const DATA_DIR = path.join(__dirname, '..', 'data');
const REPORTS_DIR = path.join(__dirname, '..', 'reports');
// 只扫描 k6/tests/api/script 目录下的脚本
const K6_SCRIPTS_DIR = path.join(__dirname, '..', '..', 'k6', 'tests', 'api', 'script');

// 内存存储（MVP 版本）
let tests = new Map();
let scripts = new Map();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use('/reports', express.static(REPORTS_DIR));

// 初始化数据目录
async function initDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(REPORTS_DIR, { recursive: true });
    
    // 加载已存在的测试数据
    const testsFile = path.join(DATA_DIR, 'tests.json');
    try {
      const data = await fs.readFile(testsFile, 'utf8');
      const parsed = JSON.parse(data);
      tests = new Map(Object.entries(parsed));
    } catch (e) {
      // 文件不存在，使用空 Map
    }
  } catch (error) {
    console.error('初始化数据目录失败:', error);
  }
}

// 保存测试数据到文件
async function saveTests() {
  const testsFile = path.join(DATA_DIR, 'tests.json');
  const data = Object.fromEntries(tests);
  await fs.writeFile(testsFile, JSON.stringify(data, null, 2));
}

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 获取脚本列表 - 只返回 k6/tests/api/script 目录下的脚本
app.get('/api/scripts', async (req, res) => {
  try {
    const scripts = [];
    
    // 只扫描 k6/tests/api/script 目录，不递归子目录
    const entries = await fs.readdir(K6_SCRIPTS_DIR, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory() && entry.name.endsWith('.js')) {
        const fullPath = path.join(K6_SCRIPTS_DIR, entry.name);
        const stats = await fs.stat(fullPath);
        scripts.push({
          name: entry.name,
          path: fullPath,
          size: stats.size,
          updatedAt: stats.mtime.toISOString()
        });
      }
    }
    
    // 按文件名排序
    scripts.sort((a, b) => a.name.localeCompare(b.name));
    
    res.json(scripts);
  } catch (error) {
    console.error('获取脚本列表失败:', error);
    res.status(500).json({ error: '获取脚本列表失败', message: error.message });
  }
});

// 获取脚本内容
app.get('/api/scripts/:name(*)', async (req, res) => {
  try {
    const scriptName = req.params.name;
    const scriptPath = path.join(K6_SCRIPTS_DIR, scriptName);
    
    // 安全检查：确保路径在允许的目录内
    if (!scriptPath.startsWith(K6_SCRIPTS_DIR)) {
      return res.status(403).json({ error: '非法路径' });
    }
    
    const content = await fs.readFile(scriptPath, 'utf8');
    res.json({ name: scriptName, content });
  } catch (error) {
    console.error('获取脚本内容失败:', error);
    res.status(404).json({ error: '脚本不存在', message: error.message });
  }
});

// 保存脚本
app.post('/api/scripts', async (req, res) => {
  try {
    const { name, content } = req.body;
    
    if (!name || !content) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    
    const scriptPath = path.join(K6_SCRIPTS_DIR, name);
    
    // 安全检查
    if (!scriptPath.startsWith(K6_SCRIPTS_DIR)) {
      return res.status(403).json({ error: '非法路径' });
    }
    
    // 确保目录存在
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    
    // 写入文件
    await fs.writeFile(scriptPath, content, 'utf8');
    
    res.json({ name, status: 'saved', message: '脚本保存成功' });
  } catch (error) {
    console.error('保存脚本失败:', error);
    res.status(500).json({ error: '保存脚本失败', message: error.message });
  }
});

// 删除脚本
app.delete('/api/scripts/:name(*)', async (req, res) => {
  try {
    const scriptName = req.params.name;
    const scriptPath = path.join(K6_SCRIPTS_DIR, scriptName);
    
    // 安全检查
    if (!scriptPath.startsWith(K6_SCRIPTS_DIR)) {
      return res.status(403).json({ error: '非法路径' });
    }
    
    await fs.unlink(scriptPath);
    res.json({ name: scriptName, status: 'deleted', message: '脚本删除成功' });
  } catch (error) {
    console.error('删除脚本失败:', error);
    res.status(500).json({ error: '删除脚本失败', message: error.message });
  }
});

// 运行测试
app.post('/api/tests/run', async (req, res) => {
  try {
    const { script, name, vus = 10, duration = '30s', env = 'local' } = req.body;
    
    if (!script) {
      return res.status(400).json({ error: '缺少脚本参数' });
    }
    
    const testId = uuidv4();
    const testName = name || `Test-${Date.now()}`;
    const scriptPath = path.join(K6_SCRIPTS_DIR, script);
    
    // 安全检查
    if (!scriptPath.startsWith(K6_SCRIPTS_DIR)) {
      return res.status(403).json({ error: '非法脚本路径' });
    }
    
    // 创建测试记录
    const test = {
      testId,
      name: testName,
      script,
      status: 'running',
      config: { vus, duration, env },
      startedAt: new Date().toISOString(),
      completedAt: null,
      metrics: null,
      reportUrl: null,
      log: []
    };
    
    tests.set(testId, test);
    await saveTests();
    
    // 异步执行测试
    runTest(testId, scriptPath, vus, duration, env);
    
    res.json({ testId, status: 'running', message: '测试启动成功' });
  } catch (error) {
    console.error('启动测试失败:', error);
    res.status(500).json({ error: '启动测试失败', message: error.message });
  }
});

// 获取测试列表
app.get('/api/tests', (req, res) => {
  try {
    const testList = Array.from(tests.values()).sort((a, b) => 
      new Date(b.startedAt) - new Date(a.startedAt)
    );
    res.json(testList);
  } catch (error) {
    console.error('获取测试列表失败:', error);
    res.status(500).json({ error: '获取测试列表失败', message: error.message });
  }
});

// 获取测试详情
app.get('/api/tests/:id', (req, res) => {
  try {
    const test = tests.get(req.params.id);
    if (!test) {
      return res.status(404).json({ error: '测试不存在' });
    }
    res.json(test);
  } catch (error) {
    console.error('获取测试详情失败:', error);
    res.status(500).json({ error: '获取测试详情失败', message: error.message });
  }
});

// 停止测试
app.post('/api/tests/:id/stop', async (req, res) => {
  try {
    const test = tests.get(req.params.id);
    if (!test) {
      return res.status(404).json({ error: '测试不存在' });
    }
    
    if (test.status !== 'running') {
      return res.status(400).json({ error: '测试未在运行中' });
    }
    
    // MVP 版本：仅标记状态，实际进程管理需要更复杂的实现
    test.status = 'stopped';
    test.completedAt = new Date().toISOString();
    test.log.push('测试被手动停止');
    
    await saveTests();
    res.json({ testId: req.params.id, status: 'stopped' });
  } catch (error) {
    console.error('停止测试失败:', error);
    res.status(500).json({ error: '停止测试失败', message: error.message });
  }
});

// 检查脚本是否包含 scenarios 配置
async function hasScenarios(scriptPath) {
  try {
    const content = await fs.readFile(scriptPath, 'utf8');
    return content.includes('scenarios') || content.includes('options');
  } catch (e) {
    return false;
  }
}

// 执行测试的异步函数
async function runTest(testId, scriptPath, vus, duration, env) {
  const test = tests.get(testId);
  if (!test) return;
  
  try {
    // 构建 k6 命令
    const reportFile = path.join(REPORTS_DIR, `${testId}-summary.json`);
    const htmlReport = path.join(REPORTS_DIR, `${testId}-report.html`);
    
    // 检查脚本是否已有 scenarios 配置
    const scriptHasScenarios = await hasScenarios(scriptPath);
    
    let cmd;
    if (scriptHasScenarios) {
      // 脚本已有 scenarios，只添加环境变量和报告导出
      cmd = `k6 run \\
        --quiet \\
        --env ENV=${env} \\
        --summary-export=${reportFile} \\
        ${scriptPath}`;
      test.log.push('检测到脚本已包含 scenarios 配置，使用脚本内置配置');
    } else {
      // 脚本没有 scenarios，添加 vus 和 duration
      cmd = `k6 run \\
        --quiet \\
        --vus ${vus} \\
        --duration ${duration} \\
        --env ENV=${env} \\
        --summary-export=${reportFile} \\
        ${scriptPath}`;
      test.log.push(`使用测试平台配置: VUs=${vus}, Duration=${duration}`);
    }
    
    test.log.push(`执行命令: ${cmd}`);
    test.log.push(`开始时间: ${new Date().toISOString()}`);
    
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: 10 * 60 * 1000, // 10分钟超时
      maxBuffer: 50 * 1024 * 1024 // 50MB 缓冲区，防止大输出导致错误
    });
    
    test.log.push(`标准输出: ${stdout}`);
    if (stderr) {
      test.log.push(`标准错误: ${stderr}`);
    }
    
    // 读取测试结果
    try {
      const summaryData = await fs.readFile(reportFile, 'utf8');
      const summary = JSON.parse(summaryData);
      
      // 调试：记录数据结构
      test.log.push(`[DEBUG] Summary keys: ${Object.keys(summary).join(', ')}`);
      if (summary.metrics) {
        test.log.push(`[DEBUG] Metrics keys: ${Object.keys(summary.metrics).join(', ')}`);
        if (summary.metrics.http_req_duration) {
          test.log.push(`[DEBUG] http_req_duration keys: ${Object.keys(summary.metrics.http_req_duration).join(', ')}`);
          test.log.push(`[DEBUG] http_req_duration.values: ${JSON.stringify(summary.metrics.http_req_duration.values || {})}`);
        }
        if (summary.metrics.vus) {
          test.log.push(`[DEBUG] vus keys: ${Object.keys(summary.metrics.vus).join(', ')}`);
          test.log.push(`[DEBUG] vus.values: ${JSON.stringify(summary.metrics.vus.values || {})}`);
        }
      }
      
      test.metrics = {
        http_req_duration: summary.metrics?.http_req_duration || {},
        http_req_failed: summary.metrics?.http_req_failed || {},
        http_reqs: summary.metrics?.http_reqs || {},
        vus: summary.metrics?.vus || {},
        data_received: summary.metrics?.data_received || {},
        data_sent: summary.metrics?.data_sent || {}
      };
      test.log.push('✓ 测试结果解析成功');
    } catch (e) {
      test.log.push(`✗ 读取结果文件失败: ${e.message}`);
    }
    
    // 先更新测试状态和时间，再生成报告
    test.status = 'completed';
    test.completedAt = new Date().toISOString();
    test.reportUrl = `/reports/${testId}-report.html`;
    
    // 生成 HTML 报告（在状态更新之后）
    await generateHtmlReport(testId, test);
    
  } catch (error) {
    test.status = 'failed';
    test.completedAt = new Date().toISOString();
    
    // 详细的错误日志
    const errorMsg = `测试执行失败: ${error.message}`;
    test.log.push(errorMsg);
    
    // 如果是缓冲区溢出错误，给出具体提示
    if (error.message.includes('maxBuffer')) {
      test.log.push('提示: k6 输出内容过多，请检查测试脚本是否包含大量日志输出');
      test.log.push('建议: 减少 console.log 调用，或使用 --quiet 模式运行 k6');
    }
    
    console.error(`测试 ${testId} 执行失败:`, error);
  }
  
  await saveTests();
}

// 生成 HTML 报告
async function generateHtmlReport(testId, test) {
  // 使用辅助函数获取指标值
  const getVal = (metric, key) => getMetricValue(test.metrics?.[metric], key);
  const formatMs = (val) => val !== null && val !== undefined ? val.toFixed(2) : 'N/A';
  const formatNum = (val) => val !== null && val !== undefined ? val.toString() : 'N/A';
  
  // 计算成功率
  const failedRate = getVal('http_req_failed', 'rate');
  const totalReqs = getVal('http_reqs', 'count');
  const successRate = failedRate !== null ? ((1 - failedRate) * 100).toFixed(2) : (totalReqs > 0 ? '100.00' : 'N/A');
  
  const htmlContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>K6 测试报告 - ${test.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f7fa;
      color: #333;
      line-height: 1.6;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .header { 
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 10px;
      margin-bottom: 30px;
    }
    .header h1 { font-size: 28px; margin-bottom: 10px; }
    .header p { opacity: 0.9; }
    .status-badge {
      display: inline-block;
      padding: 5px 15px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 600;
      margin-top: 10px;
    }
    .status-completed { background: #10b981; }
    .status-failed { background: #ef4444; }
    .status-running { background: #f59e0b; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .card {
      background: white;
      padding: 20px;
      border-radius: 10px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      text-align: center;
    }
    .card h3 { color: #667eea; margin-bottom: 10px; font-size: 14px; text-transform: uppercase; }
    .card .value { font-size: 32px; font-weight: 700; color: #333; }
    .card .unit { font-size: 14px; color: #666; margin-left: 5px; }
    .section { background: white; padding: 30px; border-radius: 10px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .section h2 { color: #333; margin-bottom: 20px; font-size: 20px; border-bottom: 2px solid #667eea; padding-bottom: 10px; }
    .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
    .info-row:last-child { border-bottom: none; }
    .label { color: #666; }
    .value { color: #333; font-weight: 500; }
    .log-container {
      background: #1a1a2e;
      color: #eee;
      padding: 20px;
      border-radius: 5px;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      overflow-x: auto;
      max-height: 400px;
      overflow-y: auto;
    }
    .log-line { margin: 2px 0; }
    .timestamp { color: #64b5f6; }
    .success { color: #81c784; }
    .error { color: #e57373; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f8f9fa; font-weight: 600; color: #667eea; }
    tr:hover { background: #f8f9fa; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 K6 性能测试报告</h1>
      <p>${test.name}</p>
      <span class="status-badge status-${test.status}">${test.status.toUpperCase()}</span>
    </div>
    
    <div class="grid">
      <div class="card">
        <h3>平均响应时间</h3>
        <div class="value">${formatMs(getVal('http_req_duration', 'avg'))}<span class="unit"> ms</span></div>
      </div>
      <div class="card">
        <h3>P95 响应时间</h3>
        <div class="value">${formatMs(getVal('http_req_duration', 'p(95)'))}<span class="unit"> ms</span></div>
      </div>
      <div class="card">
        <h3>P99 响应时间</h3>
        <div class="value">${formatMs(getVal('http_req_duration', 'p(99)'))}<span class="unit"> ms</span></div>
      </div>
      <div class="card">
        <h3>请求成功率</h3>
        <div class="value">${successRate}<span class="unit">%</span></div>
      </div>
      <div class="card">
        <h3>总请求数</h3>
        <div class="value">${formatNum(totalReqs)}<span class="unit">reqs</span></div>
      </div>
    </div>
    
    <div class="section">
      <h2>📋 测试配置</h2>
      <div class="info-row">
        <span class="label">测试 ID</span>
        <span class="value">${testId}</span>
      </div>
      <div class="info-row">
        <span class="label">测试脚本</span>
        <span class="value">${test.script}</span>
      </div>
      <div class="info-row">
        <span class="label">虚拟用户数 (VUs)</span>
        <span class="value">${test.config.vus}</span>
      </div>
      <div class="info-row">
        <span class="label">持续时间</span>
        <span class="value">${test.config.duration}</span>
      </div>
      <div class="info-row">
        <span class="label">环境</span>
        <span class="value">${test.config.env}</span>
      </div>
      <div class="info-row">
        <span class="label">开始时间</span>
        <span class="value">${new Date(test.startedAt).toLocaleString()}</span>
      </div>
      <div class="info-row">
        <span class="label">完成时间</span>
        <span class="value">${test.completedAt ? new Date(test.completedAt).toLocaleString() : '运行中...'}</span>
      </div>
    </div>
    
    <div class="section">
      <h2>📊 性能指标详情</h2>
      <table>
        <thead>
          <tr>
            <th>指标</th>
            <th>平均值</th>
            <th>最小值</th>
            <th>最大值</th>
            <th>P95</th>
            <th>P99</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>HTTP 请求持续时间</td>
            <td>${formatMs(getVal('http_req_duration', 'avg'))} ms</td>
            <td>${formatMs(getVal('http_req_duration', 'min'))} ms</td>
            <td>${formatMs(getVal('http_req_duration', 'max'))} ms</td>
            <td>${formatMs(getVal('http_req_duration', 'p(95)'))} ms</td>
            <td>${formatMs(getVal('http_req_duration', 'p(99)'))} ms</td>
          </tr>
          <tr>
            <td>HTTP 请求失败率</td>
            <td>${failedRate !== null ? (failedRate * 100).toFixed(2) + ' %' : '0.00 %'}</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
          </tr>
          <tr>
            <td>虚拟用户数</td>
            <td>${formatNum(getVal('vus', 'value'))}</td>
            <td>${formatNum(getVal('vus', 'min'))}</td>
            <td>${formatNum(getVal('vus', 'max'))}</td>
            <td>-</td>
            <td>-</td>
          </tr>
        </tbody>
      </table>
    </div>
    
    <div class="section">
      <h2>📝 执行日志</h2>
      <div class="log-container">
        ${test.log.map((line, index) => `<div class="log-line"><span class="timestamp">[${index + 1}]</span> ${line.replace(/\n/g, '<br>')}</div>`).join('<div style="height: 8px;"></div>')}
      </div>
    </div>
  </div>
</body>
</html>`;
  
  const reportPath = path.join(REPORTS_DIR, `${testId}-report.html`);
  await fs.writeFile(reportPath, htmlContent, 'utf8');
}

// 启动服务器
initDataDir().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ K6 Viz 平台已启动`);
    console.log(`📡 API 地址: http://localhost:${PORT}/api`);
    console.log(`🌐 Web 界面: http://localhost:${PORT}`);
    console.log(`📊 报告目录: ${REPORTS_DIR}`);
  });
});

module.exports = app;
