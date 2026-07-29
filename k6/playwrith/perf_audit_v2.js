/**
 * perf_audit_v2.js —— 准确版前端渲染性能审计（按"一局"拆分重排/重绘/样式重算）
 *
 * 数据来源都用 Chrome DevTools 同源的 CDP 权威接口，不用 rAF(会被后台节流污染)：
 *   ① Performance.getMetrics —— Blink 内部计数器：LayoutCount/LayoutDuration(重排)、
 *      RecalcStyleCount/RecalcStyleDuration(样式重算)、ScriptDuration、Nodes/LayoutObjects、JSHeap。
 *      每 250ms 采一次，按局取【差值】= 该局的准确重排/重算次数与耗时。
 *   ② Tracing(devtools.timeline) —— 真实事件：Paint(重绘)、DrawFrame(真实呈现帧)、Composite。
 *      等 tracingComplete 再收（不固定 2s，避免大 trace 被截断），并禁后台节流保证数据准确。
 *
 * 每局边界：页面里轮询倒计时(span.animate-countdown-number-pulse)，回升即新局 → performance.mark('ROUND_START')
 *          （mark 落进 trace，用于按局切分重绘/帧）；同时把 Date.now() 推入 window.__rounds 供 getMetrics 对齐。
 *
 * 用法：
 *   node perf_audit_v2.js
 *   AUDIT_MS=60000 node perf_audit_v2.js          # 采集 60s
 *   AUDIT_URL="https://..." node perf_audit_v2.js  # 换目标
 *   HEADLESS=1 node perf_audit_v2.js               # 无头(也不受窗口失焦影响)
 */
const { chromium } = require('playwright');
const fs = require('fs');

const TARGET_URL = process.env.AUDIT_URL ||
  'https://updownland.pages.dev/?token=31333235395f42574d39684d63506330394f5076396c3358754b3978624b31654b44714e586453474d6834684652335a493d&operator=arspribetest&lang=en';
const DURATION_MS = parseInt(process.env.AUDIT_MS || '40000', 10);
const SAMPLE_MS = parseInt(process.env.SAMPLE_MS || '250', 10);
const HEADLESS = process.env.HEADLESS === '1';

async function run() {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      '--enable-precise-memory-info',
      '--no-sandbox',
      // 关键：禁止后台/失焦节流，否则窗口一失焦 rAF/timer 被节流 → 性能数据全废(上一版的坑)
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const client = await context.newCDPSession(page);

  // 注入：检测每局边界 + 记录图表数据点数（判断"硬拼接/越画越多"）
  await page.addInitScript(() => {
    window.__rounds = [];  // 每局开始的 Date.now()
    window.__series = [];  // { t, pts, dlen, cd } 图表线点数随时间
    let lastCd = null;
    setInterval(() => {
      const el = document.querySelector('span.animate-countdown-number-pulse');
      const cd = el ? parseInt((el.textContent || '').trim(), 10) : NaN;
      if (!isNaN(cd)) {
        if (lastCd !== null && cd > lastCd) {
          // 倒计时回升 = 新的一局
          window.__rounds.push(Date.now());
          try { performance.mark('ROUND_START'); } catch (e) {}
        }
        lastCd = cd;
      }
      const p = document.querySelector('path.visx-linepath');
      const d = p ? (p.getAttribute('d') || '') : '';
      window.__series.push({ t: Date.now(), pts: (d.match(/[MLC]/gi) || []).length, dlen: d.length, cd });
    }, 100);
  });

  await client.send('Performance.enable');

  // 开 trace（真实 Paint/Frame/Composite 事件 + 我们的 ROUND_START mark）
  await client.send('Tracing.start', {
    transferMode: 'ReportEvents',
    categories: [
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'disabled-by-default-devtools.timeline.frame',
      'blink.user_timing',
    ].join(','),
  });

  console.log(`🌐 打开页面: ${TARGET_URL}`);
  try {
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.warn('⚠️ goto 未完全就绪(实时页常见)，继续采集:', e.message);
  }
  await page.waitForTimeout(3000); // 等图表首帧稳定

  // getMetrics 时间序列（Node 侧，不受页面节流影响 → 准确）
  const metricSamples = [];
  const KEYS = ['LayoutCount', 'LayoutDuration', 'RecalcStyleCount', 'RecalcStyleDuration',
    'ScriptDuration', 'TaskDuration', 'Nodes', 'LayoutObjects', 'JSHeapUsedSize'];
  async function sampleMetrics() {
    try {
      const { metrics } = await client.send('Performance.getMetrics');
      const m = { wall: Date.now() };
      metrics.forEach((x) => { if (KEYS.includes(x.name)) m[x.name] = x.value; });
      metricSamples.push(m);
    } catch (e) {}
  }

  console.log(`⏱️ 采集 ${DURATION_MS / 1000}s（每 ${SAMPLE_MS}ms 采一次 getMetrics）...`);
  await sampleMetrics();
  const sampler = setInterval(sampleMetrics, SAMPLE_MS);
  await page.waitForTimeout(DURATION_MS);
  clearInterval(sampler);
  await sampleMetrics();

  // 收 trace：等 tracingComplete，别固定等 2s（大 trace 会被截断）
  console.log('📦 收集 trace（等待 tracingComplete）...');
  const traceEvents = [];
  client.on('Tracing.dataCollected', (d) => traceEvents.push(...d.value));
  const complete = new Promise((resolve) => client.once('Tracing.tracingComplete', resolve));
  await client.send('Tracing.end');
  await complete;

  const rounds = await page.evaluate(() => window.__rounds);
  const series = await page.evaluate(() => window.__series);

  fs.writeFileSync('performance_trace.json', JSON.stringify({ traceEvents }));
  await browser.close();

  analyze({ metricSamples, traceEvents, rounds, series });
}

