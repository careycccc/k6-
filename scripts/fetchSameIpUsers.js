/**
 * 获取相同关联会员列表并生成4个格式文件
 *
 * 使用方式:
 *   node scripts/fetchSameIpUsers.js [tenantId] [secret]
 *
 * 示例 (使用 3004 环境，无密钥):
 *   node scripts/fetchSameIpUsers.js 3004
 *   node scripts/fetchSameIpUsers.js 3004 mySecret
 */

const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

// ============================================================
//  环境配置（同步自 k6/config/envconfig.js）
// ============================================================
const ENV_MAP = {
  '3001': { BASE_ADMIN_URL: 'https://ar666999.club',               USER: 'carey3001', PWD: 'qwer1234' },
  '3002': { BASE_ADMIN_URL: 'https://arsitasdfghjklg.com',         USER: 'carey3002', PWD: 'qwer1234' },
  '3003': { BASE_ADMIN_URL: 'https://3003-tenantadmin.ar666999.club', USER: 'carey3003', PWD: 'qwer1234' },
  '3004': { BASE_ADMIN_URL: 'https://arsitasdfghjklusa.com',       USER: 'carey3004', PWD: 'qwer1234' },
  '3005': { BASE_ADMIN_URL: 'https://arsitasdfghj.com',            USER: 'carey3005', PWD: 'qwer1234' },
  '3006': { BASE_ADMIN_URL: 'https://3006-tenantadmin.ar666999.club', USER: 'carey3006', PWD: 'qwer1234' },
  '3007': { BASE_ADMIN_URL: 'https://3007-tenantadmin.ar666999.club', USER: 'carey3007', PWD: 'qwer1234' },
  '3101': { BASE_ADMIN_URL: 'https://3101-tenantadmin.arplatsaasuat.com', USER: 'carey_3101', PWD: 'qwer1234' },
};

// ============================================================
//  签名算法（同步自 k6/libs/utils/signature.js）
// ============================================================
const EXCLUDE = ['signature', 'timestamp', 'track'];

function filterObj(obj) {
  const out = {};
  for (const k in obj) {
    if (!EXCLUDE.includes(k) && obj[k] !== null && obj[k] !== undefined && obj[k] !== '') {
      out[k] = obj[k];
    }
  }
  return out;
}

function sortObj(obj) {
  const out = {};
  Object.keys(obj).sort().forEach(k => { out[k] = obj[k]; });
  return out;
}

function calcSig(data, secret = '') {
  const filtered = filterObj(data);
  const sorted   = sortObj(filtered);
  const str      = JSON.stringify(sorted) + secret;
  return crypto.createHash('md5').update(str).digest('hex').toUpperCase();
}

function buildPayload(extra = {}, secret = '') {
  const timestamp = Math.floor(Date.now() / 1000);
  const random    = Math.floor(Math.random() * 1e12);
  const base      = { ...extra, random, language: 'zh', timestamp };
  return { ...base, signature: calcSig(base, secret) };
}

// ============================================================
//  HTTP 工具
// ============================================================
function postJson(baseUrl, apiPath, payload, token = null) {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify(payload);
    const url     = new URL(apiPath, baseUrl);
    const lib     = url.protocol === 'https:' ? https : http;

    const headers = {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Accept':         'application/json',
      'Host':           url.hostname,
      'Referer':        baseUrl + '/',
      'Origin':         baseUrl,
      'Domainurl':      baseUrl,
      'language':       'zh',
      'User-Agent':     'Mozilla/5.0 (k6-node-script)',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = lib.request({
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname,
      method:   'POST',
      headers,
      timeout:  20000,
      rejectUnauthorized: false,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try   { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data, parseError: true, raw: data.slice(0, 300) }); }
      });
    });

    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// ============================================================
//  Admin 登录
// ============================================================
async function adminLogin(baseUrl, user, pwd, secret = '') {
  const payload = buildPayload({ userName: user, pwd }, secret);
  console.log(`   🔑 登录 ${baseUrl} 账号: ${user}`);
  const r = await postJson(baseUrl, '/api/Login/Login', payload);
  if (r.parseError) {
    console.log(`   ⚠️  登录响应非 JSON: ${r.raw}`);
    return null;
  }
  const resp = r.body;
  if (resp.code === 0 && resp.data && resp.data.token) {
    console.log(`   ✅ 登录成功，token: ${resp.data.token.slice(0, 20)}...`);
    return resp.data.token;
  }
  console.log(`   ⚠️  登录失败: code=${resp.code} msg=${resp.msg}`);
  return null;
}

// ============================================================
//  获取相同 IP 会员列表
// ============================================================
async function getSameIpUsers(baseUrl, token, ipValue, secret = '') {
  const payload = buildPayload({ value: ipValue, pageNo: 1, pageSize: 500 }, secret);
  console.log(`   📡 查询 IP=${ipValue}`);
  const r = await postJson(baseUrl, '/api/UserSameInfo/GetSameIpLinkedUserPageList', payload, token);
  if (r.parseError) {
    console.log(`   ⚠️  响应非 JSON: ${r.raw}`);
    return null;
  }
  const resp = r.body;
  console.log(`   code: ${resp.code}, msg: ${resp.msg}`);
  if (resp.code === 0 && resp.data && resp.data.list) {
    return resp.data.list.map(u => u.userId);
  }
  return null;
}

