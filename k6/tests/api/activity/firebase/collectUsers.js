/**
 * collectUsers.js  —  Node 版用户采集器（并发翻页 + 写文件）
 *
 * 为什么不用 k6：
 *   k6 的 handleSummary 跑在独立运行时，拿不到 setup 采集的数据，
 *   而 k6 又只能在 handleSummary 里写文件 —— 采集数据根本传不过去。
 *   所以改用 Node：同样的分页 + MD5 签名逻辑，但能直接并发并写文件。
 *
 * 输出：
 *   1.txt → userId 列表（每行一个）
 *   2.txt → account 账号列表（每行一个）
 *   两个文件行数一致、一一对应。
 *
 * 运行（在本目录下）：
 *   node collectUsers.js
 *   TARGET=25000 THREADS=5 node collectUsers.js
 *   TENANT=3004 TARGET=25000 THREADS=10 node collectUsers.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ============================================================
// 租户配置（与 k6 envconfig 对应；可用环境变量覆盖）
// ============================================================
const TENANTS = {
  '3004': { BASE_ADMIN_URL: 'https://arsitasdfghjklusa.com', ADMIN_USERNAME: 'carey3004', ADMIN_PASSWORD: 'qwer1234', LANGUAGE: 'en' },
  '3005': { BASE_ADMIN_URL: 'https://arsitasdfghj.com',      ADMIN_USERNAME: 'carey3005', ADMIN_PASSWORD: 'qwer1234', LANGUAGE: 'en' },
};

const TENANT    = process.env.TENANT || '3004';
const cfg       = TENANTS[TENANT] || TENANTS['3004'];
const BASE_URL  = process.env.BASE_ADMIN_URL || cfg.BASE_ADMIN_URL;
const USERNAME  = process.env.ADMIN_USERNAME || cfg.ADMIN_USERNAME;
const PASSWORD  = process.env.ADMIN_PASSWORD || cfg.ADMIN_PASSWORD;
const LANGUAGE  = process.env.LANGUAGE || cfg.LANGUAGE || 'en';

const TARGET    = parseInt(process.env.TARGET     || '25000', 10);
const PAGE_SIZE = parseInt(process.env.PAGE_SIZE  || '500',   10);
const THREADS   = parseInt(process.env.THREADS    || '5',     10);
// 从第几页开始采集（默认 1；设 2 则跳过第 1 页）
const START_PAGE = Math.max(2, parseInt(process.env.START_PAGE || '1', 10));

const OUT_DIR   = __dirname;
const TAG       = 'CollectUsers';

// ============================================================
// 签名：与 libs/utils/signature.js 完全一致
// md5( JSON.stringify(排序后的过滤对象) + secret ).toUpperCase()，secret=''
// 过滤掉 signature/timestamp/track 及 null/undefined/''
// ============================================================
function md5Upper(s) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex').toUpperCase();
}

function calcSignature(data, secret = '') {
  const exclude = new Set(['signature', 'timestamp', 'track']);
  const filtered = {};
  for (const k of Object.keys(data)) {
    const v = data[k];
    if (!exclude.has(k) && v !== null && v !== undefined && v !== '') filtered[k] = v;
  }
  const sorted = {};
  Object.keys(filtered).sort().forEach(k => { sorted[k] = filtered[k]; });
  return md5Upper(JSON.stringify(sorted) + secret);
}

// 12 位随机数
function random12() {
  return Math.floor(Math.random() * 900000000000) + 100000000000;
}

// 给 payload 加 random/language/timestamp/signature
function signBody(payload) {
  const data = {
    ...payload,
    random:    random12(),
    language:  LANGUAGE,
    timestamp: Math.floor(Date.now() / 1000)
  };
  data.signature = calcSignature(data);
  return JSON.stringify(data);
}

// ============================================================
// HTTP
// ============================================================
async function post(api, payload, token) {
  const headers = {
    'Content-Type': 'application/json',
    'Domainurl':    BASE_URL,
    'Referrer':     BASE_URL
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res  = await fetch(BASE_URL + api, { method: 'POST', headers, body: signBody(payload) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
  const code = json ? (json.msgCode !== undefined ? json.msgCode : json.code) : null;
  return { status: res.status, json, code };
}

async function adminLogin() {
  const { json, code } = await post('/api/Login/Login', { userName: USERNAME, pwd: PASSWORD });
  if (code === 0 && json && json.data && json.data.token) return json.data.token;
  throw new Error(`后台登录失败: ${json ? json.msg : 'null'}`);
}

async function fetchPage(token, pageNo) {
  const { json, code } = await post('/api/Users/GetPageList', {
    userType: 0, pageNo, pageSize: PAGE_SIZE, orderBy: 'Desc'
  }, token);
  if (code !== 0 || !json || !json.data) return null;
  return json.data;
}

// ============================================================
// 主流程：并发翻页采集
// ============================================================
async function main() {
  console.log(`[${TAG}] ========== 开始 ==========`);
  console.log(`[${TAG}] 租户: ${TENANT} | 目标: ${TARGET} 条 | 每页: ${PAGE_SIZE} | 并发线程: ${THREADS} | 起始页: ${START_PAGE}`);
  console.log(`[${TAG}] 后台: ${BASE_URL}`);

  const token = await adminLogin();
  console.log(`[${TAG}] ✅ 后台登录成功`);

  // 起始页：拿 totalCount + 该页数据（totalCount 在任意页响应里都有）
  const first = await fetchPage(token, START_PAGE);
  if (!first) throw new Error(`[${TAG}] 第${START_PAGE}页请求失败`);

  const totalCount   = first.totalCount || 0;
  const totalPages   = Math.ceil((totalCount || TARGET) / PAGE_SIZE);  // 可用总页数
  const needCount    = Math.min(TARGET, totalCount || TARGET);
  // 从 START_PAGE 起最多还能读多少页
  const pagesToRead  = Math.min(Math.ceil(needCount / PAGE_SIZE), totalPages - START_PAGE + 1);
  const lastPage     = START_PAGE + pagesToRead - 1;
  console.log(`[${TAG}] 总用户数: ${totalCount}（共 ${totalPages} 页）`);
  console.log(`[${TAG}] 从第 ${START_PAGE} 页采到第 ${lastPage} 页，目标 ${needCount} 条`);

  const isEmail = (acc) => typeof acc === 'string' && acc.includes('@');

  const allUsers = [];
  let skippedEmail = 0;
  const pushList = (list) => {
    for (const u of (list || [])) {
      // 邮箱账号整条跳过，保证 1.txt / 2.txt 行数一一对应
      if (isEmail(u.account)) { skippedEmail++; continue; }
      allUsers.push({ userId: u.userId, account: u.account });
      if (allUsers.length >= needCount) return true;
    }
    return false;
  };

  let done = pushList(first.list);

  // 第 START_PAGE+1 .. lastPage 页，每 THREADS 页一波并发
  for (let start = START_PAGE + 1; start <= lastPage && !done; start += THREADS) {
    const end   = Math.min(start + THREADS - 1, lastPage);
    const pages = [];
    for (let p = start; p <= end; p++) pages.push(p);

    // 并发请求本波所有页
    const datas = await Promise.all(pages.map(p => fetchPage(token, p)));

    // 按页顺序收集，保持稳定
    for (let i = 0; i < datas.length; i++) {
      if (!datas[i] || !datas[i].list) {
        console.warn(`[${TAG}] 第 ${pages[i]} 页失败，跳过`);
        continue;
      }
      if (pushList(datas[i].list)) { done = true; break; }
    }
    console.log(`[${TAG}] 已并发翻到第 ${end}/${lastPage} 页，累计 ${allUsers.length} 条`);
  }

  // 裁剪到精确目标
  const finalUsers = allUsers.slice(0, needCount);

  // 写文件
  const userIdContent  = finalUsers.map(u => u.userId).join('\n');
  const accountContent = finalUsers.map(u => u.account).join('\n');
  fs.writeFileSync(path.join(OUT_DIR, '1.txt'), userIdContent,  'utf8');
  fs.writeFileSync(path.join(OUT_DIR, '2.txt'), accountContent, 'utf8');

  console.log('='.repeat(55));
  console.log(`[${TAG}] ✅ 完成，共采集 ${finalUsers.length} 条（已跳过 ${skippedEmail} 个邮箱账号）`);
  console.log(`[${TAG}] 1.txt → userId 列表（${finalUsers.length} 行）`);
  console.log(`[${TAG}] 2.txt → account 账号列表（${finalUsers.length} 行）`);
  console.log('='.repeat(55));
}

main().catch(err => { console.error(`[${TAG}] 运行失败:`, err.message); process.exit(1); });
