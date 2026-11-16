/**
 * 多渠道造数入口 —— 只负责"执行/造数"，不做任何报表验证(2026-11-13应用户要求明确
 * 拆开：执行完之后往往要等报表统计延迟一段时间才去验证，而且验证经常是单独、
 * 不紧跟着某次造数去跑的，所以这个脚本跑完只打印数据+退出，不调用任何
 * GetDataAnalysis/GetPackageAnalysis接口)。
 *
 *    数据分析总览,渠道来源分析,
 *
 * 跑完之后想验证，去跑同目录下的 dataAnalysisNewFieldsVerify.js ——那个脚本完全
 * 独立，默认会自动发现"某天出现过的所有渠道"，也可以用 PACKAGE_IDS 环境变量精确
 * 指定只验证这次造数产生的那几个渠道(把下面"渠道→packageId映射"那行日志里的
 * 数字抄过去就行，不用再反查)。
 *
 * 用法：
 *   k6p -e TENANT_ID=3004 -e TOTAL_PEOPLE=10 multiChannelAudienceSeed.test.js
 *     首次运行：不传CHANNEL_PACKAGE_ID_MAP，所有渠道的"老用户"步骤都会被跳过，
 *     全部走新增注册(见multiChannelAudienceBuilder.js文件头说明)。
 */

/**
 * 宽松JSON解析：标准JSON.parse失败时，把单引号当双引号再试一次(见上方PowerShell
 * 转义踩坑说明)。两次都失败才真正报错，不会掩盖"确实传了非法内容"这种情况。
 * 
 * k6p -e TENANT_ID=3004 -e TOTAL_PEOPLE=50 -e "CHANNEL_PACKAGE_ID_MAP={'wheel':[2],'adjust':[100058],'facebook':[100055],'tiktok':[100054]}" multiChannelAudienceSeed.test.js
 */
function parseLooseJson(raw, envName) {
    try {
        return JSON.parse(raw);
    } catch (e1) {
        try {
            return JSON.parse(raw.replace(/'/g, '"'));
        } catch (e2) {
            throw new Error(`[MultiChannelSeed] ${envName} 不是合法JSON(标准解析和单引号兜底解析都失败): ${raw}`);
        }
    }
}
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { phoneRegister } from '../login/register.test.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { generateRandomPhone } from '../../utils/accountGeneratorFaker.js';
import { buildMultiChannelAudience } from '../../../libs/channel/multiChannelAudienceBuilder.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const TOTAL_PEOPLE = __ENV.TOTAL_PEOPLE ? parseInt(__ENV.TOTAL_PEOPLE, 10) : 10;
const CHANNELS = __ENV.CHANNELS ? __ENV.CHANNELS.split(',').map(s => s.trim()) : ['official', 'wheel', 'adjust', 'facebook', 'tiktok'];
const ENABLE_WITHDRAW = __ENV.ENABLE_WITHDRAW !== 'false';
const ENABLE_BACKEND_APPROVAL = __ENV.ENABLE_BACKEND_APPROVAL !== 'false';
const CHANNEL_PACKAGE_ID_MAP = __ENV.CHANNEL_PACKAGE_ID_MAP ? parseLooseJson(__ENV.CHANNEL_PACKAGE_ID_MAP, 'CHANNEL_PACKAGE_ID_MAP') : {};
const TAG = 'MultiChannelSeed';

export const options = {
    scenarios: { seed: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '60m' } }
};

export default function () {
    console.log(`[${TAG}] 租户=${TENANT_ID} 总人数=${TOTAL_PEOPLE} 渠道=${CHANNELS.join(',')} 提现=${ENABLE_WITHDRAW} 后台审核=${ENABLE_BACKEND_APPROVAL} packageId映射=${JSON.stringify(CHANNEL_PACKAGE_ID_MAP)}`);

    const adminToken = tenantAdminLogin(TENANT_ID, true);
    if (!adminToken) { console.error(`[${TAG}] 后台登录失败，终止`); return; }
    console.log(`[${TAG}] ✅ 后台登录成功`);

    // 锚点账号：普通H5注册一个全新账号，拿它的邀请码给official/wheel渠道的新增注册用
    const anchorPhone = generateRandomPhone('91');
    const anchorReg = phoneRegister(anchorPhone, null);
    if (!anchorReg || !anchorReg.data || !anchorReg.data.token) {
        console.error(`[${TAG}] 锚点账号注册失败，终止`);
        return;
    }
    const anchorToken = anchorReg.data.token;
    const anchorFrontInfo = getFrontUserInfo(anchorToken);
    const anchorInviteCode = anchorFrontInfo ? anchorFrontInfo.inviteCode : null;
    if (!anchorInviteCode) {
        console.error(`[${TAG}] 获取锚点账号邀请码失败，终止`);
        return;
    }
    console.log(`[${TAG}] ✅ 锚点账号: ${anchorPhone} inviteCode=${anchorInviteCode}`);

    const { summaryByChannel, channelPackageIds } = buildMultiChannelAudience({
        adminToken,
        tenantId: TENANT_ID,
        anchorInviteCode,
        totalPeople: TOTAL_PEOPLE,
        channels: CHANNELS,
        channelPackageIdMap: CHANNEL_PACKAGE_ID_MAP,
        excludeAccounts: [anchorPhone],
        enableWithdraw: ENABLE_WITHDRAW,
        enableBackendApproval: ENABLE_BACKEND_APPROVAL
    });

    console.log(`\n[${TAG}] ========== 最终汇总 ==========`);
    console.log(JSON.stringify(summaryByChannel, null, 2));
    console.log(`\n[${TAG}] 本次涉及的全部packageId(可直接抄给dataAnalysisNewFieldsVerify.js的PACKAGE_IDS参数): ${Object.values(channelPackageIds).flat().join(',')}`);
    console.log(`[${TAG}] 验证脚本不需要立刻跑——这是一次性造数，之后随时想验证，去跑:\n  k6p -e TENANT_ID=${TENANT_ID} -e DATE=<当天日期> -e PACKAGE_IDS=${Object.values(channelPackageIds).flat().join(',')} dataAnalysisNewFieldsVerify.js`);
}
