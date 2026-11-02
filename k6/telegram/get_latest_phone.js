/**
 * get_latest_phone.js —— 获取指定群里"最近一条"验证码转发消息里的手机号
 *
 * 场景：群里有个机器人（比如 arsimcodebot）把收到的短信验证码转发进群，格式类似：
 *   📨 收到验证码短信
 *   🕐 时间：2026-10-31 14:17:01
 *   📱 接收方：+918520971700
 *   👤 发件人：JX-PHONE-S
 *   💬 内容：Your OTP for login on PhonePe is 16052...
 *   🔢 验证码：16052
 * 号码是轮换使用的，只有"最近一条"消息里的手机号才是当前真正有效、可以接
 * 验证码的——不是去收集历史上出现过的所有号码。所以这里从最新消息开始往前
 * 找，命中第一条带"接收方"字段的消息就停止，不用也不该继续往更早翻。
 *
 * 只读操作：只拉取/解析消息，不会发送任何内容，不会被群里其他人看到任何动静。
 *
 * 运行方式（在 k6/telegram/ 目录下）：
 *   TG_CHAT_ID=-4993701398 node get_latest_phone.js
 *   TG_CHAT_ID=-4993701398 LIMIT=200 node get_latest_phone.js   # 最近几条都没有号码时，加大搜索范围(默认50)
 *
 * TG_CHAT_ID 就是 listen.js 打印出来的 chatId（带负号的那个数字）。
 */

const fs = require('fs');
const path = require('path');

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
const CHAT_ID = process.env.TG_CHAT_ID; // 必填，如 -4993701398
const LIMIT = parseInt(process.env.LIMIT || '50', 10); // 只找最近一条，不需要拉太多
const OUT_FILE = path.join(__dirname, 'latest_phone.txt');

if (!API_ID || !API_HASH) {
  console.error('[最近号码] 缺少 TG_API_ID / TG_API_HASH，配置方式见 login.js 头部注释。');
  process.exit(1);
}
if (!fs.existsSync(SESSION_FILE)) {
  console.error('[最近号码] 还没有登录过，请先运行: node login.js');
  process.exit(1);
}
if (!CHAT_ID) {
  console.error('[最近号码] 请用 TG_CHAT_ID 指定要查询的群（listen.js 打印出的 chatId，形如 -4993701398）。');
  console.error('[最近号码] 用法: TG_CHAT_ID=-4993701398 node get_latest_phone.js');
  process.exit(1);
}

// "接收方：+918520971700" 这种固定字段，容忍全角/半角冒号、前后空格
const PHONE_LINE = /接收方[：:]\s*(\+?\d{6,15})/;

async function main() {
  const { TelegramClient } = require('teleproto');
  const { StringSession } = require('teleproto/sessions');

  const sessionStr = fs.readFileSync(SESSION_FILE, 'utf-8').trim();
  const session = new StringSession(sessionStr);
  const client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
  });

  await client.connect();
  console.log(`[最近号码] ✅ 已连接，正在 chatId=${CHAT_ID} 里查找最近一条带手机号的消息（最多往前翻 ${LIMIT} 条）...`);

  const entity = await client.getEntity(CHAT_ID);
  const messages = await client.getMessages(entity, { limit: LIMIT }); // 默认新到旧排序

  let found = null;
  for (const msg of messages) {
    const text = msg.message || '';
    const m = text.match(PHONE_LINE);
    if (m) {
      found = {
        phone: m[1],
        time: msg.date ? new Date(msg.date * 1000).toLocaleString('zh-CN') : '',
        msgId: msg.id,
      };
      break; // 新到旧遍历，第一个命中的就是最新的，找到立刻停，不往更早翻
    }
  }

  if (!found) {
    console.error(`[最近号码] 在最近 ${messages.length} 条消息里没找到任何"接收方"手机号字段。`);
    console.error('[最近号码] 可能这个群最近没有新验证码转发，或者加大 LIMIT 再试（如 LIMIT=200）。');
    await client.disconnect();
    process.exit(1);
  }

  console.log(`\n[最近号码] ✅ 最近一条有效手机号: ${found.phone}`);
  console.log(`[最近号码]    消息时间: ${found.time}  msgId=${found.msgId}`);

  fs.writeFileSync(OUT_FILE, found.phone + '\n', 'utf-8');
  console.log(`\n[最近号码] ✅ 已写入 ${OUT_FILE}`);

  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('[最近号码] 运行失败:', err);
  process.exit(1);
});
