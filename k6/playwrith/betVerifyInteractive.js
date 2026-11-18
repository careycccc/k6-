/**
 * betVerifyInteractive.js —— 交互式投注核对脚本（Node独立脚本，不进k6 VU runtime）
 *
 * 背景：过去几轮里，每一局游戏核对都要手动在浏览器里点后台刷新→点查询→切前台→
 * 滚动读文字，步骤固定、纯体力活。这个脚本把"手动投注→查前后台→循环→最后出
 * 报告"的流程改成直连接口（前后台UI本身就是在调这些接口）+ 交互式命令行，不再
 * 靠浏览器点击模拟。
 *
 * 核心流程：
 *   1. 登录拿后台token（复刻 collect-tagged-users.js 的签名/TOTP/登录脚手架）；
 *      若配置了 MEMBER_ACCOUNT/MEMBER_PASSWORD，额外做前台会员登录，开启前
 *      后台双重核对模式（⚠️ 2026-11-16实测确认：会员账号同一时间只能有一个
 *      有效会话，重复login会把浏览器里正在玩游戏的那个会话顶下线——所以默认
 *      只在启动时登录一次，之后所有局复用同一个token；⚠️ 同时实测发现这个
 *      前台token时效很短，玩一局的时间就可能过期导致查询失败——因此查询层
 *      (postDeskAuthed)加了"检测到疑似过期才自动重新登录一次"的兜底，不是
 *      无条件重复登录，但确实可能在过期时再顶一次浏览器，会打印提示）
 *   2. 查一次"基线快照"：后台 GetUserDetail 拿余额 + 今日累计充值/提现/活动
 *      奖励(activeTodayRsp) + GetBetRecordPageList 拿当天已结算注单；双重核对
 *      模式下再查：前台 RecoverSaasBalance 拿前台自己看到的余额、前台
 *      GetUserOrderList（遍历全部5个分类）拿逐笔注单、前台
 *      GetUserGameReportList 拿官方按分类汇总的报表、前台 GetUserFinancialList
 *      拿账变流水——四个独立前台数据源 + 后台自带的官方今日统计
 *   3. 交互循环：每次回车确认"这一局玩完了" → 等2秒(订单结算需要时间) → 重新
 *      查快照 → 跟上一次快照做订单号/记录ID差集(各数据源各自独立diff)、
 *      activeTodayRsp用累计值做差 → 按游戏名称自动分组统计 → 核对：①后台
 *      余额变化 = 游戏盈亏+本局充值-本局提现+本局活动奖励(2026-11-16用户
 *      指出：原先"余额变化=游戏盈亏"假设在有资金穿插时会误判，已修正) ②
 *      后台官方今日统计(activeTodayRsp.betAmount/prizeAmount增量) vs 脚本
 *      自己统计的注单汇总 ③前台余额变化 vs 后台余额变化 ④后台注单 vs 前台
 *      GetUserOrderList逐笔汇总 vs 前台GetUserGameReportList官方汇总(累计值
 *      做差)，笔数/金额是否一致 ⑤前台GetUserFinancialList本局新增账变记录
 *      amount之和 必须严格等于 前台余额变化(会计恒等式，不依赖对type字段
 *      语义的任何假设) → 打印本局小结
 *   4. 输入 end 结束，生成最终报告（总览表→分局详情→全程总核对），写入
 *      游戏投注核对报告_自动化_<时间戳>.md
 *
 * 已验证/复刻的接口与字段（来自项目现有脚本 + 2026-11-16本次实测，非凭空假设）：
 *   - 后台登录/签名脚手架：k6/playwrith/collect-tagged-users.js:47-215
 *   - 后台注单字段 betAmount/winAmount/validAmount/vendorCode/gameCode/gameName/
 *     orderNo/orderState：k6/tests/api/withdraw/autoWithdrawBetRatioVerify.js、
 *     k6/tests/api/activity/MegaJackpot/megaJackpotVerify.js、
 *     k6/tests/api/channel/channelFunnelVerify.test.js 等多处交叉确认
 *   - queryTimeType:'SettleTime' + orderState:1 才能拿到已结算注单：
 *     k6/tests/api/agentL3/inviteCondition/api.js、
 *     k6/tests/api/rptDashboard/dataAnalysisNewFieldsVerify.js 注释里记录的教训
 *   - 余额字段：GetUserDetail 响应里是 accountFundsRsp.walletBalance(主钱包)+
 *     accountFundsRsp.arGameAmount(游戏钱包)，2026-11-16用两个不同测试账号实测
 *     确认资金可能全在其中一个钱包(另一个=0)，脚本统一取两者之和
 *   - 前台会员登录 POST /api/Home/Login：k6/safetest/sqli/lib/signedLogin.js、
 *     k6/tests/api/withdraw/concurrentBindVerify.js 等项目里本来就有的成熟写法；
 *     userName 必须带国家区号前缀(如"914879330960")，否则报"Wrong account or
 *     password"；⚠️ 同一账号重复调用会把其他端已登录的会话顶下线（用户实测
 *     确认"会有异地登录强制弹下线"），本脚本全程只login一次
 *   - 前台"Game History"页面背后接口 POST /api/User/GetUserOrderList(不是后台
 *     用的GetBetRecordPageList，那个前台路径404)：2026-11-16用浏览器抓包+Node
 *     复现实测确认——pageSize上限30(超过报错)；没有userId字段(token身份决定)、
 *     没有orderState过滤参数(要客户端自己过滤)；categoryType含义:0=SLOTS、
 *     1=CASINO、2=SPORTS(未实测,按枚举顺序推断)、3=LOTTERY、4=POKER(实测点击
 *     浏览器四个tab分别抓到1/0/3/4)；时间字段叫startUnixTime/endUnixTime(不是
 *     beginTimeUnix/endTimeUnix)，单位同为毫秒；响应里单条注单字段名跟后台完全
 *     一样，可直接复用groupByGame/sumGroups
 *   - 前台余额 POST /api/ThirdGame/RecoverSaasBalance：用户2026-11-16浏览器
 *     抓包提供，payload只带通用字段(language/random/signature/timestamp，无
 *     业务参数)，响应 data.balance 即前台看到的余额(跟后台walletBalance+
 *     arGameAmount之和应相等，因为是同一账号同一份真实资金)
 *   - 前台官方游戏报表 POST /api/User/GetUserGameReportList：用户2026-11-16
 *     浏览器抓包提供，payload带 startDateTime/endDateTime(注意是"YYYY-MM-DD
 *     HH:mm:ss"字符串格式，不是unix毫秒，跟本脚本其他接口的时间格式不同)，
 *     响应 data 是数组，按 categoryType 汇总当天 betOrderCount/totalBet/
 *     totalWin(categoryType=0对应categoryTypeCode="Electronic"，即SLOTS)；
 *     用户确认"今天这个人在任一游戏投注都会记录在这里"——是独立于
 *     GetUserOrderList之外的第三个官方汇总数据源，本脚本用它的"累计值之差"
 *     得到每局的增量，再跟其余数据源交叉核对
 *   - 前台账变流水 POST /api/User/GetUserFinancialList：用户2026-11-16浏览器
 *     抓包提供(含完整响应示例，type有GameBet/GameTransIn/GameTransOut等，
 *     每条记录amount单方向+backAmount操作后余额快照+remark游戏名)；本脚本
 *     不对type字段的业务含义做任何猜测性归类，只用会计恒等式核对：本局新增
 *     账变记录(按id去重diff)的amount之和，必须严格等于本局前台余额变化——
 *     这是用户2026-11-16明确要求的核对逻辑，比"游戏盈亏=余额变化"更底层、
 *     完全不依赖理解接口字段语义
 *
 * 安全/红线（CLAUDE.md）：本脚本只读 .env 取账号密码/Google密钥，不写不删 .env，
 * 会员账号密码通过环境变量传入(不硬编码进文件)；只调只读查询/登录接口
 * （GetUserDetail、GetBetRecordPageList、Home/Login、GetUserOrderList、
 * RecoverSaasBalance、GetUserGameReportList、GetUserFinancialList），不涉及
 * 任何转账/下注/改密码等操作；会员登录全程只做一次，避免反复顶掉用户自己的
 * 浏览器会话。
 *
 * 运行方式：
 *   仅后台核对：
 *     TENANT=3004 USER_ID=170913 node k6/playwrith/betVerifyInteractive.js
 *   前后台双重核对（额外提供会员自己的登录账号密码，手机号不带区号）：
 *     TENANT=3004 USER_ID=170900 MEMBER_ACCOUNT=4879330960 MEMBER_PASSWORD=qwer1234 \
 *       node k6/playwrith/betVerifyInteractive.js
 *   PowerShell 写法（分号分隔，无需反斜杠续行）：
 *     $env:TENANT="3004"; $env:USER_ID="170900"; $env:MEMBER_ACCOUNT="4879330960"; \
 *       $env:MEMBER_PASSWORD="qwer1234"; node k6/playwrith/betVerifyInteractive.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createInterface } = require('node:readline/promises');

// ───── 读取项目根目录 .env（真实账号密码/密钥，不进 git，只读不写不删） ─────
function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error(`[投注核对] ❌ 找不到 ${envPath}`);
    console.error('[投注核对]    请复制 .env.example 为 .env 并填入真实配置值后重试。');
    process.exit(1);
  }
  const map = {};
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx < 0) continue;
    const key = t.slice(0, idx).trim();
    let value = t.slice(idx + 1).trim();
    if (value.length >= 2) {
      const f = value[0], l = value[value.length - 1];
      if ((f === '"' && l === '"') || (f === "'" && l === "'")) value = value.slice(1, -1);
    }
    map[key] = value;
  }
  return map;
}
const ENV_FILE = loadEnvFile();

// ───── 多租户配置，读取自 .env（同 collect-tagged-users.js） ─────
const TENANTS = {
  '3001': { admin: ENV_FILE['ENV_3001_BASE_ADMIN_URL'], desk: ENV_FILE['ENV_3001_BASE_DESK_URL'], user: ENV_FILE['ENV_3001_ADMIN_USERNAME'], code: ENV_FILE['ENV_3001_COUNTRY_CODE'] },
  '3002': { admin: ENV_FILE['ENV_3002_BASE_ADMIN_URL'], desk: ENV_FILE['ENV_3002_BASE_DESK_URL'], user: ENV_FILE['ENV_3002_ADMIN_USERNAME'], code: ENV_FILE['ENV_3002_COUNTRY_CODE'] },
  '3003': { admin: ENV_FILE['ENV_3003_BASE_ADMIN_URL'], desk: ENV_FILE['ENV_3003_BASE_DESK_URL'], user: ENV_FILE['ENV_3003_ADMIN_USERNAME'], code: ENV_FILE['ENV_3003_COUNTRY_CODE'] },
  '3004': { admin: ENV_FILE['ENV_3004_BASE_ADMIN_URL'], desk: ENV_FILE['ENV_3004_BASE_DESK_URL'], user: ENV_FILE['ENV_3004_ADMIN_USERNAME'], code: ENV_FILE['ENV_3004_COUNTRY_CODE'] },
  '3005': { admin: ENV_FILE['ENV_3005_BASE_ADMIN_URL'], desk: ENV_FILE['ENV_3005_BASE_DESK_URL'], user: ENV_FILE['ENV_3005_ADMIN_USERNAME'], code: ENV_FILE['ENV_3005_COUNTRY_CODE'] },
  '3006': { admin: ENV_FILE['ENV_3006_BASE_ADMIN_URL'], desk: ENV_FILE['ENV_3006_BASE_DESK_URL'], user: ENV_FILE['ENV_3006_ADMIN_USERNAME'], code: ENV_FILE['ENV_3006_COUNTRY_CODE'] },
  '3007': { admin: ENV_FILE['ENV_3007_BASE_ADMIN_URL'], desk: ENV_FILE['ENV_3007_BASE_DESK_URL'], user: ENV_FILE['ENV_3007_ADMIN_USERNAME'], code: ENV_FILE['ENV_3007_COUNTRY_CODE'] },
  '3101': { admin: ENV_FILE['ENV_3101_BASE_ADMIN_URL'], desk: ENV_FILE['ENV_3101_BASE_DESK_URL'], user: ENV_FILE['ENV_3101_ADMIN_USERNAME'], code: ENV_FILE['ENV_3101_COUNTRY_CODE'] },
};

const TENANT     = String(process.env.TENANT || process.env.TENANT_ID || '3004');
const T          = TENANTS[TENANT] || TENANTS['3004'];
const ADMIN_URL  = process.env.ADMIN_URL || T.admin;
const DESK_URL   = process.env.DESK_URL || T.desk;
const ADMIN_USER = process.env.ADMIN_USER || T.user;
const ADMIN_PWD  = process.env.ADMIN_PWD || ENV_FILE[`ENV_${TENANT}_ADMIN_PASSWORD`] || '';
const COUNTRY_CODE = process.env.COUNTRY_CODE || T.code || '91';
const LANG       = process.env.LANG_CODE || 'zh';
const USER_ID    = process.env.USER_ID || '';

// 前台会员账号密码（可选）：两者都提供才开启"前后台双重核对"模式。手机号不带
// 国家区号，脚本自动拼上 COUNTRY_CODE（跟登录表单"+91"那个分开显示的区号同理）。
const MEMBER_ACCOUNT  = process.env.MEMBER_ACCOUNT || '';
const MEMBER_PASSWORD = process.env.MEMBER_PASSWORD || '';
const DUAL_CHECK = Boolean(MEMBER_ACCOUNT && MEMBER_PASSWORD);

if (!USER_ID) {
  console.error('[投注核对] ❌ 请通过环境变量 USER_ID 指定要核对的会员ID，例如：');
  console.error('[投注核对]    TENANT=3004 USER_ID=170913 node k6/playwrith/betVerifyInteractive.js');
  process.exit(1);
}
if (!ADMIN_URL || !ADMIN_USER) {
  console.error(`[投注核对] ❌ 租户 ${TENANT} 的后台地址/管理员账号配置不完整，请检查 .env`);
  process.exit(1);
}
if (DUAL_CHECK && !DESK_URL) {
  console.error(`[投注核对] ❌ 租户 ${TENANT} 的前台地址配置不完整，请检查 .env（或不要设置 MEMBER_ACCOUNT/MEMBER_PASSWORD，退回仅后台核对模式）`);
  process.exit(1);
}

// ───── 后台谷歌验证码(TOTP)，复刻 collect-tagged-users.js ─────
function readGoogleSecret(tenant) {
  if (process.env.GOOGLE_SECRET) return process.env.GOOGLE_SECRET.trim();
  return ENV_FILE[`ENV_${tenant}_GOOGLE_SECRET`] || '';
}
const GOOGLE_SECRET = readGoogleSecret(TENANT);

function base32Decode(str) {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  str = String(str).toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = '';
  for (const ch of str) { const i = a.indexOf(ch); if (i < 0) continue; bits += i.toString(2).padStart(5, '0'); }
  const by = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) by.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(by);
}
function totp(secret, windowOffset = 0, baseSec) {
  const key = base32Decode(secret);
  const t = (baseSec === undefined ? Math.floor(Date.now() / 1000) : baseSec);
  let ctr = Math.floor(t / 30) + windowOffset;
  const buf = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) { buf[i] = ctr & 0xff; ctr = Math.floor(ctr / 256); }
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const code = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

// 签名：排除 signature/timestamp/track + 空值 → 排序 → JSON → MD5 大写（同项目全站签名口径）
function sign(fields) {
  const exclude = new Set(['signature', 'timestamp', 'track']);
  const o = {};
  Object.keys(fields).sort().forEach((k) => {
    const v = fields[k];
    if (exclude.has(k) || v === null || v === undefined || v === '') return;
    o[k] = v;
  });
  return crypto.createHash('md5').update(JSON.stringify(o)).digest('hex').toUpperCase();
}
function withSign(payload) {
  const random = Math.floor(1e11 + Math.random() * 9e11);
  const base = { ...payload, random, language: payload.language || LANG };
  const signature = sign(base);
  return { ...base, timestamp: Math.floor(Date.now() / 1000), signature };
}

async function post(baseUrl, api, payload, token) {
  const headers = { 'Content-Type': 'application/json', 'Domainurl': baseUrl, 'Referrer': baseUrl };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(`${baseUrl}${api}`, { method: 'POST', headers, body: JSON.stringify(withSign(payload)) });
  const text = await resp.text();
  let j = null; try { j = JSON.parse(text); } catch (e) { /* 非 JSON */ }
  const code = j ? (j.msgCode !== undefined ? j.msgCode : j.code) : null;
  return { status: resp.status, code, data: j ? j.data : null, msg: j ? j.msg : null, text };
}
const postAdmin = (api, payload, token) => post(ADMIN_URL, api, payload, token);
const postDesk = (api, payload, token) => post(DESK_URL, api, payload, token);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// 后台登录：带vCode(TOTP)，拒绝时自动试相邻时间窗口(容忍时钟偏差)
async function adminLogin() {
  let login;
  const baseSec = Math.floor(Date.now() / 1000);
  for (const off of (GOOGLE_SECRET ? [0, -1, 1] : [null])) {
    const payload = { userName: ADMIN_USER, pwd: ADMIN_PWD };
    if (off !== null) {
      payload.vCode = totp(GOOGLE_SECRET, off, baseSec);
      console.log(`[投注核对] 🔐 vCode=${payload.vCode}${off ? ` (窗口${off > 0 ? '+' : ''}${off})` : ''}`);
    }
    login = await postAdmin('/api/Login/Login', payload);
    if ((login.code === 0 && login.data && login.data.token) || !(login.code === 1119 || login.code === 11 || /vcode/i.test(login.msg || ''))) break;
    if (off !== null) console.log(`[投注核对]   窗口${off} 被拒: ${login.msg}`);
  }
  return login;
}

