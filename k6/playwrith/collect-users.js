/**
 * collect-users.js  —  多租户「采集 userId + account 写 1.txt / 2.txt」（Node 版）
 *
 * 替代 collectUserIds.test.js：k6 的 setup 与 handleSummary 跑在不同 runtime，
 * 模块变量传不过去，导致采集到数据却写不进文件。Node 直接 fs 写，无此问题。
 *
 * 产物（默认写到 firebase 目录，供 delivery-verify / firebaseBatchImport 用）：
 *   1.txt → userId 列表（后台定向发推送用）
 *   2.txt → account 列表（前端登录用，delivery-verify 读）
 *
 * 运行（PowerShell；TENANT 选租户）：
 *   $env:TENANT="3005"; $env:TARGET="50"; node collect-users.js
 *   $env:TENANT="3004"; $env:TARGET="200"; node collect-users.js
 *   自定义输出目录：$env:OUT_DIR="D:\\tmp"; node collect-users.js
 *
 * 签名口径复刻 libs/utils/signature.js：排除 signature/timestamp/track + 空值 → key 排序
 *   → JSON.stringify → MD5 大写（secret 空）；timestamp 不参与签名。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ───── 多租户后台配置（管理后台地址 + 管理员账号），摘自 k6/config/envconfig.js ─────
const TENANTS = {
  '3001': { admin: 'https://ar666999.club',                      user: 'carey3001'  },
  '3002': { admin: 'https://arsitasdfghjklg.com',                user: 'carey3002'  },
  '3003': { admin: 'https://3003-tenantadmin.ar666999.club',     user: 'carey3003'  },
  '3004': { admin: 'https://arsitasdfghjklusa.com',              user: 'carey3004'  },
  '3005': { admin: 'https://arsitasdfghj.com',                   user: 'carey3005'  },
  '3006': { admin: 'https://3006-tenantadmin.ar666999.club',     user: 'carey3006'  },
  '3007': { admin: 'https://3007-tenantadmin.ar666999.club',     user: 'carey3007'  },
  '3101': { admin: 'https://3101-tenantadmin.arplatsaasuat.com', user: 'carey_3101' },
};

const TENANT     = String(process.env.TENANT || process.env.TENANT_ID || '3004');
const T          = TENANTS[TENANT] || TENANTS['3004'];
const ADMIN_URL  = process.env.ADMIN_URL  || T.admin;
const ADMIN_USER = process.env.ADMIN_USER || T.user;
const ADMIN_PWD  = process.env.ADMIN_PWD  || 'qwer1234';
const TARGET     = parseInt(process.env.TARGET || '50', 10);
const PAGE_SIZE  = Math.min(parseInt(process.env.PAGE_SIZE || '500', 10), 500);
const LANG       = process.env.LANG_CODE || 'zh';
const SET_PWD    = process.env.SETPWD === 'true';              // SETPWD=true：采集后把这批账号登录密码重置为 NEW_PWD
const NEW_PWD    = process.env.NEW_PWD || 'qwer1234';
const OUT_DIR    = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(__dirname, '..', 'tests', 'api', 'activity', 'firebase');

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

// 加 random/language/timestamp + 签名（复刻 tenantRequest）
function withSign(payload) {
  const random = Math.floor(1e11 + Math.random() * 9e11); // 保证 12 位（后台校验 Random 必须是 12 位数字）
  const base = { ...payload, random, language: payload.language || LANG };
  const signature = sign(base);
  return { ...base, timestamp: Math.floor(Date.now() / 1000), signature };
}

async function post(api, payload, token) {
  const headers = { 'Content-Type': 'application/json', 'Domainurl': ADMIN_URL, 'Referrer': ADMIN_URL };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(`${ADMIN_URL}${api}`, { method: 'POST', headers, body: JSON.stringify(withSign(payload)) });
  const text = await resp.text();
  let j = null; try { j = JSON.parse(text); } catch (e) { /* 非 JSON */ }
  const code = j ? (j.msgCode !== undefined ? j.msgCode : j.code) : null;
  return { status: resp.status, code, data: j ? j.data : null, msg: j ? j.msg : null, text };
}

