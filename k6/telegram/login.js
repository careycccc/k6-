/**
 * login.js —— Telegram 账号首次登录，生成并保存 session 字符串
 *
 * 用的是 MTProto 协议（teleproto，GramJS 的维护中 fork），以你自己的 Telegram
 * 账号身份登录（不是 Bot）——这样只要你是群的普通成员就能看到群里所有消息，
 * 不需要群主权限、也不受 Bot 隐私模式限制。
 *
 * 前置准备（必须先做，无法代劳）：
 *   1. 浏览器登录 https://my.telegram.org，用你自己的 Telegram 账号
 *   2. 进入 "API development tools"，创建一个应用（随便填名称/用途）
 *   3. 拿到 api_id（纯数字）和 api_hash（一串十六进制字符串）
 *   4. 在本目录（k6/telegram/）新建 .env 文件，写入：
 *        TG_API_ID=12345678
 *        TG_API_HASH=你的api_hash
 *      （.env 已经被 .gitignore 排除，不会被提交）
 *
 * 运行方式（在 k6/telegram/ 目录下）：
 *   node login.js
 * 然后按提示输入：
 *   - 手机号（带国家代码，如 +8613800138000）
 *   - 验证码（会发到你 Telegram 其他已登录设备的"Telegram"官方对话里，不是短信）
 *   - 如果开了两步验证，还会问密码
 *
 * 登录成功后，session 字符串会自动保存到本目录的 .session 文件——这个文件
 * 等同于你的账号登录凭据，谁拿到它都能以你的身份操作 Telegram，务必不要分享、
 * 不要提交到 git（.gitignore 已经排除）。之后运行 listen.js 等脚本时会自动
 * 读取这个文件，不需要重新输入手机号验证码。
 */

const fs = require('fs');
const path = require('path');
const { createInterface } = require('node:readline/promises');

// 尝试加载本目录下的 .env（装了 dotenv 就用，没装就手动读一遍，避免额外依赖门槛）
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

if (!API_ID || !API_HASH) {
  console.error('[Telegram登录] 缺少 TG_API_ID / TG_API_HASH。');
  console.error('[Telegram登录] 请先在 https://my.telegram.org 申请，然后在 k6/telegram/.env 里配置：');
  console.error('  TG_API_ID=你的api_id');
  console.error('  TG_API_HASH=你的api_hash');
  process.exit(1);
}

async function main() {
  const { TelegramClient } = require('teleproto');
  const { StringSession } = require('teleproto/sessions');

  // 已有 session 就复用（避免每次都重新走验证码流程）；没有就从空白开始
  const existing = fs.existsSync(SESSION_FILE) ? fs.readFileSync(SESSION_FILE, 'utf-8').trim() : '';
  const session = new StringSession(existing);

  const client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  await client.start({
    phoneNumber: () => rl.question('手机号(带国家代码，如 +8613800138000): '),
    password: () => rl.question('两步验证密码(没开就直接回车): '),
    phoneCode: (_, info) => rl.question(`验证码(${info && info.type ? info.type : 'app'}，去 Telegram 的 Telegram 官方对话里看): `),
    emailAddress: () => rl.question('登录邮箱(如果 Telegram 这么要求的话): '),
    emailVerification: async () => ({ type: 'code', code: await rl.question('邮箱验证码: ') }),
    onError: (err) => console.error('[Telegram登录] 错误:', err),
  });

  rl.close();

  const me = await client.getMe();
  console.log(`[Telegram登录] ✅ 登录成功: ${me.firstName || ''} ${me.lastName || ''} (@${me.username || '无用户名'}) id=${me.id}`);

  const sessionStr = client.session.save();
  fs.writeFileSync(SESSION_FILE, sessionStr, 'utf-8');
  console.log(`[Telegram登录] ✅ session 已保存到 ${SESSION_FILE}`);
  console.log('[Telegram登录] 之后运行 listen.js 会自动复用这个 session，不用再输验证码。');

  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('[Telegram登录] 运行失败:', err);
  process.exit(1);
});