// ============ 分析 ============
function analyze({ metricSamples, traceEvents, rounds, series }) {
  const line = '='.repeat(70);
  console.log(`\n${line}\n  📊 前端渲染性能审计（准确版·按局拆分）\n${line}`);

  // 大数组求极值用 reduce，避免 Math.max(...bigArray) 爆栈
  const arrMax = (a) => a.reduce((m, x) => (x > m ? x : m), -Infinity);
  const arrMin = (a) => a.reduce((m, x) => (x < m ? x : m), Infinity);

  // —— 数据点数趋势：硬拼接/越画越多？——
  const pts = series.map((s) => s.pts).filter((n) => n > 0);
  const ptsMin = arrMin(pts), ptsMax = arrMax(pts);
  let resets = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i] < pts[i - 1] - 30) resets++;
  const grew = pts.length > 2 && pts[pts.length - 1] > pts[0] + 50 && resets === 0;

  // —— 局边界（wall）：优先倒计时检测；不足则退回固定 ROUND_MS 窗口 ——
  const ROUND_MS = parseInt(process.env.ROUND_MS || '5000', 10);
  let roundBounds = rounds.slice();
  let roundSrc = '倒计时重置';
  if (roundBounds.length < 3 && metricSamples.length > 1) {
    roundBounds = [];
    const t0 = metricSamples[0].wall, t1 = metricSamples[metricSamples.length - 1].wall;
    for (let t = t0; t <= t1; t += ROUND_MS) roundBounds.push(t);
    roundSrc = `固定${ROUND_MS / 1000}s窗口(未检到倒计时局边界)`;
  }

  // —— getMetrics 按局差值（重排/重算/脚本）——
  const roundStats = [];
  const at = (wall) => {
    // 取 wall 时间点最近的一条 metric 采样
    let best = metricSamples[0];
    for (const m of metricSamples) if (Math.abs(m.wall - wall) < Math.abs(best.wall - wall)) best = m;
    return best;
  };
  for (let i = 0; i < roundBounds.length - 1; i++) {
    const a = at(roundBounds[i]), b = at(roundBounds[i + 1]);
    if (!a || !b) continue;
    const durS = (roundBounds[i + 1] - roundBounds[i]) / 1000;
    roundStats.push({
      idx: i + 1,
      durS: +durS.toFixed(2),
      layoutN: b.LayoutCount - a.LayoutCount,                                  // 重排次数
      layoutMs: +((b.LayoutDuration - a.LayoutDuration) * 1000).toFixed(1),    // 重排耗时
      recalcN: b.RecalcStyleCount - a.RecalcStyleCount,                        // 样式重算次数
      recalcMs: +((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000).toFixed(1),
      scriptMs: +((b.ScriptDuration - a.ScriptDuration) * 1000).toFixed(1),    // 脚本耗时
      taskMs: +((b.TaskDuration - a.TaskDuration) * 1000).toFixed(1),          // 主线程占用
      nodes: b.Nodes,
      layoutObjects: b.LayoutObjects,
      heapMB: +(b.JSHeapUsedSize / 1048576).toFixed(1),
    });
  }

  // —— trace：Paint/DrawFrame/Composite 总量 + 按 ROUND_START 切分 ——
  const evX = traceEvents.filter((e) => e.ph === 'X' && typeof e.dur === 'number');
  const sumByName = (name) => {
    const es = evX.filter((e) => e.name === name);
    return { n: es.length, ms: +(es.reduce((s, e) => s + e.dur, 0) / 1000).toFixed(1) };
  };
  const paint = sumByName('Paint');
  const layoutTrace = sumByName('Layout');
  const recalcTrace = sumByName('UpdateLayoutTree');
  const composite = sumByName('Composite Layers');
  const drawFrames = traceEvents.filter((e) => e.name === 'DrawFrame').length;
  const roundMarks = traceEvents.filter((e) => e.name === 'ROUND_START' && /user_timing/.test(e.cat || '')).map((e) => e.ts).sort((a, b) => a - b);
  const evTs = evX.map((e) => e.ts);
  const traceSpanS = evX.length ? (arrMax(evTs) - arrMin(evTs)) / 1e6 : 0;

  // 每局重绘/帧（trace 按 ROUND_START mark 切分；不足则退回固定窗口）
  let paintBounds = roundMarks.slice();
  if (paintBounds.length < 3 && evX.length) {
    const lo = arrMin(evTs), hi = arrMax(evTs);
    paintBounds = [];
    for (let t = lo; t <= hi; t += ROUND_MS * 1000) paintBounds.push(t);
  }
  const perRoundPaint = [];
  for (let i = 0; i < paintBounds.length - 1; i++) {
    const t0 = paintBounds[i], t1 = paintBounds[i + 1];
    const inR = (e) => e.ts >= t0 && e.ts < t1;
    const pes = evX.filter((e) => e.name === 'Paint' && inR(e));
    const frames = traceEvents.filter((e) => e.name === 'DrawFrame' && inR(e)).length;
    const durS = (t1 - t0) / 1e6;
    perRoundPaint.push({
      idx: i + 1, durS: +durS.toFixed(2),
      paintN: pes.length, paintMs: +(pes.reduce((s, e) => s + e.dur, 0) / 1000).toFixed(1),
      frames, fps: durS > 0 ? +(frames / durS).toFixed(1) : 0,
    });
  }

  // —— 输出 ——
  console.log(`\n采集时长≈${traceSpanS.toFixed(0)}s；倒计时检到 ${rounds.length} 个局边界；分局依据: ${roundSrc}\n`);

  console.log('① 全程总量（trace，DevTools 同源）：');
  console.log(`   重排 Layout        : ${layoutTrace.n} 次 / ${layoutTrace.ms} ms`);
  console.log(`   样式重算 Recalc    : ${recalcTrace.n} 次 / ${recalcTrace.ms} ms`);
  console.log(`   重绘 Paint         : ${paint.n} 次 / ${paint.ms} ms`);
  console.log(`   合成 Composite     : ${composite.n} 次 / ${composite.ms} ms`);
  console.log(`   真实呈现帧 DrawFrame: ${drawFrames} 帧 → 平均 ${traceSpanS > 0 ? (drawFrames / traceSpanS).toFixed(1) : 0} fps`);

  if (roundStats.length) {
    console.log('\n② 每局重排/重算/脚本（getMetrics 差值，准确计数）：');
    console.log('   局 | 时长s | 重排次 | 重排ms | 重算次 | 重算ms | 脚本ms | 主线程ms | 节点 | LayoutObj | 堆MB');
    for (const r of roundStats) {
      console.log(`   ${String(r.idx).padStart(2)} | ${String(r.durS).padStart(5)} | ${String(r.layoutN).padStart(6)} | ${String(r.layoutMs).padStart(6)} | ${String(r.recalcN).padStart(6)} | ${String(r.recalcMs).padStart(6)} | ${String(r.scriptMs).padStart(6)} | ${String(r.taskMs).padStart(8)} | ${String(r.nodes).padStart(4)} | ${String(r.layoutObjects).padStart(9)} | ${r.heapMB}`);
    }
    const avg = (f) => (roundStats.reduce((s, r) => s + f(r), 0) / roundStats.length).toFixed(1);
    console.log(`   平均: 重排 ${avg((r) => r.layoutN)}次/${avg((r) => r.layoutMs)}ms | 重算 ${avg((r) => r.recalcN)}次/${avg((r) => r.recalcMs)}ms | 脚本 ${avg((r) => r.scriptMs)}ms | 主线程 ${avg((r) => r.taskMs)}ms`);
  } else {
    console.log('\n② 未能按局对齐 getMetrics（局边界不足，倒计时选择器可能需调整）');
  }

  if (perRoundPaint.length) {
    console.log('\n③ 每局重绘/帧（trace 按 ROUND_START 切分）：');
    console.log('   局 | 时长s | 重绘次 | 重绘ms | 帧数 | fps');
    for (const r of perRoundPaint) {
      console.log(`   ${String(r.idx).padStart(2)} | ${String(r.durS).padStart(5)} | ${String(r.paintN).padStart(6)} | ${String(r.paintMs).padStart(6)} | ${String(r.frames).padStart(4)} | ${r.fps}`);
    }
  }

  console.log('\n④ 数据模型（硬拼接/越画越多？）：');
  console.log(`   图表线点数范围: ${ptsMin} ~ ${ptsMax}，明显回落(重置)次数: ${resets}`);
  console.log(`   判定: ${grew ? '❌ 单调增长、无回落 → 疑似硬拼接不裁剪' : '✅ 有界/周期性重置 → 滚动窗口，非无限拼接'}`);

  console.log(`\n${line}`);
  console.log('📁 trace 已存 performance_trace.json（Chrome DevTools → Performance → Load profile 可导入核对）');
  console.log(line + '\n');
}

run().catch((e) => { console.error('❌ 审计失败:', e); process.exit(1); });
