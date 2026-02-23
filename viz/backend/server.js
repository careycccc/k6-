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

// 辅助函数：安全获取 metric 值（支持直接 xxx 和 values.xxx 两种结构）
function getMetricValue(metricObj, key) {
  if (!metricObj) return null;

  // 优先尝试直接 xxx（k6 summary 格式）
  if (metricObj[key] !== undefined) {
    return metricObj[key];
  }

  // 然后尝试 values.xxx
  if (metricObj.values && metricObj.values[key] !== undefined) {
    return metricObj.values[key];
  }

  // 对于 vus.value，如果没有但有 max，返回 max
  if (key === 'value' && metricObj.max !== undefined) {
    return metricObj.max;
  }

  return null;
}

// 数据存储路径
const DATA_DIR = path.join(__dirname, '..', 'data');
const REPORTS_DIR = path.join(__dirname, '..', 'reports');
// 只扫描 k6/tests/api/script 目录下的脚本
// Docker 中使用绝对路径 /app/k6/tests/api/script，本地使用相对路径
const K6_SCRIPTS_DIR = process.env.NODE_ENV === 'docker'
  ? '/app/k6/tests/api/script'
  : path.join(__dirname, '..', '..', 'k6', 'tests', 'api', 'script');

// 内存存储（MVP 版本）
let tests = new Map();
let scripts = new Map();

app.use(cors());
app.use(express.json());

// 静态文件服务 - 自动检测正确的路径
let FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
// 如果在 Docker 中且本地路径不存在，使用 Docker 路径
if (!require('fs').existsSync(FRONTEND_DIR)) {
  FRONTEND_DIR = '/app/viz/frontend';
}

