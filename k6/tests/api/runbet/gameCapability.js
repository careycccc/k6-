/**
 * 游戏投注能力缓存 —— 按租户读取"哪些彩票游戏真能投注"的探测结果
 *
 * 背景：实测发现不同租户支持的彩票游戏不一样(3006租户目前只有WinGo_30S能真
 * 投200金额并落库，WinGo_1M/3M、TrxWinGo_3M/5M/10M报"The bet limit config
 * does not exist"，K3/D5全系列报"Param is Invalid"，LuckyWinGo开不了游戏)，
 * 但betRun.js(随机投注)和inviteWheelRetention.day.js的betFixed(固定金额投注)
 * 长期硬编码假设所有租户都能投['WinGo_5M','WinGo_30S','TrxWinGo_10M']这3个，
 * 跑在3006这种租户上会有大量注定失败的投注尝试。
 *
 * 探测本身由 gameBetProbe.js + gameBetProbeRunner.js 完成(真实注册+充值+逐游戏
 * 试投+回查后台落库)，结果落盘到 state/gameCapability.ndjson；本模块只负责在
 * init阶段把这份缓存读进内存，供betRun.js/betFixed按租户查表过滤候选游戏。
 *
 * k6沙箱的open()只能在模块顶层(init阶段)同步调用，且按"调用open()的文件自身
 * 所在目录"解析相对路径(不受谁import它、从哪个目录跑k6影响)——已被
 * config/envFileLoader.js验证过这个k6行为。把"读缓存"单独抽成这个模块(而不是
 * 分别写在betRun.js和inviteWheelRetention.day.js里)，就是为了让open()的相对
 * 路径永远锚定在本文件所在的 tests/api/runbet/ 目录，不管调用方在哪个目录。
 *
 * 缓存文件完全不存在时(从未探测过任何租户)open()会抛异常，下面用try/catch
 * 兜底——这一步不能漏，否则本模块及其所有引用方(betRun.js等)会直接init失败，
 * 整个测试跑不起来。
 */
import { resolveTenant } from '../../../libs/http/primitives.js';

const CAP_FILE = './state/gameCapability.ndjson';
const CAPABILITY_MAP = {};

try {
    open(CAP_FILE)
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((line) => {
            try {
                const record = JSON.parse(line);
                if (record && record.tenantId !== undefined && record.tenantId !== null) {
                    CAPABILITY_MAP[String(record.tenantId)] = record;
                }
            } catch (e) {
                console.warn(`[GameCapability] 跳过无法解析的缓存行: ${line.slice(0, 100)}... (${e.message})`);
            }
        });
} catch (e) {
    console.warn(`[GameCapability] 无缓存文件或读取失败，调用方将回退默认游戏列表: ${e.message}`);
}

/**
 * 按租户取"真能投"的游戏码列表；没探测过该租户(缓存未命中)或探测结果为空时，
 * 回退调用方传入的 fallback 默认列表——保证没探测过的新租户不会直接跑不起来。
 * @param {string|number} [tenantId] - 不传则走 resolveTenant 的 __ENV 兜底链
 * @param {string[]} fallback - 缓存未命中时的默认游戏列表
 * @returns {string[]}
 */
export function getCapableGames(tenantId, fallback) {
    const tid = resolveTenant(tenantId);
    const cap = CAPABILITY_MAP[tid];
    if (cap && Array.isArray(cap.capableGames) && cap.capableGames.length > 0) {
        return cap.capableGames;
    }
    return fallback;
}

/**
 * 查某个租户的完整探测记录(含探测时间/账号/失败游戏及原因等)，没探测过返回 null。
 * 主要给诊断/日志场景用，正常投注流程用 getCapableGames 即可。
 * @param {string|number} [tenantId]
 * @returns {object|null}
 */
export function getCapabilityRecord(tenantId) {
    const tid = resolveTenant(tenantId);
    return CAPABILITY_MAP[tid] || null;
}
