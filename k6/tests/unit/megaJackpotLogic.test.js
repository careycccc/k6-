/**
 * megaJackpotVerify 判定逻辑自测（模拟数据，不发请求）
 *   k6 run -e TENANT_ID=3004 k6/tests/unit/megaJackpotLogic.test.js
 */
import { normalizeConfig, matchConfigs, verifyUser } from '../api/activity/MegaJackpot/megaJackpotVerify.js';

export const options = { vus: 1, iterations: 1 };
let fail = 0;
const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fail++; console.log(`${ok ? '✅' : '❌'} ${n} got=${JSON.stringify(g)}${ok ? '' : ' want=' + JSON.stringify(w)}`); };

const T0 = 1791900000000;               // 配置生效时间
const cfg = (o) => normalizeConfig(Object.assign({ state: 1, rangeType: 1, effectiveRange: '', gameScope: 0, effectiveGameList: [],
    minMultiple: 2, maxMultiple: 100, minBetAmount: 10, maxBetAmount: 1000, awardAmount: 10, everyDayRewardLimitNum: 0, lastUpdateTime: T0 }, o));
const A = cfg({ id: 1, awardAmount: 11, everyDayRewardLimitNum: 1 });
const B = cfg({ id: 2, awardAmount: 22, everyDayRewardLimitNum: 0 });
const P = cfg({ id: 3, rangeType: 2, effectiveRange: 'PG', gameScope: 1, effectiveGameList: [{ vendorCode: 'PG', gameList: [{ code: '88' }] }], awardAmount: 33 });
let seq = 0;
const bet = (o) => Object.assign({ orderNo: 'O' + (++seq), categoryType: 0, vendorCode: 'JILI', gameCode: '1', gameName: 'g', betAmount: 10, winAmount: 30, profit: '3.00', betTime: T0 + seq * 60000, settlementTime: T0 + seq * 60000 }, o);
const rec = (b, c, state) => ({ orderNo: b.orderNo, userId: 1, betTime: b.betTime, vendorCode: b.vendorCode, gameName: b.gameName, betAmount: b.betAmount, multiple: b.profit,
    minMultiple: c.minMultiple, maxMultiple: c.maxMultiple, minBetAmount: c.minBet, maxBetAmount: c.maxBet, awardAmount: c.award, receiveState: state });
const run = (bets, recs, globalLimit, enabled = [A, B], now = T0 + 3600000) => verifyUser(1, bets, recs, { enabled, allConfigs: enabled, globalLimit, windowStart: T0, runStart: now }).items.map(i => i.status);

export default function () {
    // 匹配规则
    eq('倍率/金额两端都算', matchConfigs([A], bet({ profit: '2.00', betAmount: 10 })).length, 1);
    eq('投注时间=生效时间不算(严格大于)', matchConfigs([A], bet({ betTime: T0 })).length, 0);
    eq('rangeType=1 只认电子', matchConfigs([A], bet({ categoryType: 4 })).length, 0);
    eq('指定厂商+子游戏 命中', matchConfigs([P], bet({ vendorCode: 'PG', gameCode: '88', categoryType: 4 })).length, 1);
    eq('指定子游戏 不命中', matchConfigs([P], bet({ vendorCode: 'PG', gameCode: '99' })).length, 0);

    // A 次数用完改用 B
    seq = 0; let b1 = bet(), b2 = bet();
    eq('A用完改用B', run([b1, b2], [rec(b1, A, 0), rec(b2, B, 0)], 3), ['ok_sent', 'ok_sent']);
    seq = 0; b1 = bet(); b2 = bet();
    eq('A用完仍用A → 超单配置', run([b1, b2], [rec(b1, A, 0), rec(b2, A, 0)], 3), ['ok_sent', 'over_config']);

    // 全局限制 2：系统不发不判定、不计次
    seq = 0; const bs = [bet(), bet(), bet()];
    eq('超全局后系统不发 → 不判定', run(bs, [rec(bs[0], B, 0), rec(bs[1], B, 1), rec(bs[2], B, 3)], 2), ['ok_sent', 'ok_sent']);
    eq('超全局仍发', run(bs, [rec(bs[0], B, 0), rec(bs[1], B, 0), rec(bs[2], B, 0)], 2), ['ok_sent', 'ok_sent', 'over_global']);
    eq('系统不发不占次数', run(bs, [rec(bs[0], B, 3), rec(bs[1], B, 0), rec(bs[2], B, 0)], 2), ['ok_sent', 'ok_sent']);
    eq('超全局且无记录 → 不触发正常', run(bs, [rec(bs[0], B, 0), rec(bs[1], B, 0)], 2), ['ok_sent', 'ok_sent', 'ok_none']);

    // 漏发 / 等待生成
    seq = 0; b1 = bet(); b2 = bet();
    eq('漏发', run([b1], [], 3), ['missing']);
    eq('刚结算→等待生成', run([b2], [], 3, [A, B], b2.settlementTime + 30000), ['pending']);

    // 多发：快照属于不满足的配置 / 注单不满足任何配置
    seq = 0; b1 = bet();
    eq('快照是不满足的配置(P只认PG)→多发', verifyUser(1, [b1], [rec(b1, P, 0)], { enabled: [A, B, P], allConfigs: [A, B, P], globalLimit: 3, runStart: T0 + 3600000 }).items.map(i => i.status), ['extra']);
    seq = 0; b1 = bet({ profit: '1.00' });
    eq('不满足条件却有记录→多发', run([b1], [rec(b1, B, 0)], 3), ['extra']);

    // 配置在投注后被改过：记录快照是旧版本 → 不判定
    seq = 0; b1 = bet();
    const oldVer = cfg({ id: 9, minMultiple: 5, awardAmount: 99 });            // 旧版本区间
    const newVer = cfg({ id: 9, minMultiple: 50, awardAmount: 99, lastUpdateTime: b1.betTime + 60000 }); // 投注后改成新区间
    eq('投注后配置被改 → 旧版本触发不判定', verifyUser(1, [b1], [rec(b1, oldVer, 0)], { enabled: [newVer], allConfigs: [newVer], globalLimit: 3, runStart: T0 + 3600000 }).items.map(i => i.status), ['info_pre']);
    // 配置在投注前就关闭了，关闭后还在触发 → 多发
    const closed = cfg({ id: 8, state: 0, lastUpdateTime: T0 - 1000, awardAmount: 88 });
    eq('关闭后仍触发 → 多发', verifyUser(1, [b1], [rec(b1, closed, 0)], { enabled: [A], allConfigs: [A, closed], globalLimit: 3, runStart: T0 + 3600000 }).items.map(i => i.status), ['extra']);

    console.log(fail === 0 ? '全部通过' : `失败 ${fail} 项`);
    if (fail) throw new Error('megaJackpot 逻辑自测失败');
}