console.log(`[DEBUG] __dirname: ${__dirname}`);
console.log(`[DEBUG] FRONTEND_DIR: ${FRONTEND_DIR}`);
console.log(`[DEBUG] NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
console.log(`[DEBUG] Directory exists: ${require('fs').existsSync(FRONTEND_DIR)}`);

app.use(express.static(FRONTEND_DIR));
app.use('/reports', express.static(REPORTS_DIR));

// 根路径 - 返回前端页面
app.get('/', (req, res) => {
  const indexPath = path.join(FRONTEND_DIR, 'index.html');
  console.log(`[DEBUG] Serving index.html from: ${indexPath}`);
  res.sendFile(indexPath);
});

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
    const { script, name } = req.body;

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
      config: { note: '配置由脚本控制' },
      startedAt: new Date().toISOString(),
      completedAt: null,
      metrics: null,
      reportUrl: null,
      log: []
    };

    tests.set(testId, test);
    await saveTests();

    // 异步执行测试
    runTest(testId, scriptPath);

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

// 删除测试记录（只删除测试记录，保留报告文件）
app.delete('/api/tests/:id', async (req, res) => {
  try {
    const testId = req.params.id;
    const test = tests.get(testId);

    if (!test) {
      return res.status(404).json({ error: '测试不存在' });
    }

    // 不允许删除正在运行的测试
    if (test.status === 'RUNNING') {
      return res.status(400).json({ error: '无法删除正在运行的测试，请先停止测试' });
    }

    // 只从内存中删除测试记录
    tests.delete(testId);

    // 保存更新后的测试数据
    await saveTests();

    console.log(`[DELETE TEST] 测试记录已删除: ${testId}`);

    res.json({
      success: true,
      message: '测试记录删除成功',
      testId: testId,
      note: '报告文件已保留'
    });
  } catch (error) {
    console.error('删除测试记录失败:', error);
    res.status(500).json({ error: '删除测试记录失败', message: error.message });
  }
});

// 删除报告（只删除报告文件，保留测试记录）
app.delete('/api/reports/:id', async (req, res) => {
  try {
    const testId = req.params.id;
    const deletedFiles = [];
    const errors = [];

    // 1. 删除 HTML 报告文件
    const reportFile = path.join(REPORTS_DIR, `${testId}-report.html`);
    try {
      await fs.unlink(reportFile);
      deletedFiles.push(`${testId}-report.html`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        errors.push(`删除报告文件失败: ${error.message}`);
      } else {
        return res.status(404).json({ error: '报告文件不存在' });
      }
    }

    // 2. 删除 summary JSON 文件
    const summaryFile = path.join(REPORTS_DIR, `${testId}-summary.json`);
    try {
      await fs.unlink(summaryFile);
      deletedFiles.push(`${testId}-summary.json`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        errors.push(`删除 summary 文件失败: ${error.message}`);
      }
    }

    console.log(`[DELETE REPORT] 报告已删除: ${testId}, 删除的文件: ${deletedFiles.join(', ')}`);

    res.json({
      success: true,
      message: '报告删除成功',
      testId: testId,
      deletedFiles: deletedFiles,
      errors: errors.length > 0 ? errors : undefined,
      note: '测试记录已保留'
    });
  } catch (error) {
    console.error('删除报告失败:', error);
    res.status(500).json({ error: '删除报告失败', message: error.message });
  }
});

// 彻底删除（删除测试记录和报告文件）
app.delete('/api/tests/:id/complete', async (req, res) => {
  try {
    const testId = req.params.id;
    const test = tests.get(testId);

    if (!test) {
      return res.status(404).json({ error: '测试不存在' });
    }

    // 不允许删除正在运行的测试
    if (test.status === 'RUNNING') {
      return res.status(400).json({ error: '无法删除正在运行的测试，请先停止测试' });
    }

    const deletedFiles = [];
    const errors = [];

    // 1. 删除 HTML 报告文件
    const reportFile = path.join(REPORTS_DIR, `${testId}-report.html`);
    try {
      await fs.unlink(reportFile);
      deletedFiles.push(`${testId}-report.html`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        errors.push(`删除报告文件失败: ${error.message}`);
      }
    }

    // 2. 删除 summary JSON 文件
    const summaryFile = path.join(REPORTS_DIR, `${testId}-summary.json`);
    try {
      await fs.unlink(summaryFile);
      deletedFiles.push(`${testId}-summary.json`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        errors.push(`删除 summary 文件失败: ${error.message}`);
      }
    }

    // 3. 从内存中删除测试记录
    tests.delete(testId);

    // 4. 保存更新后的测试数据
    await saveTests();

    console.log(`[DELETE COMPLETE] 测试和报告已彻底删除: ${testId}, 删除的文件: ${deletedFiles.join(', ')}`);

    res.json({
      success: true,
      message: '测试和报告彻底删除成功',
      testId: testId,
      deletedFiles: deletedFiles,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('彻底删除失败:', error);
    res.status(500).json({ error: '彻底删除失败', message: error.message });
  }
});

// 批量删除测试
app.post('/api/tests/batch-delete', async (req, res) => {
  try {
    const { testIds } = req.body;

    if (!Array.isArray(testIds) || testIds.length === 0) {
      return res.status(400).json({ error: '请提供要删除的测试 ID 列表' });
    }

    const results = {
      success: [],
      failed: [],
      skipped: []
    };

    for (const testId of testIds) {
      const test = tests.get(testId);

      if (!test) {
        results.skipped.push({ testId, reason: '测试不存在' });
        continue;
      }

      if (test.status === 'RUNNING') {
        results.skipped.push({ testId, reason: '测试正在运行' });
        continue;
      }

      try {
        // 删除报告文件
        const reportFile = path.join(REPORTS_DIR, `${testId}-report.html`);
        try {
          await fs.unlink(reportFile);
        } catch (error) {
          if (error.code !== 'ENOENT') {
            console.warn(`删除报告文件失败: ${error.message}`);
          }
        }

        // 删除 summary 文件
        const summaryFile = path.join(REPORTS_DIR, `${testId}-summary.json`);
        try {
          await fs.unlink(summaryFile);
        } catch (error) {
          if (error.code !== 'ENOENT') {
            console.warn(`删除 summary 文件失败: ${error.message}`);
          }
        }

        // 从内存中删除
        tests.delete(testId);

        results.success.push(testId);
      } catch (error) {
        results.failed.push({ testId, error: error.message });
      }
    }

    // 保存更新后的测试数据
    await saveTests();

    console.log(`[BATCH DELETE] 成功: ${results.success.length}, 失败: ${results.failed.length}, 跳过: ${results.skipped.length}`);

    res.json({
      success: true,
      message: `批量删除完成`,
      results: results
    });
  } catch (error) {
    console.error('批量删除测试失败:', error);
    res.status(500).json({ error: '批量删除测试失败', message: error.message });
  }
});

// 获取报告列表
app.get('/api/reports', async (req, res) => {
  try {
    const files = await fs.readdir(REPORTS_DIR);
    const reports = files
      .filter(f => f.endsWith('-report.html'))
      .map(f => {
        const testId = f.replace('-report.html', '');
        const test = tests.get(testId);
        return {
          id: testId,
          testId: testId,
          name: test?.name || 'Unknown',
          createdAt: test?.completedAt || new Date().toISOString(),
          url: `/reports/${f}`,
          status: test?.status || 'unknown'
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(reports);
  } catch (error) {
    console.error('获取报告列表失败:', error);
    res.status(500).json({ error: '获取报告列表失败', message: error.message });
  }
});

// 生成报告
app.post('/api/reports/:id/generate', async (req, res) => {
  try {
    const test = tests.get(req.params.id);
    if (!test) {
      return res.status(404).json({ error: '测试不存在' });
    }

    // 重新生成报告
    await generateHtmlReport(req.params.id, test);

    res.json({
      id: req.params.id,
      reportUrl: `/reports/${req.params.id}-report.html`,
      message: '报告生成成功'
    });
  } catch (error) {
    console.error('生成报告失败:', error);
    res.status(500).json({ error: '生成报告失败', message: error.message });
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
async function runTest(testId, scriptPath) {
  const test = tests.get(testId);
  if (!test) return;

  try {
    // ========================================
    // 步骤 1: 清理该 testid 的旧数据（确保每次测试从 0 开始）
    // ========================================
    test.log.push('');
    test.log.push('╔═══════════════════════════════════════════════════════════╗');
    test.log.push('║          清理旧数据 - 确保测试数据独立                    ║');
    test.log.push('╚═══════════════════════════════════════════════════════════╝');
    test.log.push('');

    const influxdbUrl = process.env.INFLUXDB_URL || 'http://localhost:8086';
    const influxdbDb = process.env.INFLUXDB_DB || 'k6';

    try {
      // 删除 InfluxDB 中该 testid 的所有数据
      const deleteQuery = `DROP SERIES WHERE testid = '${testId}'`;
      const deleteCmd = `curl -X POST '${influxdbUrl}/query?db=${influxdbDb}' --data-urlencode "q=${deleteQuery}"`;

      test.log.push(`[1/2] 清理 InfluxDB 数据: testid=${testId}`);
      await execAsync(deleteCmd);
      test.log.push('[1/2] ✓ InfluxDB 数据清理完成');
    } catch (error) {
      test.log.push(`[1/2] ⚠ InfluxDB 数据清理失败: ${error.message}`);
      // 继续执行，不中断测试
    }

    // 删除旧的报告文件
    try {
      const oldHtmlReport = path.join(REPORTS_DIR, `${testId}-report.html`);
      const oldSummaryReport = path.join(REPORTS_DIR, `${testId}-summary.json`);

      test.log.push('[2/2] 清理旧报告文件');

      try {
        await fs.unlink(oldHtmlReport);
        test.log.push('  ✓ 删除旧 HTML 报告');
      } catch (e) {
        // 文件不存在，忽略
      }

      try {
        await fs.unlink(oldSummaryReport);
        test.log.push('  ✓ 删除旧 JSON 报告');
      } catch (e) {
        // 文件不存在，忽略
      }

      test.log.push('[2/2] ✓ 报告文件清理完成');
    } catch (error) {
      test.log.push(`[2/2] ⚠ 报告文件清理失败: ${error.message}`);
    }

    test.log.push('');
    test.log.push('✓ 数据清理完成，开始运行测试...');
    test.log.push('');

    // ========================================
    // 步骤 2: 确保报告目录存在
    // ========================================
    const k6ReportsDir = '/app/reports';
    try {
      await fs.mkdir(k6ReportsDir, { recursive: true });
    } catch (error) {
      test.log.push(`[WARN] 创建报告目录失败: ${error.message}`);
    }

    // ========================================
    // 步骤 3: 构建并执行 k6 命令
    // ========================================
    const reportFile = path.join(REPORTS_DIR, `${testId}-summary.json`);
    const htmlReport = path.join(REPORTS_DIR, `${testId}-report.html`);

    // P99 和其他统计指标配置
    const summaryStats = 'avg,min,med,max,p(90),p(95),p(99)';

    // 添加测试标签，用于在 Grafana 中筛选特定测试
    const testTags = `--tag testid=${testId} --tag testname="${test.name}" --tag script="${test.script}"`;

    // 脚本自己控制所有配置，只添加报告导出和 InfluxDB 输出
    const cmd = `k6 run \\
      --quiet \\
      --summary-export=${reportFile} \\
      --summary-trend-stats="${summaryStats}" \\
      --out influxdb=${influxdbUrl}/${influxdbDb} \\
      ${testTags} \\
      ${scriptPath}`;

    test.log.push('╔═══════════════════════════════════════════════════════════╗');
    test.log.push('║          开始执行测试                                      ║');
    test.log.push('╚═══════════════════════════════════════════════════════════╝');
    test.log.push('');
    test.log.push(`测试 ID: ${testId}`);
    test.log.push(`测试名称: ${test.name}`);
    test.log.push(`测试脚本: ${test.script}`);
    test.log.push(`InfluxDB: ${influxdbUrl}/${influxdbDb}`);
    test.log.push(`开始时间: ${new Date().toISOString()}`);
    test.log.push('');

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

      // 处理 vus 数据：如果 vus.value 为 0，使用 vus_max 的值
      let vusData = summary.metrics?.vus || {};
      const vusMaxData = summary.metrics?.vus_max || {};
      if (vusData.value === 0 && vusMaxData.value > 0) {
        vusData = {
          value: vusMaxData.value,
          min: vusMaxData.min,
          max: vusMaxData.max
        };
        test.log.push(`[DEBUG] vus 为 0，使用 vus_max: ${vusMaxData.value}`);
      }

      test.metrics = {
        http_req_duration: summary.metrics?.http_req_duration || {},
        http_req_failed: summary.metrics?.http_req_failed || {},
        http_reqs: summary.metrics?.http_reqs || {},
        vus: vusData,
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
    // 测试执行失败（可能是阈值失败、超时或其他错误）
    test.status = 'failed';
    test.completedAt = new Date().toISOString();
    test.reportUrl = `/reports/${testId}-report.html`;

    // 详细的错误日志
    const errorMsg = `测试执行失败: ${error.message}`;
    test.log.push(errorMsg);

    // 如果是缓冲区溢出错误，给出具体提示
    if (error.message.includes('maxBuffer')) {
      test.log.push('提示: k6 输出内容过多，请检查测试脚本是否包含大量日志输出');
      test.log.push('建议: 减少 console.log 调用，或使用 --quiet 模式运行 k6');
    }

    // 尝试读取测试结果（即使测试失败，summary 文件可能已生成）
    const reportFile = path.join(REPORTS_DIR, `${testId}-summary.json`);
    try {
      const summaryData = await fs.readFile(reportFile, 'utf8');
      const summary = JSON.parse(summaryData);

      // 处理 vus 数据
      let vusData = summary.metrics?.vus || {};
      const vusMaxData = summary.metrics?.vus_max || {};
      if (vusData.value === 0 && vusMaxData.value > 0) {
        vusData = {
          value: vusMaxData.value,
          min: vusMaxData.min,
          max: vusMaxData.max
        };
      }

      test.metrics = {
        http_req_duration: summary.metrics?.http_req_duration || {},
        http_req_failed: summary.metrics?.http_req_failed || {},
        http_reqs: summary.metrics?.http_reqs || {},
        vus: vusData,
        data_received: summary.metrics?.data_received || {},
        data_sent: summary.metrics?.data_sent || {}
      };
      test.log.push('✓ 测试结果解析成功（测试失败但数据已收集）');
    } catch (e) {
      test.log.push(`✗ 读取结果文件失败: ${e.message}`);
    }

    // 即使测试失败，也生成 HTML 报告
    try {
      await generateHtmlReport(testId, test);
      test.log.push('✓ HTML 报告已生成');
    } catch (reportError) {
      test.log.push(`✗ 生成报告失败: ${reportError.message}`);
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
  let failedRate = getVal('http_req_failed', 'rate');
  let totalReqs = getVal('http_reqs', 'count');

  // 确保值是数字
  failedRate = (failedRate !== null && !isNaN(failedRate)) ? parseFloat(failedRate) : null;
  totalReqs = (totalReqs !== null && !isNaN(totalReqs)) ? parseInt(totalReqs) : 0;

  let successRate;
  if (failedRate !== null && !isNaN(failedRate)) {
    successRate = ((1 - failedRate) * 100).toFixed(2);
  } else if (totalReqs > 0) {
    successRate = '100.00';
  } else {
    successRate = 'N/A';
  }

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
        <span class="label">配置说明</span>
        <span class="value">由脚本代码控制</span>
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
