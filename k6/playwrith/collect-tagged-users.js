/**
 * collect-tagged-users.js  —  Firebase推送"组合标签"定向：采集命中/不命中会员（Node版）
 *
 * 背景：Firebase推送新增"组合标签"定向(targetType=17)，只有命中指定组合标签的
 * 会员才应该收到推送。要验证这个功能，需要：
 *   1. 随机挑几个已配置好的组合标签
 *   2. 找出命中这些标签的会员(正向，10-13个)和确定不命中的会员(反向，3-6个)
 *   3. 把这批会员的密码重置成统一测试密码，供 delivery-verify.js 真实登录
 *
 * ⚠️ 2026-11-12 实测踩坑并修复：原来"反向(不命中)账号"直接用全新注册账号，
 *   假设"全新账号天然不可能有任何标签"——这个假设是错的！组合标签底下的基础
 *   标签条件可能是"总亏损小于1"这种"零活动账号天然满足"的宽松条件，全新账号
 *   亏损=0，天然满足"<1"，照样会命中。实测曾因此把3个新注册账号误判成"反向"，
 *   结果它们真的收到了推送——不是推送功能有bug，是反向账号没验证清楚。现在
 *   注册后会立刻查一次详情，确认真的不命中选中的任何一个标签才收进反向名单，
 *   命中了就丢掉重新注册一个，带重试次数上限。
 *
 * 本次(2026-11-11/12)实测确认的关键事实：
 *   - 组合标签列表接口是 POST /api/TagConfig/GetCompositeTagPageList（不是
 *     GetCompositeTagPageData，仓库里两个接口名都出现过，这次实测确认后台
 *     "组合标签"页面用的是GetCompositeTagPageList），响应直接是数组，每项
 *     id=标签ID，tagName=标签名。
 *   - 会员详情 POST /api/Users/GetUserDetail（payload {userId}）响应体顶层
 *     有 tagCompositeList 字段，数组每项的ID字段叫 tagId（不是id）。
 *   - 没有"按标签筛选会员列表"的一步到位接口，只能分页拉会员列表(GetPageList，
 *     userType必须传数组[0])逐个查详情比对，所以设了扫描页数上限，避免扫不
 *     到时死循环。
 *   - 反向(不命中)会员最简单可靠的办法是直接注册全新账号(走前台/api/Home/Register，
 *     不是管理后台接口)——全新账号天然不可能有任何标签，不用验证。
 *
 * 产物(默认写到 k6/tests/api/activity/firebase/ 目录，供推送脚本/delivery-verify.js用)：
 *   tagIds.txt            → 本次选中的组合标签ID，逗号分隔，单行
 *   positive-accounts.txt → 命中标签的会员账号，每行一个
 *   negative-accounts.txt → 不命中标签的会员账号(全新账号)，每行一个
 *   2.txt                 → positive+negative 合并(delivery-verify.js默认读这个)
 *
 * 运行（PowerShell；TENANT 选租户）：
 *   $env:TENANT="3004"; node collect-tagged-users.js
 *   自定义数量：$env:TAG_COUNT="4"; $env:POSITIVE_COUNT="12"; $env:NEGATIVE_COUNT="5"; node collect-tagged-users.js
 *   自定义输出目录：$env:OUT_DIR="D:\\tmp"; node collect-tagged-users.js
 *
 * 签名口径复刻 libs/utils/signature.js（同 collect-users.js）：排除
 *   signature/timestamp/track + 空值 → key 排序 → JSON.stringify → MD5 大写
 *   （secret 空）；timestamp 不参与签名。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ───── 读取项目根目录 .env（真实账号密码/密钥，不进 git） ─────
function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error(`[采集] ❌ 找不到 ${envPath}`);
    console.error('[采集]    请复制 .env.example 为 .env 并填入真实配置值后重试。');
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

// ───── 多租户配置（管理后台地址 + 前台地址 + 管理员账号 + 区号），读取自 .env ─────
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

const TENANT         = String(process.env.TENANT || process.env.TENANT_ID || '3004');
const T              = TENANTS[TENANT] || TENANTS['3004'];
const ADMIN_URL      = process.env.ADMIN_URL || T.admin;
const DESK_URL       = process.env.DESK_URL || T.desk;
const ADMIN_USER     = process.env.ADMIN_USER || T.user;
const ADMIN_PWD      = process.env.ADMIN_PWD || ENV_FILE[`ENV_${TENANT}_ADMIN_PASSWORD`] || '';
const COUNTRY_CODE   = process.env.COUNTRY_CODE || T.code || '91';
const NEW_PWD        = process.env.NEW_PWD || ENV_FILE['DEFAULT_TEST_PASSWORD'] || '';
const LANG           = process.env.LANG_CODE || 'zh';
const OUT_DIR        = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(__dirname, '..', 'tests', 'api', 'activity', 'firebase');

// 随机范围：没指定就在[lo,hi]里随机取一个整数
function randIntInclusive(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

const TAG_COUNT      = process.env.TAG_COUNT ? parseInt(process.env.TAG_COUNT, 10) : randIntInclusive(3, 6);
const POSITIVE_COUNT = process.env.POSITIVE_COUNT ? parseInt(process.env.POSITIVE_COUNT, 10) : randIntInclusive(10, 13);
const NEGATIVE_COUNT = process.env.NEGATIVE_COUNT ? parseInt(process.env.NEGATIVE_COUNT, 10) : randIntInclusive(3, 6);
const MAX_SCAN_PAGES = parseInt(process.env.MAX_SCAN_PAGES || '50', 10);
const SCAN_PAGE_SIZE = Math.min(parseInt(process.env.SCAN_PAGE_SIZE || '100', 10), 500);

// ───── 后台谷歌验证码(TOTP)，复刻 collect-users.js ─────
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

// 签名：排除 signature/timestamp/track + 空值 → 排序 → JSON → MD5 大写（secret 空）
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
  const random = Math.floor(1e11 + Math.random() * 9e11); // 保证 12 位
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
const postDesk  = (api, payload, token) => post(DESK_URL, api, payload, token);

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// ───── 随机手机号/字符串生成（复刻 accountGenerator.js / utils.js 的逻辑） ─────
let _seq = 0;
function generateRandomPhone(countryCode) {
  const targetLength = countryCode === '880' ? 13 : 12;
  const N = targetLength - countryCode.length;
  const t4 = String(Math.floor(Date.now() / 1000) % 10000).padStart(4, '0');
  const s2 = String(_seq++ % 100).padStart(2, '0');
  const randLen = Math.max(0, N - t4.length - s2.length);
  let randPart = '';
  for (let i = 0; i < randLen; i++) randPart += Math.floor(Math.random() * 10);
  let number = (t4 + s2 + randPart).slice(0, N);
  if (number[0] === '0') number = '1' + number.slice(1);
  return countryCode + number;
}
function generateCryptoRandomString(length) {
  const charset = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) result += charset[bytes[i] % charset.length];
  return result;
}

// 后台登录：带vCode(TOTP)，拒绝时自动试相邻时间窗口(容忍时钟偏差)，复刻 collect-users.js
async function adminLogin() {
  let login;
  const baseSec = Math.floor(Date.now() / 1000);
  for (const off of (GOOGLE_SECRET ? [0, -1, 1] : [null])) {
    const payload = { userName: ADMIN_USER, pwd: ADMIN_PWD };
    if (off !== null) { payload.vCode = totp(GOOGLE_SECRET, off, baseSec); console.log(`[采集] 🔐 vCode=${payload.vCode}${off ? ` (窗口${off > 0 ? '+' : ''}${off})` : ''}`); }
    login = await postAdmin('/api/Login/Login', payload);
    if ((login.code === 0 && login.data && login.data.token) || !(login.code === 1119 || login.code === 11 || /vcode/i.test(login.msg || ''))) break;
    if (off !== null) console.log(`[采集]   窗口${off} 被拒: ${login.msg}`);
  }
  return login;
}

// 前台注册全新账号
async function registerCleanUser() {
  const phone = generateRandomPhone(COUNTRY_CODE);
  const payload = {
    loginType: 'Mobile',
    userName: phone,
    password: NEW_PWD,
    inviteCode: '',
    code: '',
    captchaId: null,
    deviceId: '',
    browserId: generateCryptoRandomString(32),
    packageName: ''
  };
  const resp = await postDesk('/api/Home/Register', payload);
  if (resp.code !== 0) return null;
  return { account: phone, userId: resp.data && resp.data.userId };
}

// 注册一个"验证过真的不命中选中标签"的反向账号(带重试上限)。返回
// {user}(成功) 或 {blockedByTagId}(达到重试上限，且全部失败都卡在同一个
// tagId——这种情况极可能是这个标签的判定条件对"全新零活动账号"来说天然必中
// (比如"总亏损小于1"：没下过注的人亏损=0，天然满足<1)，调用方应该把这个
// tagId从候选集里剔除再重试，而不是无限重试同一个必然失败的组合。
async function registerVerifiedNegativeUser(adminToken, pickedTagIds, maxAttempts) {
  const blockingHits = []; // 记录每次失败具体卡在哪个tagId，用于判断是否"全部同一个"
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const u = await registerCleanUser();
    if (!u || !u.userId) { await sleep(300); continue; }
    await sleep(500); // 给后台一点时间把标签判定结果写进详情(实测很快，留点余量)
    const detailResp = await postAdmin('/api/Users/GetUserDetail', { userId: String(u.userId) }, adminToken);
    const tagList = (detailResp.data && detailResp.data.tagCompositeList) || [];
    const hit = tagList.find(t => pickedTagIds.some(id => String(t.tagId) === String(id)));
    if (!hit) return { user: u };
    blockingHits.push(String(hit.tagId));
    console.warn(`[采集] ⚠️ 第${attempt}次尝试的反向账号userId=${u.userId}意外命中了标签`
      + `tagId=${hit.tagId}(${hit.tagName})，丢弃重新注册一个`);
    await sleep(300);
  }
  const allSameTag = blockingHits.length === maxAttempts && blockingHits.every(id => id === blockingHits[0]);
  return { blockedByTagId: allSameTag ? blockingHits[0] : null };
}

// 在"确保候选标签集里没有对全新账号来说必中的catch-all标签"这件事上做尽力
// 探测：先尝试注册一个验证过的反向账号；如果连续撞在同一个tagId上，就把它从
// 候选集里剔除，有剩余未选中的标签就换一个补进来，没有就缩小候选集，重试。
// 返回 {finalTagIds, sampleNegativeUser}（sampleNegativeUser可以直接算进
// 反向账号名单的第一个，不用再重复验证一次）。
async function stabilizeTagSet(adminToken, initialTagIds, allTags, maxRounds) {
  let activeTagIds = [...initialTagIds];
  const unusedPool = allTags.filter(t => !activeTagIds.includes(t.id)).map(t => t.id);

  for (let round = 1; round <= maxRounds; round++) {
    const result = await registerVerifiedNegativeUser(adminToken, activeTagIds, 5);
    if (result.user) {
      return { finalTagIds: activeTagIds, sampleNegativeUser: result.user };
    }
    if (!result.blockedByTagId) {
      // 失败原因不集中在同一个tagId上(可能是零散的巧合命中)，直接按原集合继续走，
      // 后续正式收集反向账号时各自重试即可，这里不用死磕出一个必然成功的样本。
      console.warn('[采集] ⚠️ 验证反向账号时多次失败但卡的标签不固定，不做候选集调整，继续用当前标签集');
      return { finalTagIds: activeTagIds, sampleNegativeUser: null };
    }
    const culpritIdx = activeTagIds.findIndex(id => String(id) === result.blockedByTagId);
    const culpritTag = allTags.find(t => String(t.id) === result.blockedByTagId);
    console.warn(`[采集] ⚠️ 标签 id=${result.blockedByTagId}(${culpritTag ? culpritTag.tagName : '?'}) 对全新账号来说`
      + `几乎必中(连续${5}次重试全部卡在它上面)，判定为catch-all标签，从候选集剔除`);
    if (culpritIdx >= 0) activeTagIds.splice(culpritIdx, 1);
    if (unusedPool.length > 0) {
      const replacement = unusedPool.shift();
      const replacementTag = allTags.find(t => t.id === replacement);
      console.log(`[采集] 👉 换补一个标签: id=${replacement}(${replacementTag ? replacementTag.tagName : '?'})`);
      activeTagIds.push(replacement);
    } else {
      console.warn('[采集] ⚠️ 没有更多未选中的标签可以换补，候选集缩小为' + activeTagIds.length + '个');
    }
    if (activeTagIds.length === 0) {
      console.error('[采集] ❌ 候选标签集已经被剔除到0个，全部都是catch-all标签，无法继续');
      process.exit(1);
    }
  }
  console.warn(`[采集] ⚠️ 尝试了${maxRounds}轮调整候选集仍未能验证出一个反向账号，直接用当前集合继续往下走`);
  return { finalTagIds: activeTagIds, sampleNegativeUser: null };
}

async function setPassword(userId, token) {
  const r = await postAdmin('/api/Users/UpdatePassword', { userId, password: NEW_PWD }, token);
  return { ok: r.code === 0, code: r.code, msg: r.msg };
}

(async () => {
  console.log(`[采集] 租户 ${TENANT}  管理后台 ${ADMIN_URL}  前台 ${DESK_URL}  admin ${ADMIN_USER}`);
  console.log(`[采集] 本次目标：随机挑 ${TAG_COUNT} 个组合标签，凑 ${POSITIVE_COUNT} 个命中会员 + ${NEGATIVE_COUNT} 个不命中会员`);

  // 1) 后台登录
  const login = await adminLogin();
  const token = login.data && login.data.token;
  if (login.code !== 0 || !token) {
    console.error(`[采集] ❌ 后台登录失败: code=${login.code} msg=${login.msg || (login.text || '').slice(0, 200)}`);
    process.exit(1);
  }
  console.log('[采集] ✅ 后台登录成功');

  // 2) 拿组合标签列表，随机挑 TAG_COUNT 个
  const tagsResp = await postAdmin('/api/TagConfig/GetCompositeTagPageList', { pageNo: 1, pageSize: 50, orderBy: 'Desc' }, token);
  const allTags = Array.isArray(tagsResp.data) ? tagsResp.data : (tagsResp.data && tagsResp.data.list) || [];
  if (allTags.length === 0) {
    console.error('[采集] ❌ 当前环境没有任何组合标签，无法继续(请先在后台"会员标签管理→组合标签"创建几个)');
    process.exit(1);
  }
  // 洗牌后取前N个(N不超过现有标签总数)
  const shuffled = [...allTags].sort(() => Math.random() - 0.5);
  const initialPickedTags = shuffled.slice(0, Math.min(TAG_COUNT, allTags.length));
  const initialPickedTagIds = initialPickedTags.map(t => t.id);
  console.log(`[采集] 共有 ${allTags.length} 个组合标签，随机选中 ${initialPickedTags.length} 个:`);
  initialPickedTags.forEach(t => console.log(`[采集]   - id=${t.id}  ${t.tagName}`));

  // 2.5) 先确保候选集里没有"对全新零活动账号来说必中"的catch-all标签——必须
  //    在扫描命中会员之前做，不然等正式收集反向账号时才发现某个标签必中，
  //    为了剔除它又得把已经扫好的命中会员名单作废重来(这次标签集变了，
  //    之前命中的会员可能是靠"只命中了被剔除的那个标签"才进来的，不能直接复用)。
  const stabilized = await stabilizeTagSet(token, initialPickedTagIds, allTags, 3);
  const pickedTagIds = stabilized.finalTagIds;
  if (pickedTagIds.join(',') !== initialPickedTagIds.join(',')) {
    const finalTags = pickedTagIds.map(id => allTags.find(t => t.id === id)).filter(Boolean);
    console.log(`[采集] 最终确认的标签集(已剔除catch-all标签): ${pickedTagIds.join(',')}`);
    finalTags.forEach(t => console.log(`[采集]   - id=${t.id}  ${t.tagName}`));
  }

  // 3) 分页扫会员列表 + 查详情，凑够 POSITIVE_COUNT 个命中会员
  const positives = []; // {userId, account}
  let pageNo = 1;
  let scannedMembers = 0;
  while (positives.length < POSITIVE_COUNT && pageNo <= MAX_SCAN_PAGES) {
    const listResp = await postAdmin('/api/Users/GetPageList', { userType: [0], pageNo, pageSize: SCAN_PAGE_SIZE, orderBy: 'Desc' }, token);
    const list = (listResp.data && listResp.data.list) || [];
    if (list.length === 0) { console.log(`[采集] 第${pageNo}页为空，会员列表已扫完`); break; }

    for (const u of list) {
      if (positives.length >= POSITIVE_COUNT) break;
      scannedMembers++;
      const detailResp = await postAdmin('/api/Users/GetUserDetail', { userId: String(u.userId) }, token);
      const tagList = (detailResp.data && detailResp.data.tagCompositeList) || [];
      if (tagList.some(t => pickedTagIds.some(id => String(t.tagId) === String(id)))) {
        positives.push({ userId: u.userId, account: u.account });
        console.log(`[采集] ✅ 命中 第${positives.length}/${POSITIVE_COUNT} 个: userId=${u.userId} account=${u.account}`);
      }
      await sleep(80); // 降低查详情的请求频率，避免触发限流
    }
    console.log(`[采集] 第${pageNo}页扫完，累计扫描会员${scannedMembers}个，已凑够命中会员${positives.length}/${POSITIVE_COUNT}个`);
    pageNo++;
  }

  if (positives.length === 0) {
    console.error(`[采集] ❌ 扫描了${scannedMembers}个会员(${pageNo - 1}页)，一个命中选中标签的会员都没找到——`
      + `换一批标签重跑试试(这几个标签可能当前命中率为0)`);
    process.exit(1);
  }
  if (positives.length < POSITIVE_COUNT) {
    console.warn(`[采集] ⚠️ 扫到页数上限(${MAX_SCAN_PAGES}页)，只凑到${positives.length}/${POSITIVE_COUNT}个命中会员，`
      + `继续用实际找到的数量往下走`);
  }

  // 4) 反向(不命中)：注册全新账号后立刻验证真的不命中选中的任何一个标签
  //    (2026-11-12教训：不能假设"全新账号天然没有标签"，见文件头说明)。
  //    stabilizeTagSet阶段如果已经顺手验证出一个，直接拿来用，不用重复注册。
  const negatives = [];
  if (stabilized.sampleNegativeUser) {
    negatives.push(stabilized.sampleNegativeUser);
    console.log(`[采集] ✅ 复用标签集稳定化阶段验证过的反向账号 1/${NEGATIVE_COUNT}: `
      + `userId=${stabilized.sampleNegativeUser.userId} account=${stabilized.sampleNegativeUser.account}`);
  }
  for (let i = negatives.length; i < NEGATIVE_COUNT; i++) {
    const result = await registerVerifiedNegativeUser(token, pickedTagIds, 5);
    if (result.user) {
      negatives.push(result.user);
      console.log(`[采集] ✅ 新注册并验证过的反向账号 ${i + 1}/${NEGATIVE_COUNT}: userId=${result.user.userId} account=${result.user.account}`);
    } else {
      console.warn(`[采集] ⚠️ 第${i + 1}个反向账号尝试多次仍命中标签或注册失败，跳过`);
    }
    await sleep(300);
  }
  if (negatives.length === 0) {
    console.error('[采集] ❌ 一个反向账号都没注册成功，无法继续');
    process.exit(1);
  }

  // 5) 密码统一重置为测试密码(命中会员是老账号，密码未知，必须重置才能登录；
  //    反向账号注册时已经用NEW_PWD设了密码，这里重置一遍也无妨，保持一致)
  console.log(`[改密] 开始把 ${positives.length + negatives.length} 个账号密码重置为「${NEW_PWD}」...`);
  let pwdOk = 0, pwdFail = 0;
  for (const u of [...positives, ...negatives]) {
    const r = await setPassword(u.userId, token);
    if (r.ok) pwdOk++; else { pwdFail++; console.warn(`[改密] ⚠️ userId=${u.userId} 失败: code=${r.code} msg=${r.msg}`); }
    await sleep(150);
  }
  console.log(`[改密] ✅ 完成：成功 ${pwdOk} / 失败 ${pwdFail}`);

  // 6) 写文件
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'tagIds.txt'), pickedTagIds.join(','), 'utf-8');
  fs.writeFileSync(path.join(OUT_DIR, 'positive-accounts.txt'), positives.map(u => u.account).join('\n'), 'utf-8');
  fs.writeFileSync(path.join(OUT_DIR, 'negative-accounts.txt'), negatives.map(u => u.account).join('\n'), 'utf-8');
  fs.writeFileSync(path.join(OUT_DIR, '2.txt'), [...positives, ...negatives].map(u => u.account).join('\n'), 'utf-8');

  console.log(`\n[采集] ========== 完成 ==========`);
  console.log(`[采集] 选中的组合标签ID(tagIds.txt): ${pickedTagIds.join(',')}`);
  console.log(`[采集] 命中会员(positive-accounts.txt): ${positives.length}个`);
  console.log(`[采集] 不命中会员(negative-accounts.txt): ${negatives.length}个`);
  console.log(`[采集] 合并账号(2.txt): ${positives.length + negatives.length}个`);
  console.log(`[采集] 已写入 ${OUT_DIR}`);
  console.log(`[采集] 下一步：node delivery-verify.js (COUNT给够总数) ，然后另开终端跑`
    + ` k6 run ../tests/api/activity/firebase/firebaseCompositeTagPush.test.js`);
})().catch((e) => { console.error('[采集] 运行失败:', e.message); process.exit(1); });
