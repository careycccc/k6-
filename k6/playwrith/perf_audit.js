const { chromium } = require('playwright');
const fs = require('fs');

async function runPerformanceAudit() {
  // 1. 从命令行获取 URL
  // const targetUrl = process.argv[2];
  const targetUrl = 'https://updownland.pages.dev/?token=31333235395f42574d39684d63506330394f5076396c3358754b3978624b31654b44714e586453474d6834684652335a493d&operator=arspribetest&lang=en';
//   if (!targetUrl) {
//     console.error('❌ 请传入目标 URL！示例：node perf_audit.js "https://example.com"');
//     process.exit(1);
//   }

  console.log('🚀 启动 Chromium 浏览器，准备开始性能采能...');
  const browser = await chromium.launch({
    headless: false, // 设为 false 可观察页面，如需后台静默跑可改为 true
    args: ['--enable-precise-memory-info', '--no-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();

  // 2. 建立 CDP 通道，用于底层性能抓取
  const cdpSession = await context.newCDPSession(page);
  
  // 3. 在页面注入 FPS 和 LongTask (主线程阻塞) 监控代码
  await page.addInitScript(() => {
    window.__perfMetrics = {
      longTasks: [],
      fpsList: [],
      minFps: 60,
      frameCount: 0
    };

    // 监听 Long Task (超过 50ms 的主线程阻塞)
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__perfMetrics.longTasks.push({
          duration: entry.duration,
          startTime: entry.startTime
        });
      }
    });
    observer.observe({ entryTypes: ['longtask'] });

    // 计算实时 FPS
    let lastTime = performance.now();
    function calcFPS() {
      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;
      const currentFps = Math.round(1000 / delta);
      
      if (currentFps > 0 && currentFps <= 60) {
        window.__perfMetrics.fpsList.push(currentFps);
        if (currentFps < window.__perfMetrics.minFps) {
          window.__perfMetrics.minFps = currentFps;
        }
      }
      requestAnimationFrame(calcFPS);
    }
    requestAnimationFrame(calcFPS);
  });

  console.log(`🌐 正在打开页面: ${targetUrl}`);
  
  // 4. 开启 CDP 底层 Performance Tracing
  await cdpSession.send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,v8.execute',
    options: 'sampling-frequency=10000'
  });

  await page.goto(targetUrl, { waitUntil: 'networkidle' });

  console.log('⏱️ 正在采集 18 秒的运行数据（覆盖完整 3 局结算周期）...');
  
  // 保持页面运行 25 秒
  await page.waitForTimeout(25000);

  // 5. 停止 CDP Tracing 并保存文件
  console.log('📦 正在导出 CDP Performance Trace 文件...');
  const traceEvents = [];
  cdpSession.on('Tracing.dataCollected', (data) => {
    traceEvents.push(...data.value);
  });

  await cdpSession.send('Tracing.end');
  
  // 等待 Tracing 事件全量收集完成
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // 6. 提取前端收集到的性能指标
  const metrics = await page.evaluate(() => window.__perfMetrics);
  const cdpMetrics = await cdpSession.send('Performance.getMetrics');

  // 保存 trace.json (开发可直接拖入 Chrome 开发者工具查看)
  fs.writeFileSync('performance_trace.json', JSON.stringify({ traceEvents }));

  await browser.close();

  // 7. 打印终极性能报告
  printReport(metrics, cdpMetrics.metrics);
}

function printReport(metrics, rawCdpMetrics) {
  const getMetric = (name) => rawCdpMetrics.find(m => m.name === name)?.value || 0;

  const totalLongTasks = metrics.longTasks.length;
  const maxLongTaskDuration = totalLongTasks > 0 
    ? Math.max(...metrics.longTasks.map(t => t.duration)).toFixed(2)
    : 0;
  
  const avgFps = metrics.fpsList.length > 0
    ? (metrics.fpsList.reduce((a, b) => a + b, 0) / metrics.fpsList.length).toFixed(1)
    : 0;

  const layoutCount = getMetric('LayoutCount');
  const recalcStyleCount = getMetric('RecalcStyleCount');
  const jsHeapUsedMB = (getMetric('JSHeapUsedSize') / 1024 / 1024).toFixed(2);

  console.log('\n======================================================');
  console.log('         📊 高频交易图表 - 自动化性能评估报告          ');
  console.log('======================================================\n');
  
  console.log(`1️⃣  帧率表现 (FPS)`);
  console.log(`   - 平均 FPS: ${avgFps} fps`);
  console.log(`   - 最低 FPS (掉帧谷值): ${metrics.minFps} fps  ${metrics.minFps < 30 ? '❌ (存在严重卡顿)' : '✅'}`);

  console.log(`\n2️⃣  主线程阻塞 (Main Thread Long Tasks)`);
  console.log(`   - 阻塞任务总次数 (>50ms): ${totalLongTasks} 次  ${totalLongTasks > 5 ? '❌ (高频阻塞)' : '✅'}`);
  console.log(`   - 单次最大阻塞时长: ${maxLongTaskDuration} ms  ${maxLongTaskDuration > 200 ? '❌ (肉眼可见冻结)' : '✅'}`);

  console.log(`\n3️⃣  DOM 渲染与重排重绘 (Rendering Bottlenecks)`);
  console.log(`   - Layout 样式重排次数: ${layoutCount} 次`);
  console.log(`   - Recalculate Style 重算次数: ${recalcStyleCount} 次  ${recalcStyleCount > 500 ? '❌ (SVG 高频重绘开销极高)' : '✅'}`);
  console.log(`   - JS 内存占用: ${jsHeapUsedMB} MB`);

  console.log('\n------------------------------------------------------');
  console.log('💡 结论与重构建议：');
  if (totalLongTasks > 5 || metrics.minFps < 30 || recalcStyleCount > 500) {
    console.log('❌ 【判定不合格】：图表高频更新引发严重的 CPU 主线程阻塞与 DOM 重排。');
    console.log('👉 重构建议：');
    console.log('   1. 将 SVG (visx) 渲染引擎更换为 HTML5 Canvas。');
    console.log('   2. 引入 RequestAnimationFrame + 连续数据 Buffer 解耦网络结算与帧率渲染。');
  } else {
    console.log('✅ 【判定合格】：性能指标良好。');
  }
  console.log('------------------------------------------------------');
  console.log('📁 铁证文件已生成: performance_trace.json');
  console.log('👉 用法：打开 Chrome DevTools -> Performance -> 点击右上角“Load profile”，导入此文件即可！\n');
}

runPerformanceAudit();