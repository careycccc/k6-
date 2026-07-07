/**
 * safetest/lib/report.js
 * 统一的风险判定与打印
 *
 * 约定：k6 check "通过" = 防御有效（无高/危风险）。
 *       因此 check 失败(红) = 发现潜在漏洞，会在 k6 summary 里醒目标出。
 */
import { check } from 'k6';
import { Counter } from 'k6/metrics';

export const RISK = {
    CRITICAL: 'CRITICAL',
    HIGH: 'HIGH',
    MEDIUM: 'MEDIUM',
    LOW: 'LOW',
    INFO: 'INFO',
    PASS: 'PASS',
};

const ICON = {
    CRITICAL: '🔴 严重',
    HIGH: '🟠 高危',
    MEDIUM: '🟡 中危',
    LOW: '🔵 低危',
    INFO: '⚪ 信息',
    PASS: '🟢 通过',
};

/** 是否算"发现风险"（用于汇总）。LOW 以上视为需关注 */
export function isFinding(risk) {
    return risk === RISK.CRITICAL || risk === RISK.HIGH || risk === RISK.MEDIUM;
}

// 自定义指标：按等级计数，便于在 summary 里看总量
const cFinding = new Counter('safetest_findings');
const cCritical = new Counter('safetest_critical');

export function banner(title) {
    const line = '='.repeat(72);
    console.log(`\n${line}\n  ${title}\n${line}`);
}

export function sub(title) {
    console.log(`\n----- ${title} -----`);
}

/**
 * 打印一个案例的最终判定，并登记 k6 check / 指标
 * @param {string} name
 * @param {{risk, conclusion, evidence?:string[], recommendation?:string}} verdict
 */
export function reportCase(name, verdict) {
    const label = ICON[verdict.risk] || verdict.risk;
    console.log(`\n${'█'.repeat(3)} [${name}] 判定：${label}`);
    console.log(`    结论：${verdict.conclusion}`);
    if (verdict.evidence && verdict.evidence.length) {
        console.log('    证据：');
        verdict.evidence.forEach((e) => console.log(`      • ${e}`));
    }
    if (verdict.recommendation) {
        console.log(`    建议：${verdict.recommendation}`);
    }

    const finding = isFinding(verdict.risk);
    if (finding) cFinding.add(1);
    if (verdict.risk === RISK.CRITICAL) cCritical.add(1);

    // check 通过 = 防御有效（无中危及以上）
    check(verdict, {
        [`[${name}] 防御有效(无中/高/严重风险)`]: (v) => !isFinding(v.risk),
    });

    return verdict;
}

/** 汇总多个案例结果，打印总表 */
export function reportSummary(results) {
    banner('安全验证汇总');
    const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4, PASS: 5 };
    const sorted = results.slice().sort((a, b) => (order[a.risk] ?? 9) - (order[b.risk] ?? 9));
    sorted.forEach((r) => {
        console.log(`  ${(ICON[r.risk] || r.risk).padEnd(8)}  ${r.name.padEnd(22)}  ${r.conclusion}`);
    });
    const findings = results.filter((r) => isFinding(r.risk)).length;
    const criticals = results.filter((r) => r.risk === RISK.CRITICAL).length;
    console.log(`\n  合计 ${results.length} 项，需关注(中危及以上) ${findings} 项，其中严重 ${criticals} 项。`);
}
