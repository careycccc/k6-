/**
 * FB归因注册——并发竞态条件(Race Condition/TOCTOU)探测
 *
 * 背景：之前的防刷探测都是单线程、带间隔地顺序发请求，测的是"频率限流"这
 * 一个维度。这次换成真正的并发——同一个 registerDevice 固定不变，N个VU在
 * 几乎同一时刻同时发起游客注册请求，专门测"后端如果真的想对同一设备做唯一
 * 性限制，高并发下这个检查会不会被绕过"：如果后端是"先查询这个设备是否已
 * 注册过 -> 再决定要不要创建"这种写法，而中间没有加锁/唯一索引兜底，高并发
 * 下就可能出现多个请求都通过了"检查"阶段、都执行了"创建"，造成本该被拒绝
 * 的重复注册全部放行——这是经典的TOCTOU(Time-Of-Check-Time-Of-Use)竞态漏洞。
 *
 * fbclid/campaignName 每个VU各自独立(带VU编号标记)，不跟deviceId这个维度
 * 混在一起测，同时也能顺带验证——高并发下这些账号的归因数据有没有"串台"
 * (VU A的数据被错误地落到了VU B创建的账号上)。
 *
 * 只读防御性安全探测，在SIT测试环境进行。
 *
 * 用法：k6 run -e TENANT_ID=3003 -e VUS=20 attributionRaceProbe.js
 */
import { guestRegister, getLastRegisterError, TENANT_3003_FB_ATTRIBUTION } from '../login/register.test.js';
import { generateFbc } from '../../utils/utils.js';

const VUS = parseInt(__ENV.VUS || '20', 10);

export const options = {
    scenarios: {
        race: {
            executor: 'per-vu-iterations',
            vus: VUS,
            iterations: 1,
            maxDuration: '2m',
            // startTime全部一致(默认)，k6会在测试开始时尽量同时拉起全部VU，
            // 这是k6原生支持的并发能力，不需要额外配置
        }
    }
};

export function setup() {
    const fixedDeviceId = 'race_probe_device_' + Date.now();
    console.log(`\n${'='.repeat(70)}`);
    console.log(`  [RaceProbe] 并发竞态探测 | VUS=${VUS} | 固定deviceId=${fixedDeviceId}`);
    console.log(`  所有${VUS}个VU将用同一个deviceId，在几乎同一时刻并发发起游客注册`);
    console.log(`${'='.repeat(70)}\n`);
    return { fixedDeviceId };
}

export default function (data) {
    const vuTag = `vu${__VU}`;
    const fbclid = `race_${vuTag}_${Date.now()}`;
    const fbc = generateFbc(fbclid);

    const attribution = { ...TENANT_3003_FB_ATTRIBUTION.adAttribution, campaignName: `RaceTest-${vuTag}` };

    const result = guestRegister({
        ...TENANT_3003_FB_ATTRIBUTION,
        adAttribution: attribution,
        registerDevice: data.fixedDeviceId, // 全部VU共用同一个deviceId——这是本次要测的核心变量
        fbc
    });

    if (result && result.data && result.data.token) {
        console.log(`##RACE## ${vuTag} success userId=${result.data.userId} isNewRegister=${result.data.isNewRegister}`);
    } else {
        const err = getLastRegisterError();
        console.log(`##RACE## ${vuTag} rejected ${JSON.stringify(err)}`);
    }
}

export function teardown(data) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`  [RaceProbe] 并发测试结束 | deviceId=${data.fixedDeviceId}`);
    console.log(`  上面所有 ##RACE## 开头的行，统计 success 的数量：`);
    console.log(`  - 如果全部${VUS}个都success，说明"同设备"这个维度本来就没有`);
    console.log(`    唯一性限制(设计上允许)，不是竞态漏洞，是预期行为`);
    console.log(`  - 如果只有1个success、其余rejected，说明有唯一性限制且在`);
    console.log(`    并发下依然生效，防护是健壮的`);
    console.log(`  - 如果success数 > 1 但 < ${VUS}(比如本该只放行1个，实际放行了`);
    console.log(`    3-5个)，这就是竞态条件被触发的证据——检查和创建之间没有`);
    console.log(`    原子性保证，高并发下部分请求绕过了唯一性检查`);
    console.log(`${'='.repeat(70)}\n`);
}
