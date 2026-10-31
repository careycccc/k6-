/**
 * FB归因防刷/限流探测——黑盒测试"同设备/同点击ID短时间反复发起归因注册"
 * 有没有被后端识别并限制。
 *
 * 背景：这是在探测一个真实存在的攻击面(Attribution Fraud/归因欺诈)——如果
 * 完全不设限，理论上可以用同一台设备、或者反复消费同一个fbclid，疯狂刷
 * "游客+归因"请求，伪造虚假的广告转化数据去骗广告主的推广结算预算。这个
 * 测试不依赖"归因该不该按设备延续/合并"那个产品决策，无论答案是哪个，
 * 防刷这件事本身都该有限制，现在就能测。
 *
 * 只读黑盒探测，不做任何绕过/攻击性利用——目的是把后端真实的防护边界摸
 * 清楚，供防御侧参考，不是找漏洞打穿它。在SIT测试环境(3003.arplatsaassit3.club)
 * 进行，会真实创建测试账号，量级受 ATTEMPTS 控制，默认保守取10。
 *
 * 两个场景：
 *   rate_limit   —— registerDevice固定，fbclid每次不同，连续快速注册，
 *                    探测"同设备频率限流"阈值(第几次开始被拒、拒绝码是什么)
 *   fbclid_reuse —— 完整Fbc值固定(只生成一次，含固定时间戳，整个场景复用同
 *                    一个值，不是每次重新生成——否则时间戳变了Fbc整体就不算
 *                    "重复"了)，registerDevice每次不同，探测"同一个点击ID被
 *                    多次使用"是否会被识别/拒绝，而不是每次都当新转化放行
 *
 * 用法：
 *   k6 run -e TENANT_ID=3003 -e SCENARIO=rate_limit verifyAttributionAbuseProbe.js
 *   k6 run -e TENANT_ID=3003 -e SCENARIO=fbclid_reuse attributionAbuseProbe.js
 *   k6 run -e TENANT_ID=3003 -e SCENARIO=all attributionAbuseProbe.js
 *   可选: -e ATTEMPTS=10 -e INTERVAL_MS=300
 */
import { sleep } from 'k6';
import { guestRegister, getLastRegisterError, isRateLimitError, TENANT_3003_FB_ATTRIBUTION } from '../login/register.test.js';
import { generateFbc, generateCryptoRandomString } from '../../utils/utils.js';

const SCENARIO = __ENV.SCENARIO || 'all';
const ATTEMPTS = parseInt(__ENV.ATTEMPTS || '10', 10);
const INTERVAL_MS = parseFloat(__ENV.INTERVAL_MS || '300');

export const options = {
    scenarios: { v: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '30m' } }
};

/** 单次探测请求，归类结果——success/rate_limited/business_rejected/network_error */
function probeOnce(opts) {
    const result = guestRegister(opts);
    if (result && result.data && result.data.token) {
        return { outcome: 'success', userId: result.data.userId };
    }
    const err = getLastRegisterError();
    if (err && isRateLimitError(err)) {
        return { outcome: 'rate_limited', detail: err };
    }
    if (err) {
        return { outcome: 'business_rejected', detail: err };
    }
    return { outcome: 'network_error', detail: null };
}

/** 打印一轮探测的统计摘要 */
function printSummary(scenarioName, records) {
    const counts = { success: 0, rate_limited: 0, business_rejected: 0, network_error: 0 };
    let firstNonSuccessAt = null;
    for (const r of records) {
        counts[r.outcome]++;
        if (firstNonSuccessAt === null && r.outcome !== 'success') firstNonSuccessAt = r.attempt;
    }
    console.log(`\n${'='.repeat(70)}`);
    console.log(`  [${scenarioName}] 探测结果汇总  共${records.length}次请求`);
    console.log(`${'='.repeat(70)}`);
    console.log(`  成功: ${counts.success}  限流拒绝: ${counts.rate_limited}  其他业务拒绝: ${counts.business_rejected}  网络/解析错误: ${counts.network_error}`);
    if (firstNonSuccessAt !== null) {
        const firstBad = records.find(r => r.attempt === firstNonSuccessAt);
        console.log(`  ⚠️ 首次非成功发生在第 ${firstNonSuccessAt} 次请求，详情: ${JSON.stringify(firstBad.detail)}`);
    } else {
        console.log(`  ⚠️ 全部${records.length}次请求都成功，本次量级下没有观察到任何限制`);
    }
    console.log(`${'='.repeat(70)}\n`);
    return { counts, firstNonSuccessAt };
}

function runRateLimitScenario() {
    console.log(`\n[AbuseProbe] ===== 场景: 同设备频率限流探测 (deviceId固定，fbclid每次不同，共${ATTEMPTS}次，间隔${INTERVAL_MS}ms) =====`);
    const fixedDeviceId = 'probe_rl_' + generateCryptoRandomString(12);
    const records = [];
    for (let i = 1; i <= ATTEMPTS; i++) {
        const fbclid = `probe_fbclid_${i}_${generateCryptoRandomString(8)}`;
        const r = probeOnce({
            ...TENANT_3003_FB_ATTRIBUTION,
            registerDevice: fixedDeviceId,
            fbclid
        });
        records.push({ attempt: i, ...r });
        console.log(`[AbuseProbe][频率] 第${i}次 -> ${r.outcome}${r.detail ? ' ' + JSON.stringify(r.detail) : ''}`);
        if (i < ATTEMPTS) sleep(INTERVAL_MS / 1000);
    }
    return printSummary('同设备频率限流', records);
}

function runFbclidReuseScenario() {
    console.log(`\n[AbuseProbe] ===== 场景: 同fbclid重复使用探测 (Fbc固定不变，deviceId每次不同，共${ATTEMPTS}次，间隔${INTERVAL_MS}ms) =====`);
    const fixedFbclid = 'probe_reuse_' + generateCryptoRandomString(16);
    // 只生成一次，整个场景复用同一个完整Fbc值(含固定时间戳)——不要每次调用
    // generateFbc()重新生成，那样时间戳会变，Fbc整体值每次都不同，就测不出
    // "同一个点击ID被重复使用"这件事了
    const fixedFbc = generateFbc(fixedFbclid);
    console.log(`[AbuseProbe] 固定Fbc = ${fixedFbc}`);
    const records = [];
    for (let i = 1; i <= ATTEMPTS; i++) {
        const r = probeOnce({
            ...TENANT_3003_FB_ATTRIBUTION,
            fbc: fixedFbc
            // registerDevice不传，guestRegister内部默认每次随机生成，模拟
            // "同一条广告分享链接被不同设备打开"
        });
        records.push({ attempt: i, ...r });
        console.log(`[AbuseProbe][复用] 第${i}次 -> ${r.outcome}${r.detail ? ' ' + JSON.stringify(r.detail) : ''}`);
        if (i < ATTEMPTS) sleep(INTERVAL_MS / 1000);
    }
    return printSummary('同fbclid重复使用', records);
}

export default function () {
    if (SCENARIO === 'rate_limit' || SCENARIO === 'all') runRateLimitScenario();
    if (SCENARIO === 'fbclid_reuse' || SCENARIO === 'all') runFbclidReuseScenario();
}
