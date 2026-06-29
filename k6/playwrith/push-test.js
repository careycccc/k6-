const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

/**
 * 模拟单个客户端登录并监听 Firebase 推送
 * @param {string} username - 测试账号
 * @param {string} password - 测试密码
 */
async function simulateFirebaseClient(username, password) {
  console.log(`[启动] 正在初始化用户: ${username}...`);

  // ==========================================
  // 核心修复：为每个用户创建独立的持久化目录，避开无痕模式
  // ==========================================
  const userDataDir = path.join(__dirname, `.browser_profiles`, `profile_${username}`);
  
  // 确保目录存在（Playwright 会自动创建，但加一层保险比较好）
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  let context;
  try {
    // 1. 启动持久化上下文 (类似打开一个真实的、非无痕的独立 Chrome 窗口)
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false, // 测试阶段设为 false，压测时改 true
      permissions: ['notifications'],
      // 屏蔽一些无用的安全警告条
      args: ['--disable-infobars', '--disable-extensions'] 
    });

    // launchPersistentContext 默认会自动打开一个空白页，我们直接获取它
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    // 2. 监听控制台日志，精确匹配推送接收特征
    page.on('console', async (msg) => {
      const text = msg.text();

      // 前台推送收到（Firebase onMessage）
      if (text.includes('onMessageFn received foreground message')) {
        console.log(`\n=========================================`);
        console.log(`[🔥 前台推送] 接收账号: ${username}`);
        console.log(`[日志详情]: ${text}`);
        console.log(`=========================================\n`);
        return;
      }

      // Service Worker 推送展示（后台推送）
      if (text.includes('onMessageFn through Service Worker display notification')) {
        console.log(`\n=========================================`);
        console.log(`[🔔 SW推送] 接收账号: ${username}`);
        console.log(`[日志详情]: ${text}`);
        console.log(`=========================================\n`);
        return;
      }

      // EngageLab 收到 SW 消息（通用兜底）
      if (text.includes('收到 SW 消息') && !text.includes('未处理')) {
        console.log(`\n=========================================`);
        console.log(`[💬 SW消息] 接收账号: ${username}`);
        console.log(`[日志详情]: ${text}`);
        console.log(`=========================================\n`);
      }
    });

    // 3. 访问登录并操作
    await page.goto('https://arplatsaassit4.club/login');

    await page.waitForSelector('[data-testid="form-input-userName"]', { timeout: 10000 });
    await page.fill('[data-testid="form-input-userName"]', username);
    await page.fill('[data-testid="form-input-password"]', password);
    await page.click('[data-testid="login-submit-btn"]');

    await page.waitForLoadState('networkidle', { timeout: 15000 });
    
    console.log(`[就绪] 用户 ${username} 登录成功，正在等待推送...`);

    // 保持页面存活 (10分钟)
    await page.waitForTimeout(600000);

  } catch (error) {
    console.error(`[错误] 用户 ${username} 运行异常:`, error.message);
  } finally {
    // 脚本结束或出错时，关闭该用户的浏览器上下文
    if (context) {
      await context.close();
    }
  }
}

/**
 * 主函数：批量启动客户端
 */
async function main() {
  const testUsers = [
    { username: '6277373340', password: 'qwer1234' },
    // 添加更多账号...
  ];

  console.log(`开始启动 ${testUsers.length} 个模拟客户端...\n`);

  const promises = testUsers.map(user => 
    simulateFirebaseClient(user.username, user.password)
  );

  await Promise.all(promises);
  
  console.log(`\n✅ 所有客户端挂机结束。`);
}

main();