// ============================================================
//  生成 4 个文件
// ============================================================
const OUTPUT_DIR = path.join(__dirname, 'sameip_output');

function generateFiles(userIds, ipValue) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const total = userIds.length;
  console.log(`\n✅ 共获取 ${total} 个会员ID`);
  console.log('预览(前10):', userIds.slice(0, 10).join(', '));

  const ids100 = userIds.slice(0, Math.min(100, total));
  const ids200 = userIds.slice(0, Math.min(200, total));
  const ids50  = userIds.slice(0, Math.min(50,  total));
  const ids20  = userIds.slice(0, Math.min(20,  total));

  const f1 = path.join(OUTPUT_DIR, 'case1_100ids_comma.txt');
  const f2 = path.join(OUTPUT_DIR, 'case2_200ids_comma.txt');
  const f3 = path.join(OUTPUT_DIR, 'case3_50ids_space.txt');
  const f4 = path.join(OUTPUT_DIR, 'case4_20ids_newline.txt');

  fs.writeFileSync(f1, ids100.join(','),  'utf8');
  fs.writeFileSync(f2, ids200.join(','),  'utf8');
  fs.writeFileSync(f3, ids50.join(' '),   'utf8');
  fs.writeFileSync(f4, ids20.join('\n'),  'utf8');

  console.log(`\n📄 用例1 (${ids100.length}个 逗号) → ${f1}`);
  console.log(`📄 用例2 (${ids200.length}个 逗号) → ${f2}`);
  console.log(`📄 用例3 (${ids50.length}个  空格) → ${f3}`);
  console.log(`📄 用例4 (${ids20.length}个  换行) → ${f4}`);

  // 汇总文件
  const sf = path.join(OUTPUT_DIR, 'summary_all.txt');
  fs.writeFileSync(sf, [
    `生成时间: ${new Date().toLocaleString('zh-CN')}`,
    `IP地址:   ${ipValue}`,
    `总会员数: ${total}`,
    '',
    `=== 用例1: ${ids100.length}个ID (英文逗号分隔) ===`,
    ids100.join(','),
    '',
    `=== 用例2: ${ids200.length}个ID (英文逗号分隔) ===`,
    ids200.join(','),
    '',
    `=== 用例3: ${ids50.length}个ID (空格分隔) ===`,
    ids50.join(' '),
    '',
    `=== 用例4: ${ids20.length}个ID (换行分隔) ===`,
    ids20.join('\n'),
  ].join('\n'), 'utf8');

  console.log(`📄 汇总文件 → ${sf}`);
  console.log(`\n✅ 全部文件写入完成: ${OUTPUT_DIR}`);
}

// ============================================================
//  主流程
// ============================================================
const IP_VALUE  = '2a06:98c0:3600::103';
const tenantArg = process.argv[2] || '3004';
const secretArg = process.argv[3] || '';

// 支持直接传入 URL 格式
const isTenantId = /^\d{4}$/.test(tenantArg);
const envCfg     = isTenantId ? ENV_MAP[tenantArg] : null;

const candidateUrls = envCfg
  ? [{ baseUrl: envCfg.BASE_ADMIN_URL, user: envCfg.USER, pwd: envCfg.PWD }]
  : Object.values(ENV_MAP).map(e => ({ baseUrl: e.BASE_ADMIN_URL, user: e.USER, pwd: e.PWD }));

async function main() {
  console.log('🚀 开始获取相同关联会员...');
  console.log(`   IP:      ${IP_VALUE}`);
  console.log(`   租户:    ${tenantArg}`);
  console.log(`   secret:  "${secretArg}"`);

  let userIds = null;

  for (const cfg of candidateUrls) {
    console.log(`\n🔗 尝试后台: ${cfg.baseUrl}`);
    try {
      const token = await adminLogin(cfg.baseUrl, cfg.user, cfg.pwd, secretArg);
      if (!token) continue;

      userIds = await getSameIpUsers(cfg.baseUrl, token, IP_VALUE, secretArg);
      if (userIds && userIds.length > 0) break;

      console.log('   ⚠️  未获取到数据，尝试下一个环境');
    } catch (err) {
      console.log(`   ❌ 错误: ${err.message}`);
    }
  }

  if (!userIds || userIds.length === 0) {
    console.error('\n❌ 所有环境均失败');
    console.error('用法: node scripts/fetchSameIpUsers.js [tenantId] [secret]');
    console.error('示例: node scripts/fetchSameIpUsers.js 3004');
    process.exit(1);
  }

  generateFiles(userIds, IP_VALUE);
}

main().catch(err => {
  console.error('❌ 异常:', err);
  process.exit(1);
});