// 后台重置会员登录密码：/api/Users/UpdatePassword {userId, password}（签名口径同上，已反算 MATCH 验证）
async function setPassword(userId, token) {
  const r = await post('/api/Users/UpdatePassword', { userId, password: NEW_PWD }, token);
  return { ok: r.code === 0, code: r.code, msg: r.msg };
}

(async () => {
  console.log(`[采集] 租户 ${TENANT}  后台 ${ADMIN_URL}  admin ${ADMIN_USER}  目标 ${TARGET} 条`);

  // 1) 后台登录
  const login = await post('/api/Login/Login', { userName: ADMIN_USER, pwd: ADMIN_PWD });
  const token = login.data && login.data.token;
  if (login.code !== 0 || !token) {
    console.error(`[采集] ❌ 后台登录失败: code=${login.code} msg=${login.msg || login.text.slice(0, 200)}`);
    process.exit(1);
  }
  console.log('[采集] ✅ 后台登录成功');

  // 2) 分页拉取 userId + account
  const users = [];
  for (let pageNo = 1; users.length < TARGET; pageNo++) {
    const r = await post('/api/Users/GetPageList', { userType: 0, pageNo, pageSize: PAGE_SIZE, orderBy: 'Desc' }, token);
    if (r.code !== 0 || !r.data || !Array.isArray(r.data.list)) {
      console.error(`[采集] ❌ 第 ${pageNo} 页失败: code=${r.code} msg=${r.msg || r.text.slice(0, 200)}`);
      break;
    }
    if (pageNo === 1) console.log(`[采集] 总用户数: ${r.data.totalCount}`);
    for (const u of r.data.list) {
      users.push({ userId: u.userId, account: u.account });
      if (users.length >= TARGET) break;
    }
    console.log(`[采集] 第 ${pageNo} 页，累计 ${users.length}`);
    if (r.data.list.length < PAGE_SIZE) break; // 没有更多页
  }

  const final = users.slice(0, TARGET);
  if (final.length === 0) { console.error('[采集] ❌ 未采集到任何用户'); process.exit(1); }

  // 3) 写文件
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, '1.txt'), final.map(u => u.userId).join('\n'), 'utf-8');
  fs.writeFileSync(path.join(OUT_DIR, '2.txt'), final.map(u => u.account).join('\n'), 'utf-8');
  console.log(`[采集] ✅ 已写入 ${OUT_DIR}`);
  console.log(`[采集]    1.txt (userId) 与 2.txt (account)，共 ${final.length} 条`);

  // 4) 可选：批量把这批账号登录密码重置为 NEW_PWD（分批并发，避免限流）
  if (SET_PWD) {
    console.log(`[改密] 开始把 ${final.length} 个账号密码重置为「${NEW_PWD}」...`);
    let ok = 0, fail = 0;
    const fails = [];
    const sleep = (ms) => new Promise(res => setTimeout(res, ms));
    // 串行 + 错峰（降后台限流）；失败若疑似限流(code=13/11)重试一次；记录具体 code/msg 便于定位
    for (let i = 0; i < final.length; i++) {
      const u = final[i];
      let r = await setPassword(u.userId, token);
      if (!r.ok && (r.code === 13 || r.code === 11)) { await sleep(800); r = await setPassword(u.userId, token); }
      if (r.ok) ok++; else { fail++; fails.push({ userId: u.userId, code: r.code, msg: r.msg }); }
      if ((i + 1) % 10 === 0 || i + 1 === final.length) console.log(`[改密] 进度 ${i + 1}/${final.length}  成功 ${ok} 失败 ${fail}`);
      await sleep(150);
    }
    console.log(`[改密] ✅ 完成：成功 ${ok} / 失败 ${fail}`);
    if (fails.length) {
      console.log('[改密] 失败明细（看 msg 定位原因）:');
      fails.slice(0, 20).forEach(f => console.log(`   userId=${f.userId}  code=${f.code}  msg=${f.msg}`));
    }
  } else {
    console.log('[采集] 提示：加 $env:SETPWD="true" 可把这批账号密码统一重置为 qwer1234');
  }
})().catch((e) => { console.error('[采集] 运行失败:', e.message); process.exit(1); });
