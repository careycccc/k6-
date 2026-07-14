/**
 * safetest/sqli/login_sqli.test.js
 * 登录接口 SQL 注入检测（前台 /api/Home/Login + 后台 /api/Login/Login）
 *
 * 手法：鉴权绕过 / 布尔盲注（成对差分）/ 报错型 / 时间盲注（多方言 + 0 延迟对照）。
 * 判定：与「格式正确但口令错误」的基线响应对比 —— msgCode / HTTP 状态 / 响应长度 / 耗时。
 * 安全：vus=1、串行、仅非破坏性 payload、内置限流退避；【仅在授权 SIT/UAT 环境运行】。
 *
 * 运行（在 k6/safetest 目录下）：
 *   k6 run sqli/login_sqli.test.js                     # 默认 3004 SIT，前台+后台
 *   k6 run -e TARGET=frontend sqli/login_sqli.test.js  # 只测前台
 *   k6 run -e TARGET=backend  sqli/login_sqli.test.js  # 只测后台
 *   k6 run -e TENANT_ID=3101  sqli/login_sqli.test.js  # 切换到 3101 UAT
 *
 * k6 check「通过(绿)」= 该项防御有效（无中危及以上）；check 变红 = 发现潜在注入风险。
 */
import { sleep } from 'k6';
import { getSafeEnv, tenantId } from '../lib/env.js';
import { banner, sub, reportCase, reportSummary, RISK } from '../lib/report.js';
import { ENDPOINTS } from './lib/signedLogin.js';
import {
  AUTH_BYPASS,
  BOOLEAN_PAIRS,
  ERROR_BASED,
  TIME_BASED,
  TIME_CONTROL,
  DELAY_SEC,
  SQL_ERROR_SIGNS,
} from './lib/payloads.js';

export const options = {
  vus: 1,
  iterations: 1,
  tags: { test_type: 'safetest', category: 'sqli_login' },
};

const GAP = 1.0; // 每个 payload 间隔秒数，缓解限流

// 记录一个 verdict（reportCase 返回体不含 name，这里补上供汇总表用）
function record(results, name, verdict) {
  const v = reportCase(name, verdict);
  results.push({ name, ...v });
}

// 一个格式正确、几乎必然不存在/口令错误的账号，作为「正常失败登录」基线
function baseUser() {
  return {
    user: '10' + String(Date.now()).slice(-9),
    pass: 'Wrong_' + Math.floor(Math.random() * 1e6),
  };
}

function measureBaseline(ep) {
  const durs = [];
  let ref = null;
  for (let i = 0; i < 3; i++) {
    const b = baseUser();
    ref = ep.run(b.user, b.pass);
    durs.push(ref.duration);
    sleep(GAP);
  }
  durs.sort((a, b) => a - b);
  return {
    status: ref.status,
    msgCode: ref.msgCode,
    len: ref.len,
    msg: ref.msg,
    medDur: durs[Math.floor(durs.length / 2)],
  };
}

// ---- 技法 1：鉴权绕过 / 恒真 ----
function runAuthBypass(results, ep) {
  sub(`${ep.name} · 鉴权绕过 / 恒真`);
  const evidence = [];
  let risk = RISK.PASS;
  for (const t of AUTH_BYPASS) {
    const r = ep.run(t.p, 'anyPassword');
    const bypassed = !!r.token || r.msgCode === 0;
    const line = `「${t.desc}」status=${r.status} msgCode=${r.msgCode} len=${r.len}${r.token ? ' 🚨拿到token' : ''}`;
    console.log('   ' + line);
    if (bypassed) {
      risk = RISK.CRITICAL;
      evidence.push('登录被绕过：' + line);
    }
    sleep(GAP);
  }
  record(results, `${ep.name} · 鉴权绕过`, {
    risk,
    conclusion:
      risk === RISK.CRITICAL ? '存在鉴权绕过：恒真 payload 直接登录成功' : '未能通过恒真 payload 绕过登录',
    evidence,
    recommendation: '登录用参数化查询/ORM 绑定变量；用户名查询与口令校验分离，切勿拼接 SQL。',
  });
}

// ---- 技法 2：布尔盲注（成对差分）----
function runBoolean(results, ep, base) {
  sub(`${ep.name} · 布尔盲注（差分）`);
  const evidence = [];
  let risk = RISK.PASS;
  for (const pair of BOOLEAN_PAIRS) {
    const rt = ep.run(pair.t, 'x');
    sleep(GAP);
    const rf = ep.run(pair.f, 'x');
    sleep(GAP);
    const diff =
      rt.msgCode !== rf.msgCode || rt.status !== rf.status || Math.abs(rt.len - rf.len) > 20;
    const line = `「${pair.desc}」TRUE(msgCode=${rt.msgCode},len=${rt.len}) vs FALSE(msgCode=${rf.msgCode},len=${rf.len})`;
    console.log('   ' + line);
    if (diff) {
      risk = RISK.HIGH;
      evidence.push('真/假条件响应可区分：' + line);
    }
  }
  record(results, `${ep.name} · 布尔盲注`, {
    risk,
    conclusion:
      risk === RISK.HIGH ? 'TRUE/FALSE 条件产生可区分响应，疑似布尔盲注' : '真假条件响应无差异',
    evidence,
    recommendation: '参数化查询；统一失败响应，避免注入逻辑分支产生可观测差异。',
  });
}