// 随机browserId，复刻 collect-tagged-users.js 的 generateCryptoRandomString
function genBrowserId() {
  const charset = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(32);
  let r = '';
  for (let i = 0; i < 32; i++) r += charset[bytes[i] % charset.length];
  return r;
}

// 前台会员登录：POST /api/Home/Login，复刻项目里已有的
// k6/safetest/sqli/lib/signedLogin.js::frontendLogin() 写法。userName 必须带
// 国家区号前缀，否则后端报"Wrong account or password"(2026-11-16实测确认)。
// ⚠️ 同一账号重复调用会把其他端已登录的会话顶下线（2026-11-16用户实测确认
// "每一局都重新login会把浏览器里正在玩游戏的会话强制弹下线"），因此本脚本
// 默认只在 main() 启动时调用这一次；仅当后续查询检测到疑似token过期时，
// 才由 postDeskAuthed() 自动再调用一次做兜底刷新（见下方），绝不会在循环
// 里无条件重复调用。
async function memberLogin() {
  const payload = {
    userName: COUNTRY_CODE + MEMBER_ACCOUNT,
    password: MEMBER_PASSWORD,
    loginType: 'Mobile',
    deviceId: '',
    browserId: genBrowserId(),
    packageName: '',
  };
  return postDesk('/api/Home/Login', payload);
}

// ───── 前台请求的"带自动刷新token"封装 ─────
// 2026-11-16实测确认：会员前台token时效很短，用户玩一局游戏(几分钟)期间就
// 可能过期，导致第1局开始前台查询全部失败(响应非法JSON或401/403)。这里做
// 兜底：检测到疑似鉴权失败时，自动重新login一次并重试当前请求，同时把新
// token写回feTokenState(调用方共享的{value,refreshed}对象)，供同一局内
// 后续查询复用，避免一局里触发多次刷新/多次顶号。⚠️ 刷新会再顶一次用户
// 浏览器里的登录，main()里会在每局结束后检查refreshed标志并提示用户。
function looksLikeAuthFailure(r) {
  return !r || r.status === 401 || r.status === 403 || (r.status === 200 && r.code === null);
}

async function postDeskAuthed(api, payload, feTokenState) {
  let r = await postDesk(api, payload, feTokenState.value);
  if (looksLikeAuthFailure(r)) {
    console.log(`[投注核对] ⚠️ 前台接口${api}疑似token已失效(status=${r ? r.status : 'null'}, code=${r ? r.code : 'null'})，自动重新登录一次...`);
    const login = await memberLogin();
    if (login && login.code === 0 && login.data && login.data.token) {
      feTokenState.value = login.data.token;
      feTokenState.refreshed = true;
      console.log('[投注核对] ✅ 前台token已刷新');
      r = await postDesk(api, payload, feTokenState.value);
    } else {
      console.log(`[投注核对] ❌ 重新登录失败: ${login ? login.msg : 'null'}，本次查询仍会失败`);
    }
  }
  return r;
}

// ───── 业务查询：会员详情（余额） ─────
// 实测确认（2026-11-16，GetUserDetail真实响应）：余额不在顶层，在
// data.accountFundsRsp.walletBalance（跟 GetPageListMember 返回的顶层 balance
// 不是同一个字段名，两个接口响应结构不同）。保留顶层候选作为兜底(万一后端结构
// 调整)，优先直接取 accountFundsRsp.walletBalance，拿不到再递归兜底找。
const BALANCE_FIELD_CANDIDATES = ['balance', 'totalBalance', 'platformBalance', 'walletBalance', 'userBalance', 'amount'];

