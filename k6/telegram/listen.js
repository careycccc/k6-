/**
 * listen.js —— 监听这个 Telegram 账号能看到的消息，打印到终端
 *
 * 先跑 login.js 完成一次登录（生成 .session），再跑这个脚本。
 *
 * 默认监听"所有对话"（群/频道/私聊都算），方便第一次先确认：
 *   1. 能不能正常连上、收到消息
 *   2. 自己到底在哪些群里、群的准确标题/chatId 是什么（后续要精确监听某个
 *      群时，用这里打印出来的 chatId 最可靠，群标题可能重名或者打印时被截断）
 *
 * 只想看某个群，用 TG_CHAT 环境变量按标题过滤（包含匹配，不区分大小写）：
 *   TG_CHAT=测试群 node listen.js
 *
 * 运行方式（在 k6/telegram/ 目录下）：
 *   node listen.js
 * 按 Ctrl+C 结束。
 *
 * 这一步只做"监听+打印"，不做任何自动回复——回复规则还没定，等定了再加。
 */

const fs = require('fs');
const path = require('path');

// 复用 login.js 同样的极简 .env 解析（装了 dotenv 也行，这里手动读一遍省得强制依赖它）
const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) {
  const lines = fs.readFileSync(ENV_FILE, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const API_ID = parseInt(process.env.TG_API_ID || '', 10);
const API_HASH = process.env.TG_API_HASH || '';
const SESSION_FILE = path.join(__dirname, '.session');
const CHAT_FILTER = (process.env.TG_CHAT || '').trim().toLowerCase();

if (!API_ID || !API_HASH) {
  console.error('[Telegram监听] 缺少 TG_API_ID / TG_API_HASH，配置方式见 login.js 头部注释。');
  process.exit(1);
}
if (!fs.existsSync(SESSION_FILE)) {
  console.error('[Telegram监听] 还没有登录过，请先运行: node login.js');
  process.exit(1);
}

async function main() {
  const { TelegramClient } = require('teleproto');
  const { StringSession } = require('teleproto/sessions');

  const sessionStr = fs.readFileSync(SESSION_FILE, 'utf-8').trim();
  const session = new StringSession(sessionStr);
  const client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
  });

  await client.connect();

  const me = await client.getMe();
  console.log(`[Telegram监听] ✅ 已连接，当前账号: ${me.firstName || ''} ${me.lastName || ''} (@${me.username || '无用户名'}) id=${me.id}`);
  console.log(CHAT_FILTER
    ? `[Telegram监听] 只打印标题包含"${CHAT_FILTER}"的对话消息`
    : '[Telegram监听] 未设置 TG_CHAT，打印所有能看到的对话消息（群/频道/私聊）');
  console.log('[Telegram监听] 开始监听，按 Ctrl+C 结束...\n');

  client.updates.on('newMessage', async (update) => {
    try {
      const msg = update.message;
      if (!msg) return;

      // 用异步的 getChat()/getSender()，不依赖可能还没缓存好的同步 getter
      const chat = (await msg.getChat()) || {};
      const sender = (await msg.getSender()) || {};

      const chatTitle = chat.title
        || [chat.firstName, chat.lastName].filter(Boolean).join(' ')
        || '未知对话';
      if (CHAT_FILTER && !String(chatTitle).toLowerCase().includes(CHAT_FILTER)) return;

      const senderName = sender.username
        ? `@${sender.username}`
        : ([sender.firstName, sender.lastName].filter(Boolean).join(' ') || '未知发送者');

      const time = msg.date ? new Date(msg.date * 1000).toLocaleString('zh-CN') : '';
      const text = msg.message || '(非文本消息，如图片/文件/贴纸)';

      console.log(`[${time}] [${chatTitle}] ${senderName}: ${text}`);
      console.log(`  └─ chatId=${msg.chatId} msgId=${msg.id}${msg.replyTo ? ` replyToMsgId=${msg.replyToMsgId}` : ''}\n`);
    } catch (e) {
      console.error('[Telegram监听] 处理消息时出错:', e.message);
    }
  });

  process.on('SIGINT', async () => {
    console.log('\n[Telegram监听] 收到退出信号，断开连接...');
    try { await client.disconnect(); } catch (e) { /* ignore */ }
    process.exit(0);
  });

  await new Promise(() => {}); // 保持进程存活，持续监听
}

main().catch((err) => {
  console.error('[Telegram监听] 运行失败:', err);
  process.exit(1);
});
