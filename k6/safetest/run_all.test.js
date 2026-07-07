/**
 * run_all.test.js
 * 一次性跑完 5 类文件上传安全验证，并输出汇总总表。
 *
 * 各案例均为"良性探针 + 上传后自动回取验证"，vus=1、单次、不打并发流量。
 *
 * 运行：
 *   k6 run -e TENANT_ID=3004 run_all.test.js
 *   k6 run -e TENANT_ID=3101 run_all.test.js     # 换 UAT
 */
import { getSafeEnv, tenantId } from './lib/env.js';
import { getGuestToken } from './lib/guest.js';
import { banner, reportSummary } from './lib/report.js';

import { runCase as runRce } from './1_rce_webshell.test.js';
import { runCase as runXss } from './2_stored_xss.test.js';
import { runCase as runDos } from './3_dos.test.js';
import { runCase as runTrav } from './4_path_traversal.test.js';
import { runCase as runCfg } from './5_config_hijack.test.js';

export const options = { vus: 1, iterations: 1 };

export default function () {
    const env = getSafeEnv();
    banner(`文件上传安全验证套件 · 租户 ${tenantId()} · 前台 ${env.BASE_DESK_URL}`);
    console.log('  说明：全部为良性探针；未登录(游客token)上传后自动回取(fetch-back)判断客服浏览器点开时的真实行为。\n');

    // 一个游客 token 复用给所有案例（减少注册与限流）
    const token = getGuestToken(tenantId());
    if (!token) {
        console.error('  ✗ 无法获取游客 token，终止。可用 -e PACKAGE_NAME=... 指定正确包名。');
        return;
    }

    const results = [];
    // 每个 runCase 返回 {name, risk, conclusion, evidence, recommendation}
    results.push(runRce(env, token));
    results.push(runXss(env, token));
    // DoS 单独运行（解压炸弹探针），不进汇总套件：k6 run 3_dos.test.js
    results.push(runDos(env, token));
    results.push(runTrav(env, token));
    results.push(runCfg(env, token));

    reportSummary(results);

    console.log('\n  ⚠ 提醒：XSS/RCE 的"客服点开即触发"最终仍建议人工在后台点开一次确认；');
    console.log('     本套件已从服务端侧证明其触发的必要条件是否成立。');
}