// ---- 技法 3：报错型 ----
function runError(results, ep, base) {
  sub(`${ep.name} · 报错型`);
  const evidence = [];
  let risk = RISK.PASS;
  for (const t of ERROR_BASED) {
    const r = ep.run(t.p, 'x');
    const leaked = SQL_ERROR_SIGNS.some((re) => re.test(r.bodyText));
    const http5xx = r.status >= 500 && base.status < 500;
    const line = `「${t.desc}」status=${r.status} msgCode=${r.msgCode}${leaked ? ' 🚨疑似DB报错泄露' : ''}`;
    console.log('   ' + line);
    if (leaked) {
      risk = RISK.HIGH;
      evidence.push('响应疑似泄露数据库报错：' + line + ` :: ${r.bodyText.slice(0, 160)}`);
    } else if (http5xx && risk === RISK.PASS) {
      risk = RISK.MEDIUM;
      evidence.push(`特殊字符触发 5xx（基线为 ${base.status}）：` + line);
    }
    sleep(GAP);
  }
  record(results, `${ep.name} · 报错型`, {
    risk,
    conclusion:
      risk === RISK.HIGH
        ? '响应体泄露数据库报错信息'
        : risk === RISK.MEDIUM
          ? '特殊字符导致服务端 5xx（异常处理不当）'
          : '特殊字符被安全处理，无报错泄露',
    evidence,
    recommendation: '关闭对外详细报错；统一异常处理返回通用错误；参数化查询。',
  });
}

// ---- 技法 4：时间盲注（多方言 + 0 延迟对照）----
function runTime(results, ep, base) {
  sub(`${ep.name} · 时间盲注（基线中位 ${Math.round(base.medDur)}ms）`);
  const evidence = [];
  let risk = RISK.PASS;
  // 命中注入应 ≈ 基线 + DELAY_SEC；阈值取 0.7 系数，给网络往返留余量
  const threshold = base.medDur + DELAY_SEC * 1000 * 0.7;

  // 先跑 0 延迟对照：同形 payload 无延迟时不得超阈值，否则时间判定不可靠
  let controlMax = 0;
  for (const c of TIME_CONTROL) {
    const r = ep.run(c.p, 'x');
    controlMax = Math.max(controlMax, r.duration);
    console.log(`   [对照] 「${c.desc}」dur=${Math.round(r.duration)}ms`);
    sleep(GAP);
  }
  const controlClean = controlMax < threshold;

  for (const t of TIME_BASED) {
    const r = ep.run(t.p, 'x');
    const slow = r.duration >= threshold;
    const line = `「${t.dbms}:${t.desc}」dur=${Math.round(r.duration)}ms (阈值 ${Math.round(threshold)}ms)`;
    console.log('   ' + line);
    if (slow && controlClean) {
      sleep(GAP);
      const r2 = ep.run(t.p, 'x'); // 复测排除偶发抖动
      if (r2.duration >= threshold) {
        risk = RISK.CRITICAL;
        evidence.push(
          `可控延迟注入(${t.dbms})：${line}；复测 ${Math.round(r2.duration)}ms；0延迟对照最大 ${Math.round(controlMax)}ms`
        );
      }
    } else if (slow && !controlClean && risk === RISK.PASS) {
      risk = RISK.INFO;
      evidence.push(`响应偏慢但对照亦慢(${Math.round(controlMax)}ms)，无法确证注入：` + line);
    }
    sleep(GAP);
  }
  record(results, `${ep.name} · 时间盲注`, {
    risk,
    conclusion:
      risk === RISK.CRITICAL
        ? '注入可控制响应延迟（时间盲注成立）'
        : risk === RISK.INFO
          ? '存在偏慢响应但对照不干净，结论不确定，建议人工复核'
          : '注入 payload 未产生可观测延迟',
    evidence,
    recommendation:
      '参数化查询；登录输入做白名单/长度校验；数据库账号最小权限，尽量禁用 SLEEP/WAITFOR 能力。',
  });
}

export default function () {
  banner(`登录 SQL 注入检测 · 租户 ${tenantId()} · ${getSafeEnv().BASE_DESK_URL}`);

  const target = (__ENV.TARGET || 'both').toLowerCase();
  const eps = [];
  if (target === 'both' || target === 'frontend') eps.push(ENDPOINTS.frontend);
  if (target === 'both' || target === 'backend') eps.push(ENDPOINTS.backend);
  if (eps.length === 0) {
    console.error(`未知 TARGET=${target}，可选 frontend | backend | both`);
    return;
  }

  const results = [];
  for (const ep of eps) {
    banner(ep.name);
    const base = measureBaseline(ep);
    console.log(
      `   基线：status=${base.status} msgCode=${base.msgCode} len=${base.len} 中位耗时=${Math.round(base.medDur)}ms msg=${base.msg}`
    );
    runAuthBypass(results, ep);
    runBoolean(results, ep, base);
    runError(results, ep, base);
    runTime(results, ep, base);
  }

  reportSummary(results);
}
