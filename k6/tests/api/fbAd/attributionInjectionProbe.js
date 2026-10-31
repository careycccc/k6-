/**
 * FB归因字段注入探测——XSS / URL特殊字符编解码 / SQL注入 / 超长字符串 / 控制字符
 *
 * 背景：campaignName/adsetName/adName 这几个归因字段，值完全来自不可控的外部
 * 输入(广告落地页URL的query参数 p1/p3/p5，任何人只要会拼URL就能随便填)，而
 * 这些值最终会原样存入后端、并展示在后台「广告归因记录」页面(Vue前端)给
 * 运营/管理员看。如果后端没做输入校验、Vue前端渲染时没做转义(比如用了
 * v-html而不是默认的文本插值{{}})，这就是一条"前台免认证接口注入 -> 后台
 * 管理员打开页面时触发"的存储型XSS攻击链——打的是管理员权限，危害远大于
 * 普通前台XSS。
 *
 * 范围：本脚本只能测"后端是否接受这些payload、是否存入数据库"这一层(API黑盒)，
 * 测不到"Vue页面渲染时是否转义了"——那一层必须真的用浏览器打开后台页面肉眼/
 * 程序化核实，看这次探测产生的这批userId在页面上显示成什么样子(是文本还是
 * 真的执行了)。两者要配合着看，光看API返回code:0不能说明有没有XSS风险。
 *
 * 只读防御性安全探测，在SIT测试环境(3003.arplatsaassit3.club)进行，目的是
 * 帮助发现并修复问题，不是攻击生产系统。
 *
 * 用法：
 *   k6 run -e TENANT_ID=3003 attributionInjectionProbe.js
 *   可选: -e FIELD=campaignName (默认，也可选 adsetName / adName)
 */
import { sleep } from 'k6';
import { guestRegister, getLastRegisterError, TENANT_3003_FB_ATTRIBUTION } from '../login/register.test.js';
import { generateCryptoRandomString } from '../../utils/utils.js';

const FIELD = __ENV.FIELD || 'campaignName';

export const options = {
    scenarios: { v: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '10m' } }
};

// 分类测试值——每条都标注"预期关注点"，方便后面去后台页面核对时知道要看什么
const PAYLOADS = [
    // ---- XSS：存储型脚本注入，最高优先级 ----
    { category: 'xss_script_tag', value: '<script>alert(document.cookie)</script>' },
    { category: 'xss_img_onerror', value: '<img src=x onerror=alert(1)>' },
    { category: 'xss_svg_onload', value: '<svg onload=alert(1)>' },
    { category: 'xss_attr_breakout', value: '"><script>alert(1)</script>' },
    { category: 'xss_vue_mustache', value: '{{constructor.constructor("alert(1)")()}}' }, // 万一被当成Vue模板插值而不是纯文本处理

    // ---- URL特殊字符/编解码：这些值来自URL query参数，最容易在"客户端解析URL"
    // 这一步出编解码问题，这里测的是"如果客户端解析出了畸形值，后端怎么处理" ----
    { category: 'url_ampersand', value: 'Summer & Winter Sale' },           // 裸&，真实广告名常见，可能被误判成参数分隔符
    { category: 'url_encoded_space', value: 'Summer%20Sale' },             // 未解码的URL编码残留
    { category: 'url_double_encoded', value: 'Summer%2520Sale' },          // 双重编码(%25是%的编码，解一次变%20，解两次才变空格)
    { category: 'url_percent_raw', value: '100% OFF Now' },                // 裸百分号，不是编码序列，测试是否被误判
    { category: 'url_null_byte_encoded', value: 'test%00admin' },
    { category: 'url_crlf_encoded', value: 'test%0d%0aSet-Cookie:evil=1' }, // CRLF注入尝试，可能导致响应头/日志注入
    { category: 'url_plus_as_space', value: 'Summer+Sale+2026' },          // +号在URL query里常表示空格，测客户端有没有正确处理

    // ---- SQL注入：现代ORM/参数化查询下风险较低，仍值得基础探测 ----
    { category: 'sqli_classic_or', value: "' OR '1'='1" },
    { category: 'sqli_drop_table', value: "'; DROP TABLE Users;--" },
    { category: 'sqli_union_select', value: "' UNION SELECT NULL--" },

    // ---- Unicode特殊字符 ----
    { category: 'unicode_emoji', value: '🎉促销活动🎊' },
    { category: 'unicode_rtl_override', value: 'test‮gnp.exe' },      // RTL override，常用于伪装文件名/文本方向的钓鱼手法
    { category: 'unicode_zero_width', value: 'test​hidden​chars' },

    // ---- 超长字符串：探测数据库字段长度限制/截断行为 ----
    { category: 'long_string_10k', value: 'A'.repeat(10000) },

    // ---- 控制字符 ----
    { category: 'control_chars', value: 'test\x00\x1b\x07end' }
];

export default function () {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`  [InjectionProbe] 归因字段注入探测 | 字段=${FIELD} | 共${PAYLOADS.length}组测试值`);
    console.log(`${'='.repeat(70)}`);
    console.log(`  ⚠️ 下面这批userId，后续需要用浏览器打开后台「广告归因记录」`);
    console.log(`     页面逐一核实渲染结果(是显示成文本，还是真的被执行/破坏了页面)`);
    console.log(`${'='.repeat(70)}\n`);

    const results = [];
    for (const p of PAYLOADS) {
        const attribution = { ...TENANT_3003_FB_ATTRIBUTION.adAttribution, [FIELD]: p.value };
        const result = guestRegister({
            ...TENANT_3003_FB_ATTRIBUTION,
            adAttribution: attribution,
            fbclid: `inj_${p.category}_${generateCryptoRandomString(8)}`
        });

        if (result && result.data && result.data.token) {
            const userId = result.data.userId;
            results.push({ category: p.category, value: p.value, userId, ok: true });
            console.log(`[InjectionProbe] ✅ ${p.category.padEnd(24, ' ')} userId=${userId}  value=${JSON.stringify(p.value).slice(0, 60)}`);
        } else {
            const err = getLastRegisterError();
            results.push({ category: p.category, value: p.value, userId: null, ok: false, err });
            console.log(`[InjectionProbe] ❌ ${p.category.padEnd(24, ' ')} 被拒绝  ${JSON.stringify(err)}`);
        }
        sleep(0.3);
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`  [InjectionProbe] 汇总——成功写入的 userId 列表(去后台核对用)：`);
    console.log(`${'='.repeat(70)}`);
    for (const r of results.filter(r => r.ok)) {
        console.log(`  ${String(r.userId).padEnd(10, ' ')} <- ${r.category}`);
    }
    const rejected = results.filter(r => !r.ok);
    if (rejected.length > 0) {
        console.log(`\n  以下${rejected.length}项被后端拒绝(说明有输入校验在拦截)：`);
        for (const r of rejected) console.log(`  ${r.category}: ${JSON.stringify(r.err)}`);
    }
    console.log(`${'='.repeat(70)}\n`);
}