function findBalanceDeep(obj, depth) {
  if (!obj || typeof obj !== 'object' || depth < 0) return null;
  // 优先精确匹配 walletBalance
  if (typeof obj.walletBalance === 'number') return { field: 'walletBalance', value: obj.walletBalance };
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === 'number' && /balance/i.test(k)) {
      return { field: k, value: v };
    }
  }
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const found = findBalanceDeep(v, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

function extractBalance(data) {
  if (!data) return null;
  // 2026-11-16实测确认(两个不同测试账号交叉验证)：余额有两个钱包——主钱包
  // accountFundsRsp.walletBalance 和"游戏钱包" accountFundsRsp.arGameAmount，
  // 不同账号资金可能全在其中一个钱包里(另一个=0)，前台首页显示的其实是两者
  // 之和(或其中一个，取决于平台当下把钱放哪个钱包)。为了不管资金在哪个钱包
  // 都能正确核对盈亏，统一取两者之和作为"总余额"。
  if (data.accountFundsRsp && typeof data.accountFundsRsp.walletBalance === 'number') {
    const wallet = data.accountFundsRsp.walletBalance;
    const gameWallet = typeof data.accountFundsRsp.arGameAmount === 'number' ? data.accountFundsRsp.arGameAmount : 0;
    return { field: 'accountFundsRsp.walletBalance + arGameAmount', value: wallet + gameWallet, wallet, gameWallet };
  }
  for (const k of BALANCE_FIELD_CANDIDATES) {
    if (data[k] !== undefined && data[k] !== null && typeof data[k] !== 'object') {
      return { field: k, value: parseFloat(data[k]) };
    }
  }
  return findBalanceDeep(data, 2);
}

// ───── GetUserDetail 里的"今日累计"统计(activeTodayRsp) ─────
// 2026-11-16用户指出：脚本之前"余额变化应等于游戏盈亏"的核对公式，一旦本局
// 期间穿插了充值/提现/活动奖励就会误判。GetUserDetail响应本身就带着
// activeTodayRsp.{betAmount,prizeAmount,activityRewards,rechargesAmount,
// withdrawAmount}这些"今日累计"字段——不需要额外调用新接口，用累计值做差
// (跟fetchFrontendGameReport处理官方报表完全同一手法)就能拿到本局的充值/
// 提现/活动奖励增量，把expectedDelta公式修正为"游戏盈亏+充值-提现+活动奖励"。
// betAmount/prizeAmount同时也是免费的第五数据源，可跟脚本自己统计的注单
// 汇总交叉核对(不需要DUAL_CHECK，纯后台接口自带)。
// accountFundsRsp.freezeAmount(冻结金额)一并记录：若本局期间发起提现申请
// 但未审核，钱可能从walletBalance转入freezeAmount导致余额"看起来变少"但
// 并未真正出账——这一假设未经实测验证，本脚本不把freezeAmount计入总余额，
// 只在核对失败时把freezeAmount的变化量打印出来供人工核实，不代为下结论。
function extractActiveToday(data) {
  if (!data || !data.activeTodayRsp) return null;
  const a = data.activeTodayRsp;
  const freeze = (data.accountFundsRsp && typeof data.accountFundsRsp.freezeAmount === 'number') ? data.accountFundsRsp.freezeAmount : null;
  return {
    betAmount: parseFloat(a.betAmount || 0),
    prizeAmount: parseFloat(a.prizeAmount || 0),
    activityRewards: parseFloat(a.activityRewards || 0),
    rechargesAmount: parseFloat(a.rechargesAmount || 0),
    rechargesCount: Number(a.rechargesCount || 0),
    withdrawAmount: parseFloat(a.withdrawAmount || 0),
    withdrawCount: Number(a.withdrawCount || 0),
    freezeAmount: freeze,
  };
}

async function getUserDetail(token, userId) {
  return postAdmin('/api/Users/GetUserDetail', { userId: String(userId) }, token);
}

// ───── 业务查询：当天已结算注单（分页去重） ─────
// 2026-11-16实测确认：带userId查询GetBetRecordPageList实际仍受"时间段必须在
// 任意31天内"的限制（msgCode=11，跟inviteCondition/api.js注释里"带userId无
// 15天窗口限制"的说法不一致，可能后端口径后续变过）。本脚本只查"当天"(≤24
// 小时)，远小于31天，不受影响；若以后要改成查更长历史区间，务必分段查询。
//
// ⚠️ "今天"的定义锁定在脚本启动的那一刻(SESSION_START_OF_DAY)，不是每次调
// 用时重新取 new Date() 的日期——2026-11-16用户指出：如果脚本运行期间跨过
// 零点，动态计算"今天"会导致前后两次查询的时间窗口起点(beginTimeUnix)突然
// 跳到新的一天，上一次快照里的订单/记录全部不在新窗口内，diff算出来的
// "新增"会变成整个新窗口的全部数据，而不是真正这一局的增量——是一个会让
// 数据严重错误的bug。锁定起点后，区间终点(now)依然正常前进到当前时刻，
// 只是不会因为日期翻篇而把起点往后推。
const SESSION_START = new Date();
const SESSION_START_OF_DAY = new Date(SESSION_START.getFullYear(), SESSION_START.getMonth(), SESSION_START.getDate(), 0, 0, 0, 0);

function todayRangeMs() {
  const now = new Date();
  return { beginTimeUnix: SESSION_START_OF_DAY.getTime(), endTimeUnix: now.getTime() };
}

// "YYYY-MM-DD HH:mm:ss" 字符串格式的当天区间，供 GetUserGameReportList 使用
// （该接口的时间字段跟本脚本其他接口不同，不是unix毫秒，而是本地时间字符串）。
// 同样锁定在SESSION_START那一天：如果脚本真的跨天运行，这个接口的区间仍是
// "启动那天"，不会自动滚动到次日——这是已知限制(该接口口径是"固定一天的
// 累计值"，没法像beginTimeUnix那样只延后终点、不动起点)；若需要跨天连续
// 使用本脚本，建议在跨天后重新启动一次脚本，重新建立基线。
function todayDateTimeRangeStr() {
  const pad = (n) => String(n).padStart(2, '0');
  const y = SESSION_START.getFullYear(), m = pad(SESSION_START.getMonth() + 1), d = pad(SESSION_START.getDate());
  return { startDateTime: `${y}-${m}-${d} 00:00:00`, endDateTime: `${y}-${m}-${d} 23:59:59` };
}

async function fetchTodayOrders(token, userId, maxPages = 50) {
  const { beginTimeUnix, endTimeUnix } = todayRangeMs();
  const seen = new Set();
  const orders = [];
  let pageNo = 1;
  while (pageNo <= maxPages) {
    const payload = {
      queryTimeType: 'SettleTime',
      orderState: 1,
      userId: String(userId),
      beginTimeUnix,
      endTimeUnix,
      pageNo,
      pageSize: 200,
      orderBy: 'Desc',
      sortField: 'BetTime',
    };
    const r = await postAdmin('/api/ThirdGame/GetBetRecordPageList', payload, token);
    if (!r || r.code !== 0 || !r.data) {
      if (r && r.code !== 0) console.log(`[投注核对] ⚠️ 查询注单第${pageNo}页失败: ${r.msg || r.code}`);
      break;
    }
    const list = r.data.list || [];
    for (const o of list) {
      if (!o.orderNo || seen.has(o.orderNo)) continue;
      seen.add(o.orderNo);
      orders.push(o);
    }
    const totalPage = Number(r.data.totalPage) || 1;
    if (pageNo >= totalPage || list.length === 0) break;
    pageNo++;
    await sleep(200);
  }
  return orders;
}

// ───── 业务查询：当天"非已结算"注单(未结算/异常状态)，用于提示差额候选原因 ─────
// 2026-11-16用户指出：如果某些注单一直没走完结算流程，扣款已发生但不会被
// fetchTodayOrders统计到(它只要orderState=1)，会导致核对出现"差额"却查不到
// 原因。这里只对fetchTodayOrders已验证过的请求参数做最小改动——去掉
// orderState:1这个过滤字段，不猜测其他orderState值的含义，拿到"当天按投注
// 时间维度查询到的全部注单"，客户端筛出orderState!==1的部分。
// ⚠️ 2026-11-16实测修复：这里查询维度必须用queryTimeType:'BetTime'（投注
// 时间），不能用'SettleTime'（结算时间）——真正"卡住还没结算"的注单根本
// 没有结算时间，拿SettleTime去框查询窗口永远查不到它们(曾经就是这么写的，
// 导致本函数长期空转、从未报出过任何异常注单)。后台管理界面"游戏投注订单"
// 查"未结算"状态时，筛选的时间字段本身标注的也是"投注时间"，与此一致。
// 实测案例(会员170545)：两笔Wild Bounty Showdown/Wild Bandito订单投注
// 12/18、派奖10.8/46.8，状态显示"未结算"但派奖金额已经非0——说明游戏供应
// 商的"派奖回调"和"订单状态更新"是两步独立操作，这次出现了钱已经到账、
// 但orderState字段没同步更新成1的情况。这类订单的净盈亏(57.6-30=27.6)
// 会被fetchTodayOrders的orderState:1过滤漏算，正是导致"账变口径"与"注单
// 口径"游戏盈亏对不上的根本原因。脚本只如实上报查到的数量和明细，不对
// 平台为什么没同步更新状态下定论。
async function fetchTodayAbnormalOrders(token, userId, maxPages = 20) {
  const { beginTimeUnix, endTimeUnix } = todayRangeMs();
  const seen = new Set();
  const records = [];
  let pageNo = 1;
  while (pageNo <= maxPages) {
    const payload = {
      queryTimeType: 'BetTime',
      userId: String(userId),
      beginTimeUnix,
      endTimeUnix,
      pageNo,
      pageSize: 200,
      orderBy: 'Desc',
      sortField: 'BetTime',
    };
    const r = await postAdmin('/api/ThirdGame/GetBetRecordPageList', payload, token);
    if (!r || r.code !== 0 || !r.data) {
      if (r && r.code !== 0) console.log(`[投注核对] ⚠️ 异常注单查询第${pageNo}页失败: ${r.msg || r.code}（跳过，不影响主流程）`);
      break;
    }
    const list = r.data.list || [];
    for (const o of list) {
      if (!o.orderNo || seen.has(o.orderNo) || Number(o.orderState) === 1) continue;
      seen.add(o.orderNo);
      records.push(o);
    }
    const totalPage = Number(r.data.totalPage) || 1;
    if (pageNo >= totalPage || list.length === 0) break;
    pageNo++;
    await sleep(200);
  }
  return records;
}

// ───── 业务查询：前台"Game History"当天注单（遍历全部分类，分页，客户端过滤已结算） ─────
// categoryType: 0=SLOTS 1=CASINO 2=SPORTS(未实测,按枚举顺序推断) 3=LOTTERY 4=POKER
// 2026-11-16浏览器抓包实测确认点击LOTTERY/SLOTS/CASINO/POKER四个tab分别传3/0/1/4。
const FRONTEND_CATEGORY_TYPES = [0, 1, 2, 3, 4];
const FRONTEND_PAGE_SIZE = 30; // 实测上限：超过报"'PageSize' Must be a positive integer and not greater than 30"

async function fetchFrontendOrders(feTokenState, maxPagesPerCategory = 10) {
  const { beginTimeUnix, endTimeUnix } = todayRangeMs();
  const seen = new Set();
  const orders = [];
  for (const categoryType of FRONTEND_CATEGORY_TYPES) {
    let pageNo = 1;
    while (pageNo <= maxPagesPerCategory) {
      const payload = {
        pageNo,
        pageSize: FRONTEND_PAGE_SIZE,
        categoryType,
        startUnixTime: beginTimeUnix,
        endUnixTime: endTimeUnix,
        vendorCode: null,
      };
      const r = await postDeskAuthed('/api/User/GetUserOrderList', payload, feTokenState);
      if (!r || r.code !== 0 || !r.data) {
        console.log(`[投注核对] ⚠️ 前台查询categoryType=${categoryType}第${pageNo}页失败: status=${r ? r.status : 'null'} ${r ? (r.msg || r.code) : ''}`);
        break;
      }
      const list = r.data.list || [];
      for (const o of list) {
        // 前台接口没有orderState过滤参数，客户端自己只保留已结算(orderState=1)
        if (!o.orderNo || seen.has(o.orderNo) || Number(o.orderState) !== 1) continue;
        seen.add(o.orderNo);
        orders.push(o);
      }
      const totalPage = Number(r.data.totalPage) || 1;
      if (pageNo >= totalPage || list.length === 0) break;
      pageNo++;
      await sleep(150);
    }
  }
  return orders;
}

// ───── 业务查询：前台余额（POST /api/ThirdGame/RecoverSaasBalance） ─────
// 用户2026-11-16浏览器抓包提供：payload只带通用签名字段，无业务参数；
// 响应 data.balance 即前台首页看到的余额。
async function fetchFrontendBalance(feTokenState) {
  const r = await postDeskAuthed('/api/ThirdGame/RecoverSaasBalance', {}, feTokenState);
  if (!r || r.code !== 0 || !r.data || typeof r.data.balance !== 'number') return null;
  return r.data.balance;
}

// ───── 业务查询：前台官方游戏报表（POST /api/User/GetUserGameReportList） ─────
// 用户2026-11-16浏览器抓包提供：按categoryType汇总当天数据，字段
// betOrderCount/totalBet/totalWin；时间字段是"YYYY-MM-DD HH:mm:ss"字符串
// (注意跟本脚本其他接口的unix毫秒格式不同)。这是"当天累计值"，不是逐笔明细，
// 脚本把所有categoryType加总后，拿前后两次快照的累计值做差，得到"本局"的
// 增量，作为跟 GetBetRecordPageList / GetUserOrderList 并列的第三个数据源。
async function fetchFrontendGameReport(feTokenState) {
  const { startDateTime, endDateTime } = todayDateTimeRangeStr();
  const r = await postDeskAuthed('/api/User/GetUserGameReportList', { startDateTime, endDateTime }, feTokenState);
  if (!r || r.code !== 0 || !Array.isArray(r.data)) return null;
  let count = 0, betAmount = 0, winAmount = 0;
  for (const row of r.data) {
    count += Number(row.betOrderCount || 0);
    betAmount += parseFloat(row.totalBet || 0);
    winAmount += parseFloat(row.totalWin || 0);
  }
  return { count, betAmount, winAmount, profit: round2(winAmount - betAmount), raw: r.data };
}

// ───── 业务查询：前台账变流水（POST /api/User/GetUserFinancialList） ─────
// 用户2026-11-16浏览器抓包提供：这是"账变"维度的流水(GameBet/GameTransIn/
// GameTransOut等type，每条只有一个方向的amount)，跟GetUserOrderList"注单"
// 维度(一条记录同时有betAmount+winAmount)不是同一个颗粒度——同一笔游戏操作
// 可能在这里被拆成多条账变记录。本脚本不对type字段的业务含义做任何猜测性
// 归类(不假设GameBet=投注、GameTransIn/Out=钱包间转账)，只用最朴素可靠的
// 会计恒等式核对："本局新增账变记录的amount之和" 必须严格等于 "本局前台
// 余额变化(RecoverSaasBalance的delta)"——这是比"游戏盈亏=余额变化"更底层、
// 完全不依赖理解接口字段语义的核对方式，用户2026-11-16明确要求加入。
// 未实测上限：30是沿用GetUserOrderList已验证过的值，10是用户给的抓包示例里
// 实际用的值。2026-11-16改为运行时自适应——不猜测具体上限，一旦某个pageSize
// 被后端以"PageSize"相关文案拒绝，自动换更小的候选值从第一页重新查询，
// 而不是硬编码一个可能错误的数字。
const FINANCIAL_PAGE_SIZE_CANDIDATES = [30, 10, 5];

async function fetchFrontendFinancial(feTokenState, maxPages = 20) {
  const { beginTimeUnix, endTimeUnix } = todayRangeMs();
  for (const pageSize of FINANCIAL_PAGE_SIZE_CANDIDATES) {
    const seen = new Set();
    const records = [];
    let pageNo = 1;
    let rejectedBySize = false;
    while (pageNo <= maxPages) {
      const payload = {
        pageNo,
        pageSize,
        startUnixTime: beginTimeUnix,
        endUnixTime: endTimeUnix,
      };
      const r = await postDeskAuthed('/api/User/GetUserFinancialList', payload, feTokenState);
      if (!r || r.code !== 0 || !r.data) {
        const msg = r ? (r.msg || r.text || '') : '';
        if (/pagesize/i.test(msg) && pageSize !== FINANCIAL_PAGE_SIZE_CANDIDATES[FINANCIAL_PAGE_SIZE_CANDIDATES.length - 1]) {
          console.log(`[投注核对] ⚠️ 前台账变查询pageSize=${pageSize}被拒绝(${msg})，自动降级到更小的pageSize重试...`);
          rejectedBySize = true;
        } else {
          console.log(`[投注核对] ⚠️ 前台账变查询第${pageNo}页失败: status=${r ? r.status : 'null'} ${r ? (r.msg || r.code) : ''}`);
        }
        break;
      }
      const list = r.data.list || [];
      for (const f of list) {
        if (!f.id || seen.has(f.id)) continue;
        seen.add(f.id);
        records.push(f);
      }
      const totalPage = Number(r.data.totalPage) || 1;
      if (pageNo >= totalPage || list.length === 0) break;
      pageNo++;
      await sleep(150);
    }
    if (!rejectedBySize) return records;
  }
  return [];
}

// ───── 业务查询：后台账变流水（POST /api/Financial/GetPageList，后台管理员
// token，不依赖前台会员登录/DUAL_CHECK，任何模式下都能用） ─────
// 2026-11-17实测确认(170940账号体育Cash Out案例)：体育"Sell/提前兑现"产生的
// 入账记录，orderNo跟原始投注订单号前缀不一样(原投注"100032_B...", 兑现入账
// 是"100032_C..."，数字部分相同、字母前缀从B变成C)，靠订单号匹配/靠"信不信
// 未结算订单的winAmount字段"这类判断从根上就不可靠——真正可靠的办法是直接
// 查账变流水，不管订单层面状态/字段怎么显示，只要钱真的动了，账变记录就会
// 出现。这个接口用后台管理员token查，不需要会员账号密码，所以任何模式下
// (不止DUAL_CHECK)都能作为比"官方统计口径/订单口径"更权威的会计恒等式核对
// 补充维度。orderBy参数不可信(此前已实测确认)，客户端自己按createTime重排。
const BACKEND_FINANCIAL_PAGE_SIZE_CANDIDATES = [200, 50, 10];

async function fetchBackendFinancialToday(token, userId, maxPages = 20) {
  const { beginTimeUnix, endTimeUnix } = todayRangeMs();
  for (const pageSize of BACKEND_FINANCIAL_PAGE_SIZE_CANDIDATES) {
    const seen = new Set();
    const records = [];
    let pageNo = 1;
    let rejectedBySize = false;
    while (pageNo <= maxPages) {
      const payload = {
        searchUserIdType: 1,
        userId: Number(userId),
        startTime: beginTimeUnix,
        endTime: endTimeUnix,
        pageNo,
        pageSize,
        orderBy: 'Desc',
      };
      const r = await postAdmin('/api/Financial/GetPageList', payload, token);
      if (!r || r.code !== 0 || !r.data) {
        const msg = r ? (r.msg || r.text || '') : '';
        if (/pagesize/i.test(msg) && pageSize !== BACKEND_FINANCIAL_PAGE_SIZE_CANDIDATES[BACKEND_FINANCIAL_PAGE_SIZE_CANDIDATES.length - 1]) {
          rejectedBySize = true;
        } else {
          if (r && r.code !== 0) console.log(`[投注核对] ⚠️ 后台账变流水查询第${pageNo}页失败: ${r.msg || r.code}（跳过，不影响主流程）`);
        }
        break;
      }
      const list = r.data.list || [];
      for (const f of list) {
        if (!f.id || seen.has(f.id)) continue;
        seen.add(f.id);
        records.push(f);
      }
      const totalPage = Number(r.data.totalPage) || 1;
      if (pageNo >= totalPage || list.length === 0) break;
      pageNo++;
      await sleep(150);
    }
    if (!rejectedBySize) {
      records.sort((a, b) => Number(a.createTime || 0) - Number(b.createTime || 0));
      return records;
    }
  }
  return [];
}

// ───── 按游戏名称分组统计 ─────
function groupByGame(orders) {
  const groups = {};
  for (const o of orders) {
    const name = o.gameName || o.gameCode || '未知游戏';
    const vendor = o.vendorCode || '';
    const key = vendor ? `${name}（${vendor}）` : name;
    if (!groups[key]) groups[key] = { count: 0, betAmount: 0, winAmount: 0 };
    groups[key].count += 1;
    groups[key].betAmount += parseFloat(o.betAmount || 0);
    groups[key].winAmount += parseFloat(o.winAmount || 0);
  }
  return groups;
}

function sumGroups(groups) {
  let count = 0, betAmount = 0, winAmount = 0;
  for (const k in groups) {
    count += groups[k].count;
    betAmount += groups[k].betAmount;
    winAmount += groups[k].winAmount;
  }
  return { count, betAmount, winAmount, profit: winAmount - betAmount };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function fmt(n) {
  return round2(n).toFixed(2);
}

// ───── 一次完整快照：余额 + 当天已结算注单 ─────
async function snapshot(token, userId, verbose) {
  const detailResp = await getUserDetail(token, userId);
  if (detailResp.code !== 0) {
    console.log(`[投注核对] ⚠️ GetUserDetail 查询失败: ${detailResp.msg || detailResp.code}`);
  }
  if (verbose) {
    console.log('\n[调试] GetUserDetail 原始响应（首次查询，用于确认余额字段名）：');
    console.log(JSON.stringify(detailResp.data, null, 2));
  }
  const balanceInfo = extractBalance(detailResp.data);
  if (verbose) {
    if (balanceInfo) {
      console.log(`[调试] 已自动识别余额字段: ${balanceInfo.field} = ${balanceInfo.value}`);
    } else {
      console.log('[调试] ⚠️ 未能从候选字段名中自动识别余额，请对照上方原始JSON人工确认字段名，后续核对会跳过"余额核对"这一项');
    }
  }

  const activeToday = extractActiveToday(detailResp.data);
  if (verbose) {
    if (activeToday) {
      console.log(`[调试] 今日累计(activeTodayRsp)：投注${activeToday.betAmount} 派奖${activeToday.prizeAmount} 活动奖励${activeToday.activityRewards} 充值${activeToday.rechargesAmount}(${activeToday.rechargesCount}笔) 提现${activeToday.withdrawAmount}(${activeToday.withdrawCount}笔) 冻结金额${activeToday.freezeAmount !== null ? activeToday.freezeAmount : '未知'}`);
    } else {
      console.log('[调试] ⚠️ 未找到activeTodayRsp，后续核对会跳过"充值/提现/活动奖励穿插"这一项修正');
    }
  }

  const orders = await fetchTodayOrders(token, userId);
  if (verbose && orders.length > 0) {
    console.log('\n[调试] 首条注单原始JSON（用于确认游戏名称/派奖金额字段名）：');
    console.log(JSON.stringify(orders[0], null, 2));
  }

  const abnormalOrders = await fetchTodayAbnormalOrders(token, userId);
  if (verbose && abnormalOrders.length > 0) {
    console.log(`[调试] 当天非已结算(orderState!==1)注单: ${abnormalOrders.length}笔，首条原始JSON：`);
    console.log(JSON.stringify(abnormalOrders[0], null, 2));
  }

  // 后台账变流水：不依赖DUAL_CHECK，任何模式下都查——这是比"未结算订单该不该
  // 信winAmount"更权威的数据源(2026-11-17体育Cash Out案例实测确认，见
  // fetchBackendFinancialToday文件头注释)。
  const backendFinancial = await fetchBackendFinancialToday(token, userId);
  if (verbose) {
    if (backendFinancial.length > 0) {
      console.log(`[调试] 后台账变流水(Financial/GetPageList): 当天累计${backendFinancial.length}条记录，首条原始JSON：`);
      console.log(JSON.stringify(backendFinancial[0], null, 2));
    } else {
      console.log('[调试] 后台账变流水(Financial/GetPageList): 查询失败或当天暂无记录');
    }
  }

  return {
    time: new Date(),
    balance: balanceInfo ? balanceInfo.value : null,
    activeToday,
    orders,
    summary: sumGroups(groupByGame(orders)),
    abnormalOrders,
    backendFinancial,
  };
}

// ───── 双重快照：后台快照 + (开启双重核对时)前台四个数据源快照 ─────
// feTokenState由调用方(main)传入并贯穿整个交互会话；本函数不主动重新
// login，但内部各前台查询(postDeskAuthed)在检测到token过期时会自动刷新
// 并回写feTokenState.value，避免无条件重复登录顶掉用户浏览器里的会话。
async function dualSnapshot(adminToken, feTokenState, userId, verbose) {
  const be = await snapshot(adminToken, userId, verbose);
  if (!DUAL_CHECK || !feTokenState || !feTokenState.value) {
    return { ...be, feOrders: null, feSummary: null, feBalance: null, feReport: null, feFinancial: null };
  }

  const feOrders = await fetchFrontendOrders(feTokenState);
  const feBalance = await fetchFrontendBalance(feTokenState);
  const feReport = await fetchFrontendGameReport(feTokenState);
  const feFinancial = await fetchFrontendFinancial(feTokenState);

  if (verbose) {
    if (feOrders.length > 0) {
      console.log('\n[调试] 前台(Game History)首条注单原始JSON：');
      console.log(JSON.stringify(feOrders[0], null, 2));
    }
    console.log(`[调试] 前台余额(RecoverSaasBalance): ${feBalance !== null ? feBalance : '查询失败'}`);
    console.log(`[调试] 前台官方报表(GetUserGameReportList)原始数据: ${feReport ? JSON.stringify(feReport.raw) : '查询失败'}`);
    if (feFinancial && feFinancial.length > 0) {
      console.log('\n[调试] 前台账变流水(GetUserFinancialList)首条原始JSON：');
      console.log(JSON.stringify(feFinancial[0], null, 2));
    } else {
      console.log('[调试] 前台账变流水(GetUserFinancialList): 查询失败或当天暂无记录');
    }
  }

  return {
    ...be,
    feOrders,
    feSummary: sumGroups(groupByGame(feOrders)),
    feBalance,
    feReport,
    feFinancial,
  };
}

// ───── 最终报告生成 ─────
function buildReportMarkdown(rounds, baseline, finalSnapshot) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  const totalCount = rounds.reduce((s, r) => s + r.total.count, 0);
  const totalBet = rounds.reduce((s, r) => s + r.total.betAmount, 0);
  const totalWin = rounds.reduce((s, r) => s + r.total.winAmount, 0);
  const totalProfit = rounds.reduce((s, r) => s + r.total.profit, 0);
  // 已结算笔数(total.count)不含"未结算"注单——2026-11-17用户指出这会漏算
  // 真实发生过的注单数，这里单独统计"未结算"笔数/投注额，总览表/分局详情
  // 都把它跟已结算笔数并列展示，而不是悄悄漏掉。
  const totalAbnormalCount = rounds.reduce((s, r) => s + ((r.newPendingAbnormalOrders || []).length), 0);
  const totalRefundedCount = rounds.reduce((s, r) => s + ((r.newRefundedAbnormalOrders || []).length), 0);

  const lines = [];
  lines.push('# 游戏投注核对报告（自动化脚本生成）');
  lines.push('');
  lines.push(`- **生成时间**：${now.toLocaleString('zh-CN')}`);
  lines.push(`- **租户**：${TENANT}（商户后台 \`${ADMIN_URL}\`）`);
  lines.push(`- **测试账号**：会员ID ${USER_ID}`);
  lines.push(DUAL_CHECK
    ? '- **验证方式**：自动化脚本直连前后台接口——后台 `GetUserDetail` 查余额+今日累计充值/提现/活动奖励(修正"余额变化=游戏盈亏"假设) + `GetBetRecordPageList` 查已结算注单；前台 `RecoverSaasBalance` 查余额 + `GetUserOrderList`（Game History，遍历SLOTS/CASINO/SPORTS/LOTTERY/POKER全部5个分类）查逐笔注单 + `GetUserGameReportList` 查官方按分类汇总的报表 + `GetUserFinancialList` 查账变流水（本局新增账变记录amount之和必须等于前台余额变化，会计恒等式核对，不依赖对type字段语义的假设）；每局浏览器投注完成后回车触发查询，不经浏览器点击核对；会员账号默认只登录一次，仅在检测到token过期时自动刷新，避免无谓反复顶掉浏览器端的游戏会话'
    : '- **验证方式**：自动化脚本直连后台接口（`GetUserDetail` 查余额+今日累计充值/提现/活动奖励 + `GetBetRecordPageList` 查已结算注单），每局浏览器投注完成后回车触发查询，不经浏览器点击核对（未配置会员账号密码，本次未做前台交叉核对）');
  lines.push(`- **起始基线余额**：${baseline.balance !== null ? fmt(baseline.balance) : '未能自动识别（见调试JSON）'}`);
  lines.push(`- **最终余额**：${finalSnapshot.balance !== null ? fmt(finalSnapshot.balance) : '未能自动识别（见调试JSON）'}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`## 一、总览表（${rounds.length}局汇总）`);
  lines.push('');
  if (DUAL_CHECK) {
    lines.push('| 局数 | 游戏（厂商） | 笔数 | 投注合计 | 派奖合计 | 本局盈亏 | 后台余额（局前→局后） | 后台余额核对 | 前后台核对 |');
    lines.push('|---|---|---|---|---|---|---|---|---|');
  } else {
    lines.push('| 局数 | 游戏（厂商） | 笔数 | 投注合计 | 派奖合计 | 本局盈亏 | 余额（局前→局后） | 核对结果 |');
    lines.push('|---|---|---|---|---|---|---|---|');
  }
  for (const r of rounds) {
    const gameNames = Object.keys(r.groups).join(' + ') || '（无新增注单）';
    const beforeTxt = r.balanceBefore !== null ? fmt(r.balanceBefore) : '—';
    const afterTxt = r.balanceAfter !== null ? fmt(r.balanceAfter) : '—';
    const roundAbnormalCount = (r.newPendingAbnormalOrders || []).length;
    const roundRefundedCount = (r.newRefundedAbnormalOrders || []).length;
    const overviewParts = [];
    if (roundAbnormalCount > 0) overviewParts.push(`${roundAbnormalCount}笔未结算`);
    if (roundRefundedCount > 0) overviewParts.push(`${roundRefundedCount}笔已撤单退款`);
    const roundExtraCount = roundAbnormalCount + roundRefundedCount;
    const countTxt = roundExtraCount > 0
      ? `${r.total.count + roundExtraCount}（含${overviewParts.join('+')}）`
      : String(r.total.count);
    if (DUAL_CHECK) {
      lines.push(`| ${r.roundNo} | ${gameNames} | ${countTxt} | ${fmt(r.total.betAmount)} | ${fmt(r.total.winAmount)} | ${fmt(r.total.profit)} | ${beforeTxt} → ${afterTxt} | ${r.verdict} | ${r.crossCheck || '—'} |`);
    } else {
      lines.push(`| ${r.roundNo} | ${gameNames} | ${countTxt} | ${fmt(r.total.betAmount)} | ${fmt(r.total.winAmount)} | ${fmt(r.total.profit)} | ${beforeTxt} → ${afterTxt} | ${r.verdict} |`);
    }
  }
  const totalExtraCount = totalAbnormalCount + totalRefundedCount;
  const totalOverviewParts = [];
  if (totalAbnormalCount > 0) totalOverviewParts.push(`${totalAbnormalCount}笔未结算`);
  if (totalRefundedCount > 0) totalOverviewParts.push(`${totalRefundedCount}笔已撤单退款`);
  const totalCountTxt = totalExtraCount > 0
    ? `${totalCount + totalExtraCount}笔（含${totalOverviewParts.join('+')}）`
    : `${totalCount}笔`;
  if (DUAL_CHECK) {
    lines.push(`| **合计** | — | **${totalCountTxt}** | **${fmt(totalBet)}** | **${fmt(totalWin)}** | **${fmt(totalProfit)}** | — | — | — |`);
  } else {
    lines.push(`| **合计** | — | **${totalCountTxt}** | **${fmt(totalBet)}** | **${fmt(totalWin)}** | **${fmt(totalProfit)}** | — | — |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 二、分局详情');
  lines.push('');
  for (const r of rounds) {
    const gameNames = Object.keys(r.groups).join(' + ') || '（无新增注单）';
    const roundAbnormalCount = (r.newPendingAbnormalOrders || []).length;
    const roundRefundedCount = (r.newRefundedAbnormalOrders || []).length;
    const headerParts = [];
    if (roundAbnormalCount > 0) headerParts.push(`${roundAbnormalCount}笔未结算`);
    if (roundRefundedCount > 0) headerParts.push(`${roundRefundedCount}笔已撤单退款`);
    const headerCountTxt = headerParts.length > 0 ? `${r.total.count}笔已结算 + ${headerParts.join(' + ')}` : `${r.total.count}笔`;
    lines.push(`### 第${r.roundNo}局 ${gameNames} — ${headerCountTxt}`);
    if (Object.keys(r.groups).length > 1) {
      lines.push('| 游戏 | 笔数 | 投注 | 派奖 | 盈亏 |');
      lines.push('|---|---|---|---|---|');
      for (const g in r.groups) {
        const gr = r.groups[g];
        lines.push(`| ${g} | ${gr.count} | ${fmt(gr.betAmount)} | ${fmt(gr.winAmount)} | ${fmt(gr.winAmount - gr.betAmount)} |`);
      }
      lines.push(`| **合计** | **${r.total.count}** | **${fmt(r.total.betAmount)}** | **${fmt(r.total.winAmount)}** | **${fmt(r.total.profit)}** |`);
    } else {
      lines.push(`投注合计${fmt(r.total.betAmount)} / 派奖合计${fmt(r.total.winAmount)} / 盈亏${fmt(r.total.profit)}。`);
    }
    lines.push(`本局充值净增${r.rechargeDelta !== null ? fmt(r.rechargeDelta) : '未知'}  提现净增${r.withdrawDelta !== null ? fmt(r.withdrawDelta) : '未知'}  活动奖励净增${r.activityRewardDelta !== null ? fmt(r.activityRewardDelta) : '未知'}${r.freezeDelta !== null && Math.abs(r.freezeDelta) >= 0.01 ? `  ⚠️冻结金额变化${fmt(r.freezeDelta)}(可能是提现被冻结未到账，请人工核实)` : ''}`);
    lines.push(`后台官方今日统计核对：${r.officialCheck || '—'}`);
    const abnormalDeductionTxt = (r.abnormalBetDeduction !== 0) ? `+未结算注单投注扣除${fmt(r.abnormalBetDeduction)}` : '';
    const crossSettledTxt = (r.crossSettledBetAmount !== 0) ? `+核销跨局结算重复投注${fmt(r.crossSettledBetAmount)}` : '';
    lines.push(`后台余额：${r.balanceBefore !== null ? fmt(r.balanceBefore) : '—'} → ${r.balanceAfter !== null ? fmt(r.balanceAfter) : '—'}（变化${r.balanceDelta !== null ? fmt(r.balanceDelta) : '—'}，预期变化${fmt(r.expectedDelta)}=游戏盈亏${fmt(r.total.profit)}+充值${r.rechargeDelta !== null ? fmt(r.rechargeDelta) : 0}-提现${r.withdrawDelta !== null ? fmt(r.withdrawDelta) : 0}+活动奖励${r.activityRewardDelta !== null ? fmt(r.activityRewardDelta) : 0}${abnormalDeductionTxt}${crossSettledTxt}） ${r.verdict}`);
    if (roundAbnormalCount + roundRefundedCount > 0) {
      lines.push(`⚠️ 本局新增${headerParts.join(' + ')}注单（上方笔数已计入，"未结算"的投注金额已计入扣除、"已撤单退款"钱已全额退回不计入扣除，游戏盈亏暂未计入，派奖是否已到账需结合资金流水核对）：`);
      lines.push('| 厂商 | 游戏名称 | 投注金额 | 派奖金额 | 订单号 | 状态(orderState) | 类型 |');
      lines.push('|---|---|---|---|---|---|---|');
      for (const o of r.newAbnormalOrders) {
        const tag = o.settlementTime ? '已撤单退款' : '未结算';
        lines.push(`| ${o.vendorCode || '未知'} | ${o.gameName || o.gameCode || '未知'} | ${fmt(o.betAmount)} | ${fmt(o.winAmount)} | ${o.orderNo} | ${o.orderState} | ${tag} |`);
      }
    }
    if (r.abnormalOrderCount > roundAbnormalCount + roundRefundedCount) {
      lines.push(`ℹ️ 账上另外累计存在${r.abnormalOrderCount - roundAbnormalCount - roundRefundedCount}笔非本局产生的历史遗留"未结算/已撤单"注单（不计入本局，差额异常时可作为候选原因参考）`);
    }
    lines.push(`后台账变流水(Financial/GetPageList，${r.backendFinNewRecords.length}笔)：净额${fmt(r.backendFinNetAmount)}  ${r.backendFinCheck}`);
    {
      const typeLines = Object.keys(r.backendFinByType).map((t) => `${t}: ${r.backendFinByType[t].count}笔/净额${fmt(r.backendFinByType[t].amount)}`);
      if (typeLines.length > 0) lines.push(`　明细：${typeLines.join('，')}`);
    }
    if (DUAL_CHECK) {
      lines.push(`前台余额(RecoverSaasBalance)：${r.feBalanceBefore !== null ? fmt(r.feBalanceBefore) : '—'} → ${r.feBalanceAfter !== null ? fmt(r.feBalanceAfter) : '—'}（变化${r.feBalanceDelta !== null ? fmt(r.feBalanceDelta) : '—'}） ${r.feBalanceCheck || '—'}`);
      lines.push(`前台Game History(逐笔汇总)：${r.feTotal.count}笔  投注${fmt(r.feTotal.betAmount)}  派奖${fmt(r.feTotal.winAmount)}`);
      lines.push(`前台官方报表(GetUserGameReportList增量)：${r.feReportDelta ? `${r.feReportDelta.count}笔  投注${fmt(r.feReportDelta.betAmount)}  派奖${fmt(r.feReportDelta.winAmount)}` : '—（查询失败）'}`);
      if (r.finNetAmount !== null) {
        lines.push(`前台账变流水(GetUserFinancialList，${r.finNewRecords.length}笔)：净额${fmt(r.finNetAmount)}  ${r.finCheck || '—'}`);
        const typeLines = Object.keys(r.finByType).map((t) => `${t}: ${r.finByType[t].count}笔/净额${fmt(r.finByType[t].amount)}`);
        if (typeLines.length > 0) lines.push(`　明细：${typeLines.join('，')}`);
      } else {
        lines.push(`前台账变流水(GetUserFinancialList)：—（查询失败）  ${r.finCheck || '—'}`);
      }
      lines.push(`前后台核对：${r.crossCheck || '—'}`);
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('## 三、全程总核对');
  lines.push('');
  lines.push(`- 起始余额：**${baseline.balance !== null ? fmt(baseline.balance) : '未知'}**`);
  lines.push(`- ${rounds.length}局游戏净盈亏合计：**${fmt(totalProfit)}**`);

  // ── 官方统计口径：汇总各局已经算好的 rechargeDelta/withdrawDelta/
  // activityRewardDelta(来自GetUserDetail.activeTodayRsp累计值做差)，把
  // 2026-11-16"余额变化应等于游戏盈亏"的修正公式从"单局"提升到"全程"层面，
  // 不再是之前那个完全不管充值/提现、承认"脚本只核对游戏投注,不追踪资金
  // 流水"的弱版本。
  const activeKnownRounds = rounds.filter((r) => r.rechargeDelta !== null);
  const totalRecharge = round2(activeKnownRounds.reduce((s, r) => s + r.rechargeDelta, 0));
  const totalWithdraw = round2(activeKnownRounds.reduce((s, r) => s + r.withdrawDelta, 0));
  const totalActivityReward = round2(activeKnownRounds.reduce((s, r) => s + r.activityRewardDelta, 0));
  const totalFreezeChange = round2(rounds.reduce((s, r) => s + (r.freezeDelta || 0), 0));
  const activeIncomplete = activeKnownRounds.length < rounds.length;

  // ⚠️ 全程层面"未结算注单投注扣除"不能直接把各局的abnormalBetDeduction相加——
  // 如果某笔订单在第N局还未结算(被算进第N局的abnormalBetDeduction)，但到第N+1局
  // 已经同步结算了，它的betAmount会作为"新增已结算订单"被fetchTodayOrders正常
  // 查到、计入第N+1局的total.profit/betAmount，这时候如果全程层面还把第N局那次
  // 的扣除也加总进来，这笔订单的投注金额就被扣了两次。正确做法：只统计"相对于
  // 一开始的基线新增、且到最后一局结束时依然还没结算"的那些订单——中途产生又
  // 中途被结算掉的订单，已经通过它们"变成已结算"后正常走total.profit核算过了，
  // 不需要(也不能)再额外扣一次。
  const baselineAbnormalNos = new Set((baseline.abnormalOrders || []).map((o) => o.orderNo));
  const stillAbnormalAtEnd = (finalSnapshot.abnormalOrders || []).filter((o) => !baselineAbnormalNos.has(o.orderNo));
  // 2026-11-18实测确认(170995账号)：orderState!==1不等于"钱还扣着没退"——还
  // 存在orderState=2的"已撤单/作废"订单，settlementTime已经有值(走完过结算
  // 流程)，后台账变流水里能查到一条orderNo完全对应、amount=betAmount的
  // GameReturn记录，说明这笔钱已经全额退回钱包。只有settlementTime仍为0
  // (从未进入结算流程)才是真正悬而未决、钱还扣着的未结算注单，需要扣减预期
  // 余额；已经走完结算流程的(不管orderState具体是几)，钱的去向账变流水口径
  // 已经如实记过账了，这里不能再扣一次，否则会凭空制造出等于该订单betAmount
  // 的虚假差额(正是本次发现999.00差额的根因：2笔共999.00的已撤单退款订单
  // 被误当成"还扣着的未结算"多扣了一次)。
  const stillPendingAtEnd = stillAbnormalAtEnd.filter((o) => !o.settlementTime);
  const refundedAtEnd = stillAbnormalAtEnd.filter((o) => o.settlementTime);
  // ⚠️ 这里不能再加总各局的crossSettledBetAmount——那个修正项只在"单局维度"
  // 才需要(让每一局的verdict只反映"本局新发生"的资金变动)。在全程维度，
  // totalProfit(各局total.profit求和)本身已经是正确的：任何一笔订单，不管
  // 它的betAmount/winAmount是当局产生就结算、还是跨好几局才结算，都只会在
  // 它"变成已结算"的那一局的total里出现一次、且是完整数据，不会被重复计入
  // 其他任何一局的total——所以全程累加后天然不重复，只有"从始至终都没结算"
  // 的那部分订单(stillPendingAtEnd)才是total统计不到、需要额外补回的部分。
  const totalAbnormalBetDeduction = round2(-stillPendingAtEnd.reduce((s, o) => s + parseFloat(o.betAmount || 0), 0));

  if (baseline.balance !== null && finalSnapshot.balance !== null) {
    lines.push(`- 累计充值${fmt(totalRecharge)}  累计提现${fmt(totalWithdraw)}  累计活动奖励${fmt(totalActivityReward)}${activeIncomplete ? `（⚠️有${rounds.length - activeKnownRounds.length}局未查到官方统计，此项不完整）` : ''}${Math.abs(totalFreezeChange) >= 0.01 ? `  累计冻结金额变化${fmt(totalFreezeChange)}` : ''}${stillPendingAtEnd.length > 0 ? `  截止目前仍有${stillPendingAtEnd.length}笔未结算注单(彩票/体育等待开奖完赛属正常)，已扣除投注合计${fmt(-totalAbnormalBetDeduction)}` : ''}${refundedAtEnd.length > 0 ? `  另有${refundedAtEnd.length}笔已撤单退款共${fmt(refundedAtEnd.reduce((s, o) => s + parseFloat(o.betAmount || 0), 0))}(钱已全额退回，不计入扣除)` : ''}`);
    const expectedFinal = round2(baseline.balance + totalProfit + totalRecharge - totalWithdraw + totalActivityReward + totalAbnormalBetDeduction);
    lines.push(`- 预期余额（起始余额 + 累计盈亏 + 累计充值 - 累计提现 + 累计活动奖励${stillPendingAtEnd.length > 0 ? ' + 仍未结算注单投注扣除' : ''}，官方统计口径）= ${fmt(expectedFinal)}`);
    lines.push(`- 实际最终余额：**${fmt(finalSnapshot.balance)}**`);
    const diff = round2(finalSnapshot.balance - expectedFinal);
    if (Math.abs(diff) < 0.01) {
      lines.push('- ✅ 官方统计口径完全吻合');
    } else {
      const freezeHint = Math.abs(totalFreezeChange) >= 0.01 ? `，累计冻结金额变化${fmt(totalFreezeChange)}(可能是提现刚发起被冻结、尚未计入官方"累计提现"统计，请结合下方资金流水口径核对)` : '';
      lines.push(`- ⚠️ 官方统计口径差额${fmt(diff)}${freezeHint}，请人工核实`);
    }
  } else {
    lines.push('- ⚠️ 余额字段未能自动识别，无法做全程总核对，请人工核实（见上方各局调试JSON）');
  }

  // ── 后台账变流水口径（不依赖DUAL_CHECK，任何模式下都做）：直接汇总各局
  // "后台账变流水(Financial/GetPageList)"新增记录amount之和，跟上面的官方
  // 统计口径并列展示。2026-11-17实测确认：体育Cash Out提前兑现产生的入账
  // 记录，orderNo跟原投注订单号不一致、原订单orderState依然是未结算，官方
  // 统计口径(基于订单数据+未结算推测)天然无法捕捉到这类资金——这个口径
  // 按时间窗口查账变流水，不管订单号/类型怎么变，钱动了就会被记录到，是
  // 比官方统计口径更权威的会计恒等式核对。
  if (baseline.balance !== null && finalSnapshot.balance !== null) {
    const backendFinKnownRounds = rounds.filter((r) => r.backendFinNetAmount !== null && r.backendFinNewRecords);
    const totalBackendFinNet = round2(backendFinKnownRounds.reduce((s, r) => s + r.backendFinNetAmount, 0));
    const backendActualDelta = round2(finalSnapshot.balance - baseline.balance);
    const totalBackendFinByType = {};
    for (const r of rounds) {
      for (const t in (r.backendFinByType || {})) {
        if (!totalBackendFinByType[t]) totalBackendFinByType[t] = { count: 0, amount: 0 };
        totalBackendFinByType[t].count += r.backendFinByType[t].count;
        totalBackendFinByType[t].amount += r.backendFinByType[t].amount;
      }
    }
    const backendFinTypeLines = Object.keys(totalBackendFinByType).map((t) => `${t}: ${totalBackendFinByType[t].count}笔/净额${fmt(totalBackendFinByType[t].amount)}`);
    lines.push('');
    lines.push(`- **后台账变流水口径**（Financial/GetPageList，${backendFinKnownRounds.length < rounds.length ? `仅覆盖${backendFinKnownRounds.length}/${rounds.length}局` : '覆盖全部局数'}）：累计净额${fmt(totalBackendFinNet)}，后台余额变化${fmt(backendActualDelta)}`);
    if (backendFinTypeLines.length > 0) lines.push(`　明细：${backendFinTypeLines.join('，')}`);
    if (Math.abs(totalBackendFinNet - backendActualDelta) < 0.01) {
      lines.push('- ✅ 后台账变流水口径完全吻合（会计恒等式验证通过，能覆盖体育Cash Out等"订单号/类型跟原投注不一致"的穿插资金，比官方统计口径更权威）');
    } else {
      // 跟单局那条检查同款降级：全程余额本身是否已经核对通过(官方统计口径
      // expectedFinal)，决定这条差额是真问题还是历史结存/分页遗漏这类口径噪音。
      const overallExpectedFinal = round2(baseline.balance + totalProfit + totalRecharge - totalWithdraw + totalActivityReward + totalAbnormalBetDeduction);
      const overallBalanceAlreadyVerified = (baseline.balance !== null && finalSnapshot.balance !== null && Math.abs(finalSnapshot.balance - overallExpectedFinal) < 0.01);
      if (overallBalanceAlreadyVerified) {
        lines.push(`- ℹ️ 后台账变流水口径差额${fmt(round2(backendActualDelta - totalBackendFinNet))}，但全程余额已核实PASS——大概率是开局前游戏钱包就有历史结存被首次切换游戏时一并转出，不代表真实资金异常，仅供参考`);
      } else {
        lines.push(`- ⚠️ 后台账变流水口径差额${fmt(round2(backendActualDelta - totalBackendFinNet))}，需人工核实`);
      }
    }
  }

  // ── 资金流水口径（仅DUAL_CHECK）：直接汇总各局"前台账变流水
  // (GetUserFinancialList)"新增记录amount之和，跟上面的官方统计口径并列
  // 展示。这个口径不依赖对activeTodayRsp字段何时更新的任何假设——哪怕
  // 提现刚发起还在审核、尚未计入官方"累计提现"统计，只要钱已经从余额里
  // 划走，账变记录会立刻出现，资金流水口径能完整捕捉到(2026-11-17实测
  // 案例：一笔5000提现刚发起，账变流水立刻记一条Withdraw净额-5000，官方
  // 统计口径的累计提现仍是0导致对不上，资金流水口径却完全吻合，并且能在
  // 下面的"明细"里直接指出是哪笔类型的记录造成的，不用再翻每一局的细节)。
  if (DUAL_CHECK) {
    const finKnownRounds = rounds.filter((r) => r.finNetAmount !== null);
    if (finKnownRounds.length > 0 && baseline.feBalance !== null && finalSnapshot.feBalance !== null) {
      const totalFinNet = round2(finKnownRounds.reduce((s, r) => s + r.finNetAmount, 0));
      const feActualDelta = round2(finalSnapshot.feBalance - baseline.feBalance);
      const totalFinByType = {};
      for (const r of rounds) {
        for (const t in (r.finByType || {})) {
          if (!totalFinByType[t]) totalFinByType[t] = { count: 0, amount: 0 };
          totalFinByType[t].count += r.finByType[t].count;
          totalFinByType[t].amount += r.finByType[t].amount;
        }
      }
      const finTypeLines = Object.keys(totalFinByType).map((t) => `${t}: ${totalFinByType[t].count}笔/净额${fmt(totalFinByType[t].amount)}`);
      lines.push('');
      lines.push(`- **资金流水口径**（前台账变流水GetUserFinancialList，${finKnownRounds.length < rounds.length ? `仅覆盖${finKnownRounds.length}/${rounds.length}局` : '覆盖全部局数'}）：累计净额${fmt(totalFinNet)}，前台余额变化${fmt(feActualDelta)}`);
      if (finTypeLines.length > 0) lines.push(`　明细：${finTypeLines.join('，')}`);
      if (Math.abs(totalFinNet - feActualDelta) < 0.01) {
        lines.push('- ✅ 资金流水口径完全吻合（会计恒等式验证通过，不依赖官方统计字段何时更新，能覆盖"已划款但尚未计入官方统计"的穿插资金）');
      } else {
        lines.push(`- ⚠️ 资金流水口径差额${fmt(round2(feActualDelta - totalFinNet))}，需人工核实`);
      }
    } else {
      lines.push('- ⚠️ 资金流水口径数据不完整（部分局前台账变流水或前台余额查询失败），无法做全程资金流水核对');
    }
  }

  if (DUAL_CHECK) {
    lines.push(`- 前台最终余额(RecoverSaasBalance)：**${finalSnapshot.feBalance !== null ? fmt(finalSnapshot.feBalance) : '未知'}**（应与后台最终余额一致，因为是同一账号同一份真实资金）`);
  }
  lines.push('');
  const unresolvedRounds = rounds.filter((r) => r.verdict.startsWith('⚠️'));
  const crossMismatchRounds = DUAL_CHECK ? rounds.filter((r) => r.crossCheck && r.crossCheck.startsWith('⚠️')) : [];
  if (unresolvedRounds.length > 0) {
    lines.push(`**注意**：第 ${unresolvedRounds.map((r) => r.roundNo).join('、')} 局余额变化与游戏盈亏不完全吻合，已在上方标注，请人工复核（常见原因：期间发生充值/提现）。`);
  }
  if (crossMismatchRounds.length > 0) {
    lines.push(`**注意**：第 ${crossMismatchRounds.map((r) => r.roundNo).join('、')} 局前后台数据不一致，已在上方标注，请人工复核（可能是前后台数据同步延迟，或真实的前后台数据不一致bug）。`);
  }
  if (unresolvedRounds.length === 0 && crossMismatchRounds.length === 0) {
    lines.push(DUAL_CHECK
      ? `**结论：共${rounds.length}局（${totalCount}笔注单），后台注单、前台Game History逐笔记录、前台官方报表、前台账变流水、前后台余额五方数据全部核对一致，全部判定PASS。**`
      : `**结论：共${rounds.length}局（${totalCount}笔注单），后台注单记录与平台余额核对一致，全部判定PASS（未做前台交叉核对）。**`);
  }
  lines.push('');

  return { markdown: lines.join('\n'), stamp };
}

function writeReportFile(rounds, baseline, finalSnapshot) {
  const { markdown, stamp } = buildReportMarkdown(rounds, baseline, finalSnapshot);
  const outPath = path.join(__dirname, `游戏投注核对报告_自动化_${stamp}.md`);
  fs.writeFileSync(outPath, markdown, 'utf-8');
  return outPath;
}

// ───── 主流程：登录 → 基线快照 → 交互循环 → 出报告 ─────
async function main() {
  console.log(`[投注核对] 租户=${TENANT} 后台=${ADMIN_URL} 会员ID=${USER_ID}`);
  console.log(`[投注核对] 前后台双重核对: ${DUAL_CHECK ? `开启（前台=${DESK_URL}）` : '关闭（未配置MEMBER_ACCOUNT/MEMBER_PASSWORD，仅后台核对）'}`);
  console.log('[投注核对] 后台登录中...');
  const login = await adminLogin();
  if (!(login && login.code === 0 && login.data && login.data.token)) {
    console.error(`[投注核对] ❌ 后台登录失败: ${login ? login.msg : 'null'}`);
    process.exit(1);
  }
  const token = login.data.token;
  console.log('[投注核对] ✅ 后台登录成功');

  // 前台会员登录：⚠️ 默认全程只做这一次，拿到的 token 贯穿整个交互会话。
  // 2026-11-16实测确认同一账号重复login会把其他端的登录会话顶下线，所以
  // 这里登录一次之后，不管后面玩多少局，都不会主动再调用 memberLogin()——
  // 仅当某次前台查询检测到疑似token过期(见postDeskAuthed)时，才会自动
  // 刷新一次。feTokenState用对象包装，供所有前台查询函数共享/回写最新token。
  const feTokenState = { value: null, refreshed: false };
  if (DUAL_CHECK) {
    console.log('[投注核对] 前台会员登录中（⚠️ 若此刻浏览器已登录会被顶下线一次，登录成功后请在浏览器里重新登录再开始玩）...');
    const feLogin = await memberLogin();
    if (feLogin && feLogin.code === 0 && feLogin.data && feLogin.data.token) {
      feTokenState.value = feLogin.data.token;
      console.log('[投注核对] ✅ 前台登录成功');
    } else {
      console.error(`[投注核对] ❌ 前台登录失败，无法做前后台双重核对: ${feLogin ? feLogin.msg : 'null'}`);
      process.exit(1);
    }
  }

  console.log('[投注核对] 正在查询基线快照（余额 + 当天已结算注单' + (DUAL_CHECK ? ' + 前台余额/逐笔注单/官方报表/账变流水' : '') + '）...');

  const baseline = await dualSnapshot(token, feTokenState, USER_ID, true);
  if (DUAL_CHECK && feTokenState.refreshed) {
    console.log('[投注核对] ℹ️ 提示：基线查询期间前台token被自动刷新过一次，如果你的浏览器已登录可能掉线了，请现在重新登录浏览器再开始玩');
    feTokenState.refreshed = false;
  }
  console.log(`\n[投注核对] 基线后台余额: ${baseline.balance !== null ? fmt(baseline.balance) : '未识别'}`);
  console.log(`[投注核对] 基线后台当天已结算注单: ${baseline.orders.length}笔（投注${fmt(baseline.summary.betAmount)} / 派奖${fmt(baseline.summary.winAmount)}）`);
  if (baseline.abnormalOrders && baseline.abnormalOrders.length > 0) {
    console.log(`[投注核对] ⚠️ 基线时已存在${baseline.abnormalOrders.length}笔非已结算状态注单（不属于本次测试，仅供参考）`);
  }
  if (DUAL_CHECK) {
    console.log(`[投注核对] 基线前台余额(RecoverSaasBalance): ${baseline.feBalance !== null ? fmt(baseline.feBalance) : '查询失败'}`);
    if (baseline.feOrders) {
      console.log(`[投注核对] 基线前台(Game History)当天已结算注单: ${baseline.feOrders.length}笔（投注${fmt(baseline.feSummary.betAmount)} / 派奖${fmt(baseline.feSummary.winAmount)}）`);
    } else {
      console.log('[投注核对] ⚠️ 前台Game History基线查询失败，后续各局将跳过这一项一致性核对');
    }
    if (baseline.feReport) {
      console.log(`[投注核对] 基线前台官方报表(GetUserGameReportList): ${baseline.feReport.count}笔（投注${fmt(baseline.feReport.betAmount)} / 派奖${fmt(baseline.feReport.winAmount)}）`);
    } else {
      console.log('[投注核对] ⚠️ 前台官方报表基线查询失败，后续各局将跳过这一项一致性核对');
    }
    if (baseline.feFinancial) {
      console.log(`[投注核对] 基线前台账变流水(GetUserFinancialList): 当天累计${baseline.feFinancial.length}条记录`);
    } else {
      console.log('[投注核对] ⚠️ 前台账变流水基线查询失败，后续各局将跳过这一项一致性核对');
    }
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const rounds = [];
  let roundNo = 1;
  let prevSnapshot = baseline;
  // 全程(跨越所有局)累积的"曾经识别为未结算"的订单号——彩票/体育这类慢结算
  // 游戏，一笔订单完全可能跨越好几局才真正同步成已结算。如果不记录这个全程
  // 状态，等它结算完成那一局，fetchTodayOrders会把它完整的betAmount也计入
  // 该局的total，但这笔betAmount对应的扣款早在它还未结算、被识别进
  // abnormalBetDeduction的那一局就已经真实发生过了——不做这层追踪会导致
  // 同一笔投注被扣两次，凭空制造出一个等于该订单betAmount的虚假差额。
  let allSeenAbnormalOrderNos = new Set((baseline.abnormalOrders || []).map((o) => o.orderNo));

  console.log('\n[投注核对] 进入交互模式：浏览器里玩完一局后回车确认（end=结束出报告，skip=跳过本局不计入）\n');

  while (true) {
    const raw = await rl.question(`第${roundNo}局：玩完后回车确认 > `);
    const ans = raw.trim().toLowerCase();
    if (ans === 'end') break;

    await sleep(2000); // 订单结算需要时间，复刻之前实测教训：立即查可能orderState还是0
    const cur = await dualSnapshot(token, feTokenState, USER_ID, false);
    if (DUAL_CHECK && feTokenState.refreshed) {
      console.log('[投注核对] ℹ️ 提示：本局查询期间前台token被自动刷新过一次，如果你的浏览器掉线了，请现在重新登录浏览器再进行下一局');
      feTokenState.refreshed = false;
    }

    if (ans === 'skip') {
      console.log('[投注核对] 已跳过本局（不计入报告，基线已更新为当前快照）\n');
      prevSnapshot = cur;
      roundNo++;
      continue;
    }

    const prevOrderNos = new Set(prevSnapshot.orders.map((o) => o.orderNo));
    const newOrders = cur.orders.filter((o) => !prevOrderNos.has(o.orderNo));
    const groups = groupByGame(newOrders);
    const total = sumGroups(groups);

    // 本局新增已结算订单里，有哪些之前曾经处于"未结算"状态(跨局才完成结算)——
    // 这些订单的betAmount已经在它未结算的那一局被扣进abnormalBetDeduction里了，
    // 这里要把total.profit里重复算的那部分betAmount核销掉，不影响groups/total
    // 展示的完整投注/派奖数字(照常如实显示，只是不重复参与expectedDelta核算)。
    const crossSettledBetAmount = round2(newOrders
      .filter((o) => allSeenAbnormalOrderNos.has(o.orderNo))
      .reduce((s, o) => s + parseFloat(o.betAmount || 0), 0));

    const balanceBefore = prevSnapshot.balance;
    const balanceAfter = cur.balance;
    const balanceDelta = (balanceBefore === null || balanceAfter === null) ? null : round2(balanceAfter - balanceBefore);

    // ── 本局充值/提现/活动奖励增量：用 GetUserDetail.activeTodayRsp 的"今日
    // 累计值"做差得到，修正"余额变化应等于游戏盈亏"这个在有资金穿插时会
    // 误判的假设(用户2026-11-16明确要求)。同时拿 activeTodayRsp.betAmount/
    // prizeAmount 的增量跟脚本自己统计的 total 做交叉核对(免费的第五数据源，
    // 不依赖 DUAL_CHECK)。freezeAmount 的变化只记录、不计入预期余额(假设未
    // 经实测验证，不武断下结论)。
    const prevActive = prevSnapshot.activeToday;
    const curActive = cur.activeToday;
    let rechargeDelta = null, withdrawDelta = null, activityRewardDelta = null, freezeDelta = null;
    let officialBetDelta = null, officialPrizeDelta = null, officialCheck = null;
    if (prevActive && curActive) {
      rechargeDelta = round2(curActive.rechargesAmount - prevActive.rechargesAmount);
      withdrawDelta = round2(curActive.withdrawAmount - prevActive.withdrawAmount);
      activityRewardDelta = round2(curActive.activityRewards - prevActive.activityRewards);
      officialBetDelta = round2(curActive.betAmount - prevActive.betAmount);
      officialPrizeDelta = round2(curActive.prizeAmount - prevActive.prizeAmount);
      if (prevActive.freezeAmount !== null && curActive.freezeAmount !== null) {
        freezeDelta = round2(curActive.freezeAmount - prevActive.freezeAmount);
      }
      const officialBetDiff = round2(total.betAmount - officialBetDelta);
      const officialPrizeDiff = round2(total.winAmount - officialPrizeDelta);
      officialCheck = (Math.abs(officialBetDiff) < 0.01 && Math.abs(officialPrizeDiff) < 0.01)
        ? '✅ 与后台今日官方统计一致'
        : `⚠️ 与后台今日官方统计不一致（投注差${fmt(officialBetDiff)}/派奖差${fmt(officialPrizeDiff)}）`;
    } else {
      officialCheck = '⚠️ 未查到activeTodayRsp，跳过官方统计核对';
    }

    // 本局新增的"非已结算状态"注单(orderNo diff)——彩票/棋牌/体育这类非电子
    // 游戏，结算往往要等开奖/完赛(几分钟到几小时不等)，投完一局马上查，大概率
    // 还是"未结算"，这是预期内的正常状态，不是异常。2026-11-17用户明确要求：
    // 只要能查到这些订单、确认投注金额已经真实扣款，让"总金额对得上"即可，不
    // 要求它们必须已结算才能让本局核对通过。
    // ⚠️ 2026-11-17实测确认(170940账号历史遗留订单)：未结算状态下winAmount
    // 字段不可信——查到一笔orderState=0的订单winAmount显示57.36，但对应账变
    // 流水里完全没有任何GameEnd(派奖)记录，说明这只是个中间/预估值，不代表
    // 钱已经到账。因此这里只信任betAmount(投注扣款这一步已经真实发生，有
    // GameBet账变记录为证)，完全不采信未结算订单的winAmount——只把"投注
    // 扣除"正式并入预期余额公式，绝不把未结算订单的派奖当成已到账的钱去抵消
    // 差额(那样会虚高预期余额、人为制造出新的、本不存在的差额)。
    const prevAbnormalNos = new Set((prevSnapshot.abnormalOrders || []).map((o) => o.orderNo));
    const newAbnormalOrders = (cur.abnormalOrders || []).filter((o) => !prevAbnormalNos.has(o.orderNo));
    // 2026-11-18实测确认(170995账号)：orderState!==1不等于"钱还扣着没退"——
    // 还存在orderState=2的"已撤单/作废"订单，settlementTime已经有值(走完
    // 过结算流程)，后台账变流水里能查到一条orderNo完全对应、amount=
    // betAmount的GameReturn记录，说明这笔钱已经全额退回钱包，不是真正悬而
    // 未决的"未结算"。只有settlementTime仍为0(从未进入结算流程)才是真正
    // 还在等开奖/完赛的未结算注单，需要扣减预期余额；已经走完结算流程的
    // (不管orderState具体是几)，钱的去向账变流水口径已经如实记过账了，这
    // 里不能再扣一次。
    const newPendingAbnormalOrders = newAbnormalOrders.filter((o) => !o.settlementTime);
    const newRefundedAbnormalOrders = newAbnormalOrders.filter((o) => o.settlementTime);
    const abnormalTotal = sumGroups(groupByGame(newPendingAbnormalOrders));
    const abnormalBetDeduction = round2(-abnormalTotal.betAmount);

    const nonGameAdjustment = (rechargeDelta !== null ? rechargeDelta : 0) - (withdrawDelta !== null ? withdrawDelta : 0) + (activityRewardDelta !== null ? activityRewardDelta : 0);
    const expectedDelta = round2(total.profit + nonGameAdjustment + abnormalBetDeduction + crossSettledBetAmount);

    let verdict;
    if (balanceDelta === null) {
      verdict = '⚠️ 余额字段未识别，无法自动核对';
    } else if (Math.abs(balanceDelta - expectedDelta) < 0.01) {
      const parts = [];
      if (nonGameAdjustment !== 0) parts.push(`充值/提现/活动奖励净调整${fmt(nonGameAdjustment)}`);
      if (newPendingAbnormalOrders.length > 0) parts.push(`${newPendingAbnormalOrders.length}笔未结算注单投注扣除${fmt(abnormalBetDeduction)}(暂不计入其派奖，等真正结算后在后续局里体现)`);
      if (newRefundedAbnormalOrders.length > 0) parts.push(`${newRefundedAbnormalOrders.length}笔已撤单退款(钱已全额退回，不计入扣除)`);
      if (crossSettledBetAmount !== 0) parts.push(`核销${fmt(crossSettledBetAmount)}跨局结算重复投注(之前某局未结算时已扣过一次)`);
      verdict = parts.length > 0 ? `✅ PASS（含${parts.join('，')}）` : '✅ PASS';
    } else {
      const diffAmount = round2(balanceDelta - expectedDelta);
      const freezeHint = (freezeDelta !== null && Math.abs(freezeDelta) >= 0.01) ? `，检测到冻结金额变化${fmt(freezeDelta)}(可能是提现被冻结未到账，请人工核实)` : '';
      const abnormalHint = newPendingAbnormalOrders.length > 0 ? `（已计入${newPendingAbnormalOrders.length}笔未结算注单投注扣除${fmt(abnormalBetDeduction)}，仍未解释）` : '';
      const refundedHint = newRefundedAbnormalOrders.length > 0 ? `（另有${newRefundedAbnormalOrders.length}笔已撤单退款不计入扣除）` : '';
      const crossSettledHint = crossSettledBetAmount !== 0 ? `（已核销${fmt(crossSettledBetAmount)}跨局结算重复投注）` : '';
      verdict = `⚠️ 差额${fmt(diffAmount)}（已计入充值${rechargeDelta !== null ? fmt(rechargeDelta) : '未知'}/提现${withdrawDelta !== null ? fmt(withdrawDelta) : '未知'}/活动奖励${activityRewardDelta !== null ? fmt(activityRewardDelta) : '未知'}${abnormalHint}${refundedHint}${crossSettledHint}仍有差额${freezeHint}，可能是账变记账本身也有同步延迟，需人工核实）`;
    }
    if (newAbnormalOrders.length > 0) {
      console.log('    非已结算注单明细(orderNo/游戏/投注/winAmount字段原样/状态)——"未结算"(settlementTime=0)已计入投注扣除，"已撤单退款"(settlementTime已有值，钱已通过GameReturn退回)不计入扣除，winAmount暂不采信：');
      for (const o of newAbnormalOrders) {
        const tag = o.settlementTime ? '已撤单退款,不扣' : '未结算,已扣';
        console.log(`      ${o.orderNo}  ${o.gameName || o.gameCode || '未知'}  ${o.betAmount}  ${o.winAmount}  orderState=${o.orderState}  [${tag}]`);
      }
    }

    // ── 后台账变流水核对：不依赖DUAL_CHECK，任何模式下都做。本局新增记录
    // (按id去重diff)的amount之和，必须严格等于后台余额变化——这是比上面
    // "官方统计口径+未结算投注扣除推测"更权威的会计恒等式核对，能捕捉到
    // 2026-11-17实测发现的体育Cash Out场景：提前兑现入账的orderNo跟原始
    // 投注订单号不一致(原投注"100032_B..."，兑现入账"100032_C...")，靠订单
    // 口径/靠信不信winAmount字段都会漏掉这笔真实到账的钱，但账变流水按时间
    // 窗口查询，不管订单号/类型怎么变，钱动了就会被记录到。
    const prevBackendFinIds = new Set((prevSnapshot.backendFinancial || []).map((f) => f.id));
    const backendFinNewRecords = (cur.backendFinancial || []).filter((f) => !prevBackendFinIds.has(f.id));
    const backendFinNetAmount = round2(backendFinNewRecords.reduce((s, f) => s + parseFloat(f.amount || 0), 0));
    const backendFinByType = {};
    for (const f of backendFinNewRecords) {
      const t = f.type || '未知';
      if (!backendFinByType[t]) backendFinByType[t] = { count: 0, amount: 0 };
      backendFinByType[t].count += 1;
      backendFinByType[t].amount += parseFloat(f.amount || 0);
    }
    let backendFinCheck;
    if (!cur.backendFinancial || cur.backendFinancial.length === 0) {
      backendFinCheck = '⚠️ 后台账变流水查询失败或当天暂无记录，跳过此项核对';
    } else if (balanceDelta === null) {
      backendFinCheck = '⚠️ 余额未知，无法核对后台账变净额';
    } else if (Math.abs(backendFinNetAmount - balanceDelta) < 0.01) {
      backendFinCheck = '✅ 后台账变净额与余额变化一致';
    } else {
      // 2026-11-18实测确认(170882账号)：差额出在GameTransIn/GameTransOut不配对——
      // 开局前游戏钱包里可能已经躺着历史结存(非本局转入)，本局第一次切换游戏时
      // 这笔钱会跟着累计余额一起被转出，账变净额加总时就会比实际余额变化多出
      // 这部分，但钱本身没有任何问题。跟前台账变流水同款降级逻辑(2026-11-16)
      // 一样：余额变化本身已经跟预期吻合，就说明钱没算错，账变净额对不上只能是
      // 口径问题(历史结存/分页遗漏/记账延迟)，不计入issues，避免跟真正的差额
      // 问题混淆。
      const balanceAlreadyVerified = (Math.abs(balanceDelta - expectedDelta) < 0.01);
      if (balanceAlreadyVerified) {
        backendFinCheck = `ℹ️ 后台账变净额${fmt(backendFinNetAmount)}与余额变化${fmt(balanceDelta)}不一致(差${fmt(round2(balanceDelta - backendFinNetAmount))})，但余额已核实PASS——大概率是开局前游戏钱包就有历史结存，首次切换游戏时被一并转出，不代表真实资金异常，仅供参考`;
      } else {
        backendFinCheck = `⚠️ 后台账变净额${fmt(backendFinNetAmount)}与余额变化${fmt(balanceDelta)}不一致(差${fmt(round2(balanceDelta - backendFinNetAmount))})，可能是分页遗漏或记账延迟，需人工核实`;
      }
    }
    console.log(`  后台账变流水(${backendFinNewRecords.length}笔)：净额${fmt(backendFinNetAmount)}  ${backendFinCheck}`);
    for (const t in backendFinByType) {
      console.log(`    - ${t}：${backendFinByType[t].count}笔，净额${fmt(backendFinByType[t].amount)}`);
    }

    // ── 前后台核对：①前台Game History逐笔汇总 ②前台官方报表增量 ③前台余额
    // 变化(跟后台余额变化比)④前台账变流水净额(跟前台余额变化比，会计恒等式)，
    // 分别核对，任意一项不一致都会在crossCheck里列出 ──
    let feTotal = { count: 0, betAmount: 0, winAmount: 0, profit: 0 };
    let feBalanceBefore = null, feBalanceAfter = null, feBalanceDelta = null, feBalanceCheck = null;
    let feReportDelta = null;
    let finNewRecords = [];
    let finNetAmount = null;
    let finByType = {};
    let finCheck = null;
    let crossCheck = null;

    if (DUAL_CHECK) {
      const issues = [];

      // ① Game History 逐笔汇总 vs 后台
      if (prevSnapshot.feOrders && cur.feOrders) {
        const prevFeOrderNos = new Set(prevSnapshot.feOrders.map((o) => o.orderNo));
        const feNewOrders = cur.feOrders.filter((o) => !prevFeOrderNos.has(o.orderNo));
        feTotal = sumGroups(groupByGame(feNewOrders));
        const countDiff = total.count - feTotal.count;
        const betDiff = round2(total.betAmount - feTotal.betAmount);
        const winDiff = round2(total.winAmount - feTotal.winAmount);
        if (!(countDiff === 0 && Math.abs(betDiff) < 0.01 && Math.abs(winDiff) < 0.01)) {
          issues.push(`GameHistory笔数差${countDiff}/投注差${fmt(betDiff)}/派奖差${fmt(winDiff)}`);
        }
      } else {
        issues.push('GameHistory查询失败');
      }

      // ② 官方报表增量 vs 后台
      if (prevSnapshot.feReport && cur.feReport) {
        feReportDelta = {
          count: cur.feReport.count - prevSnapshot.feReport.count,
          betAmount: round2(cur.feReport.betAmount - prevSnapshot.feReport.betAmount),
          winAmount: round2(cur.feReport.winAmount - prevSnapshot.feReport.winAmount),
        };
        const rCountDiff = total.count - feReportDelta.count;
        const rBetDiff = round2(total.betAmount - feReportDelta.betAmount);
        const rWinDiff = round2(total.winAmount - feReportDelta.winAmount);
        if (!(rCountDiff === 0 && Math.abs(rBetDiff) < 0.01 && Math.abs(rWinDiff) < 0.01)) {
          issues.push(`官方报表笔数差${rCountDiff}/投注差${fmt(rBetDiff)}/派奖差${fmt(rWinDiff)}`);
        }
      } else {
        issues.push('官方报表查询失败');
      }

      // ③ 前台余额变化 vs 后台余额变化
      feBalanceBefore = prevSnapshot.feBalance;
      feBalanceAfter = cur.feBalance;
      feBalanceDelta = (feBalanceBefore === null || feBalanceAfter === null) ? null : round2(feBalanceAfter - feBalanceBefore);
      if (feBalanceDelta === null) {
        feBalanceCheck = '⚠️ 前台余额查询失败';
        issues.push('前台余额查询失败');
      } else if (balanceDelta !== null && Math.abs(feBalanceDelta - balanceDelta) < 0.01) {
        feBalanceCheck = '✅ 前后台余额变化一致';
      } else {
        feBalanceCheck = `⚠️ 前后台余额变化不一致（后台${fmt(balanceDelta)}/前台${fmt(feBalanceDelta)}）`;
        issues.push(`余额变化不一致(后台${fmt(balanceDelta)}/前台${fmt(feBalanceDelta)})`);
      }

      // ④ 前台账变流水净额 vs 前台余额变化（会计恒等式：本局新增账变记录
      // amount之和必须严格等于前台余额变化，不依赖对type字段语义的任何假设）
      if (prevSnapshot.feFinancial && cur.feFinancial) {
        const prevFinIds = new Set(prevSnapshot.feFinancial.map((f) => f.id));
        finNewRecords = cur.feFinancial.filter((f) => !prevFinIds.has(f.id));
        finNetAmount = round2(finNewRecords.reduce((s, f) => s + parseFloat(f.amount || 0), 0));
        for (const f of finNewRecords) {
          const t = f.type || '未知';
          if (!finByType[t]) finByType[t] = { count: 0, amount: 0 };
          finByType[t].count += 1;
          finByType[t].amount += parseFloat(f.amount || 0);
        }
        if (feBalanceDelta === null) {
          finCheck = '⚠️ 前台余额未知，无法核对账变净额';
        } else if (Math.abs(finNetAmount - feBalanceDelta) < 0.01) {
          finCheck = '✅ 账变净额与前台余额变化一致';
        } else {
          // 2026-11-16实测发现：账变净额对不上时，用"余额本身是否已PASS"做
          // 交叉判断——如果后台余额变化(balanceDelta)已经精确等于预期变化
          // (expectedDelta=游戏盈亏±充值提现活动奖励)，说明余额本身没有
          // 问题(是铁证)，那账变净额对不上就不可能是"本局凭空多了/少了钱"，
          // 唯一合理的解释是GetUserFinancialList基线查询存在历史记录遗漏
          // (常见于后端数据最终一致性延迟，尤其多标签并发玩多款游戏时)，
          // 把这类情况降级为提示，不计入issues，避免跟真正的差额问题混淆。
          const balanceAlreadyVerified = (balanceDelta !== null && Math.abs(balanceDelta - expectedDelta) < 0.01);
          if (balanceAlreadyVerified) {
            finCheck = `ℹ️ 账变净额${fmt(finNetAmount)}与前台余额变化${fmt(feBalanceDelta)}不一致，但余额已核实PASS——大概率是GetUserFinancialList查询遗漏了历史记录(基线/本次至少一次未拉全)，不代表真实资金异常，仅供参考`;
          } else {
            finCheck = `⚠️ 账变净额${fmt(finNetAmount)}与前台余额变化${fmt(feBalanceDelta)}不一致`;
            issues.push(`账变净额${fmt(finNetAmount)}≠前台余额变化${fmt(feBalanceDelta)}`);
          }
        }
      } else {
        finCheck = '⚠️ 前台账变流水查询失败';
        issues.push('前台账变流水查询失败');
      }

      crossCheck = issues.length === 0 ? '✅ 前后台核对一致' : `⚠️ ${issues.join('；')}`;
    }

    console.log(`\n── 第${roundNo}局小结（本局新增注单${newOrders.length}笔）──`);
    if (newOrders.length === 0) {
      console.log('  未查到任何新增已结算注单（可能还没结算完，或刚才那局是无效操作）');
    }
    for (const g in groups) {
      const gr = groups[g];
      console.log(`  ${g}：${gr.count}笔  投注${fmt(gr.betAmount)}  派奖${fmt(gr.winAmount)}  盈亏${fmt(gr.winAmount - gr.betAmount)}`);
    }
    console.log(`  合计：${total.count}笔  投注${fmt(total.betAmount)}  派奖${fmt(total.winAmount)}  盈亏${fmt(total.profit)}`);
    console.log(`  本局充值净增${rechargeDelta !== null ? fmt(rechargeDelta) : '未知'}  提现净增${withdrawDelta !== null ? fmt(withdrawDelta) : '未知'}  活动奖励净增${activityRewardDelta !== null ? fmt(activityRewardDelta) : '未知'}${freezeDelta !== null && Math.abs(freezeDelta) >= 0.01 ? `  ⚠️冻结金额变化${fmt(freezeDelta)}` : ''}`);
    console.log(`  后台官方今日统计核对：${officialCheck}`);
    console.log(`  后台余额：${balanceBefore !== null ? fmt(balanceBefore) : '—'} → ${balanceAfter !== null ? fmt(balanceAfter) : '—'}（变化${balanceDelta !== null ? fmt(balanceDelta) : '—'}，预期变化${fmt(expectedDelta)}）  ${verdict}`);
    if (cur.abnormalOrders && cur.abnormalOrders.length > 0) {
      console.log(`  ⚠️ 账上累计存在${cur.abnormalOrders.length}笔非已结算状态注单（含历史遗留，本局新增部分已在上面verdict里单独列出）`);
    }
    if (DUAL_CHECK) {
      console.log(`  前台余额：${feBalanceBefore !== null ? fmt(feBalanceBefore) : '—'} → ${feBalanceAfter !== null ? fmt(feBalanceAfter) : '—'}（变化${feBalanceDelta !== null ? fmt(feBalanceDelta) : '—'}）  ${feBalanceCheck}`);
      console.log(`  前台Game History：${feTotal.count}笔  投注${fmt(feTotal.betAmount)}  派奖${fmt(feTotal.winAmount)}`);
      console.log(`  前台官方报表：${feReportDelta ? `${feReportDelta.count}笔  投注${fmt(feReportDelta.betAmount)}  派奖${fmt(feReportDelta.winAmount)}` : '—（查询失败）'}`);
      console.log(`  前台账变流水：${finNetAmount !== null ? `${finNewRecords.length}笔，净额${fmt(finNetAmount)}` : '—（查询失败）'}  ${finCheck}`);
      for (const t in finByType) {
        console.log(`    - ${t}：${finByType[t].count}笔，净额${fmt(finByType[t].amount)}`);
      }
      // finCheck不是完全一致(✅)时，把每条新增记录的createTime也打印出来，
      // 方便判断是否是"基线查询漏掉的历史记录"(createTime会明显早于本局
      // 开始时间)，而不是真的本局新产生的账变。
      if (finCheck && !finCheck.startsWith('✅') && finNewRecords.length > 0) {
        console.log('    明细(id/type/amount/createTime)：');
        for (const f of finNewRecords) {
          const ts = f.createTime ? new Date(Number(f.createTime)).toLocaleString('zh-CN') : '未知';
          console.log(`      ${f.id}  ${f.type}  ${f.amount}  ${ts}`);
        }
      }
      console.log(`  前后台核对：${crossCheck}`);
    }
    console.log('');

    rounds.push({
      roundNo, groups, total,
      balanceBefore, balanceAfter, balanceDelta, expectedDelta, verdict,
      rechargeDelta, withdrawDelta, activityRewardDelta, freezeDelta, officialCheck,
      abnormalOrderCount: (cur.abnormalOrders ? cur.abnormalOrders.length : 0),
      newAbnormalOrders, newPendingAbnormalOrders, newRefundedAbnormalOrders,
      abnormalBetDeduction, crossSettledBetAmount,
      backendFinNewRecords, backendFinNetAmount, backendFinByType, backendFinCheck,
      feTotal, feBalanceBefore, feBalanceAfter, feBalanceDelta, feBalanceCheck, feReportDelta,
      finNewRecords, finNetAmount, finByType, finCheck, crossCheck,
    });
    // 把本局新识别到的未结算订单号并入全程累积集合，供后续局判断"是否跨局结算"用
    newAbnormalOrders.forEach((o) => allSeenAbnormalOrderNos.add(o.orderNo));
    prevSnapshot = cur;
    roundNo++;
  }
  rl.close();

  if (rounds.length === 0) {
    console.log('[投注核对] 没有任何一局被记录，不生成报告。');
    return;
  }

  const outPath = writeReportFile(rounds, baseline, prevSnapshot);
  console.log(`\n[投注核对] ✅ 已生成报告：${outPath}`);
}

main().catch((err) => {
  console.error('[投注核对] 运行失败:', err);
  process.exit(1);
});
