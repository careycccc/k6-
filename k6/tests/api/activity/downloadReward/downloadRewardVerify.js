/**
 * 下载APP奖励(DownloadPage) —— 完整接口自动化验证
 *
 * 需求来源：产品"下载app奖励配置"需求文档(Axure原型，含2026-11-11新增的
 * "引导下载弹窗"更新)，以及用户在对话中对充值/设备/IP/指纹几个维度的口头
 * 澄清。本脚本只做接口级验证，不涉及真实PWA/套壳包/浏览器环境。
 *
 * 2026-11-11 本次会话实测确认的关键事实(写在这里防止后人重复踩坑)：
 *   1) clientType 字段完全由客户端自报，后端**零校验**——手动在
 *      /api/Home/Register 或 /api/Home/Login 的 payload 里传 clientType:2(或1)，
 *      配合"无需充值"模式，不需要真实APP/PWA环境即可触发下载奖励发放。
 *      【安全问题1】见A组用例。
 *   2) fingerprint 字段是 browserId 的原样回显，没有真实浏览器指纹采集。
 *      且(用户纠正的关键点)**浏览器指纹只在H5/PWA场景(clientType=1)下有
 *      意义，套壳包APP(clientType=2)用的是设备号(deviceId)，两者是完全
 *      独立的两条校验路径**——测指纹必须clientType=1+空deviceId，测设备号
 *      必须clientType=2。随机化browserId即可绕过指纹限流。【安全问题2】
 *      见F组用例。
 *   3) 同一账号PWA+APP合计最多领1次——先PWA登录领取成功，紧接着APP登录
 *      同账号，不应触发第二次发放。见B组。
 *   4) 首充规则是"阶梯满足制+资格一次性判定"：一次性充值达到/超过阈值才算，
 *      不支持累计凑够、不支持"只发起充值后台不审核"算数、不支持"先充不够+
 *      后充够"倒追认资格——首笔不达标，资格立即失效，后续充值不再触发。
 *      见C组6个场景。
 *   5) 设备ID/IP/浏览器指纹三项限流：额度内放行，超额度**静默拦截、不生成
 *      任何奖励记录**(不是生成一条带remark的拒绝记录)。且这三项限流用的
 *      是下载奖励功能自己专属的计数器，不是复用全站通用风控体系
 *      (/api/Users/GetUserRiskControlPageList)——该接口查指纹查不到任何
 *      记录(两套"指纹"概念互不相通)，查IP即使历史关联几百个账号，下载奖励
 *      照样能在"额度内"正常发放(不是直接拿那个数字做判断)。见D/E/F组。
 *   6) 当前测试环境租户3004是共享环境，配置会被其他人/进程中途改动过
 *      (实测抓到过一次)，所以用 ensureDownloadRewardConfig() 在每个关键
 *      步骤前自愈检查，不能只在开头设置一次就假设它一直有效。
 *   7) 本机直连出口IP在风控体系里历史关联账号数高达3万+，会让"IP限流"从
 *      第一次请求就必然超限，测不出"额度内应放行"这部分。E组需要换一个
 *      干净出口IP才能完整验证——同源 k6-go 项目的 .env 里配了
 *      K6GO_TEST_PROXY=http://127.0.0.1:10808(本地v2rayN/Clash代理)，
 *      k6(JS)本身不支持按请求设代理，但可以给整个 k6 run 进程设
 *      HTTP_PROXY/HTTPS_PROXY 环境变量换这次运行的出口IP：
 *        HTTP_PROXY=http://127.0.0.1:10808 HTTPS_PROXY=http://127.0.0.1:10808 \
 *          k6 run k6/tests/api/activity/downloadReward/downloadRewardVerify.js
 *      不设代理直接跑的话，E组只能验证"超额度会被拦截"，验不出"额度内应
 *      放行"这部分(这是已知的环境限制，脚本会打印明确提示，不会误报失败)。
 *   8) PWA/APP下载奖励总开关(DownloadRewardPwaIsOpen/DownloadRewardAppIsOpen)
 *      跟限流额度类配置项不一样，**改完不是立即生效，需要等待1分钟**(用户
 *      明确要求)才能继续后续的登录/验证逻辑，否则可能读到旧状态误判。见G组，
 *      G组因为含多次sleep(60)，整体比较耗时(单独跑这一组大约7-8分钟)。
 *   9) "合计限1次"这条规则不只在"两次都走登录接口"时生效，跨接口路径
 *      (先靠安全问题1在Register接口拿到奖励，再用Login接口登录，不管哪个
 *      clientType，包括不传clientType的H5默认请求)同样正确识别"已经领过"，
 *      不会因为换了接口就把发放次数算错。见H组。
 *   10) 真正的并发(几乎同时)登录PWA+APP跟"先后顺序登录"(B组)是两件不同的
 *      事——顺序登录已验证不会重复发放，但没有排除"两个请求几乎同时到达，
 *      都读到'未领取'的旧状态，各自发了一次奖"这种并发竞态漏洞的可能性。
 *      见I组(放在整个脚本最前面跑，避开其它组消耗掉的登录接口限流窗口)。
 *   11) (2026-11-11用户截图发现并要求复现)后台"下载奖励记录"列表里出现过
 *      10条"充值类型=无需充值、充值要求=0，但奖励状态=待完成"的记录，直觉
 *      像是"无需充值模式没有自动发放"的bug。
 *      【结论：不是bug，是两个展示字段在"从未被赋值过"和"真实配置值=0"之间
 *      共用了同一个默认值，造成的误导性展示】
 *      已反复验证：**没有找到任何一例"真正按无需充值规则判定、却卡在待完成"
 *      的情况**——全站A/B/D/F/G/H/I/J组里，只要账号登录时无需充值配置确实
 *      生效，state必定在1秒内变成1(已完成)，从未出现过卡在0的情况。
 *      真正的机制(经多组对照测试锁定，置信度高)：充值类型/充值要求这两个
 *      字段，**不是在记录创建时写入，也不是实时跟随当前配置，而是在"真正
 *      触发判定的那个事件发生时"才被赋值**：
 *        - 无需充值模式下，"登录"本身就是判定事件，立即写入state=1+当时的
 *          充值类型/充值要求(此时是0/0，因为规则确实是无需充值)。
 *        - 首充模式下，登录只创建一条"待完成"占位记录，充值类型/充值要求
 *          字段还没被赋过值(只是初始默认的0/0)；真正的判定要等到"一笔充值
 *          订单完成/被审核"这个事件发生、拿当时的规则去核对金额，才会把这
 *          两个字段正确写成1/1200，并把state改成1(达标)或2(未达标)。
 *      所以：**如果账号从头到尾都没有发生过一笔真正到账的充值(完全不充值，
 *      或者只发起从未审核)，这两个字段就会永远停留在从未被赋值的默认0/0，
 *      跟"规则真的是无需充值(0)"长得一模一样，造成误导**——但这跟无需充值
 *      模式本身毫无关系，账号实际上从始至终都在首充模式的判定逻辑下，只是
 *      碰巧用0这个值同时表示"规则是无需充值"和"字段还没被赋值过"这两种不同
 *      的含义。核实后台那10条历史记录，全部命中"从未有一笔已审核到账充值"
 *      (本地入款0笔，三方充值要么没有要么全部是Cancel/0元)，其中2条直接
 *      核对账号确认就是本次会话C组的C0/C4测试账号。见J组用例复现。
 *      (建议反馈给开发侧：展示层应该把"字段尚未被赋值"跟"字段确实等于0"
 *      区分开，比如前者显示为空/--，而不是数字0，避免后台排查时产生混淆。)
 *      (附：state字段取值含义，2026-11-11实测确认：0=待完成(尚未发生判定
 *      事件，或判定事件尚未处理)，1=已完成(已发放，rewardAmount/receiveTime
 *      有值)，2=已拒绝(不会再发放，remark里有拒绝原因，比如"首充未达标..."))
 *
 * 用法：
 *   k6 run k6/tests/api/activity/downloadReward/downloadRewardVerify.js
 *   (验证E组IP限流的"额度内放行"部分时，按上面第7条带代理环境变量运行)
 */
import http from 'k6/http';
import { sleep } from 'k6';
import { httpClient } from '../../../../libs/http/client.js';
import { tenantAdminLogin } from '../../../../libs/http/tenantRequest.js';
import { resolveApiRoute } from '../../../../config/environment.js';
import { generateRandomPhone } from '../../../utils/accountGenerator.js';
import { getTimeRandom, generateCryptoRandomString } from '../../../utils/utils.js';
import { phoneRegister } from '../../login/register.test.js';
import { getFrontUserInfo } from '../../user/userManagement.js';
import { manualRecharge } from '../../recharge/manualRecharge.js';
import { assembleFiatRechargeNoUsdt } from '../../groupRechargeWithdrawReport/rechargeAssembler.js';
import {
    getDownloadRewardSetting,
    ensureDownloadRewardConfig,
    updateDownloadRewardSetting,
    registerAsDownloadRewardClient,
    loginAsDownloadRewardClient,
    getDownloadRewardRecordByUserId,
    getAllDownloadRewardRecordsByUserId
} from './downloadRewardApi.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';

export const options = { vus: 1, iterations: 1 };

// ============================================================
// 用例报告：caseId/会员ID/账号/预期/实际，统一格式方便排查(用户明确要求)
// ============================================================
const results = [];

function reportCase(caseId, userId, account, expected, record) {
    const actual = record
        ? `state=${record.state}, rewardAmount=${record.rewardAmount}, rechargeType=${record.rechargeType}, rechargeRequire=${record.rechargeRequire}, deviceId=${record.deviceId}, ip=${record.ip}, fingerprint=${record.fingerprint}, remark=${JSON.stringify(record.remark)}`
        : '无记录(null) = 未发放/被拦截';
    const line = `caseId=${caseId} | 会员ID=${userId} | 账号=${account} | 预期=${expected} | 实际=${actual}`;
    results.push(line);
    console.log(`[用例报告] ${line}`);
}

/** 注册一个新账号并以 clientType 身份登录，返回 {phone, userId, token} 供后续充值/查询使用 */
function newAccount(label, clientType, deviceId) {
    const phone = generateRandomPhone('91');
    const reg = phoneRegister(phone, {});
    if (!reg) { console.error(`[${label}] 注册失败`); return null; }
    sleep(2);
    const login = loginAsDownloadRewardClient(phone, clientType, deviceId !== undefined ? { deviceId } : {});
    const userId = login.data ? login.data.userId : null;
    const token = login.data ? login.data.token : null;
    console.log(`[${label}] 全新账号=${phone} userId=${userId} 登录msgCode=${login.msgCode}`);
    return { phone, userId, token };
}

// ============================================================
// I组：真正的并发(同时)登录PWA+APP，验证是否存在竞态漏洞(2026-11-11用户补充)
// 关键点：跟B组"先PWA登录再APP登录"的顺序测试不同，这里用http.batch几乎
// 同时发出两个登录请求，验证后端"是否已领取"的判定在并发场景下有没有被
// 绕过(比如两个请求都读到"未领取"的旧状态，结果各自发了一次奖，变成2条
// 记录)。之前(本次会话更早阶段)尝试过一次，但紧跟在其它测试后面做，撞上了
// 登录接口的限流(msgCode=13)，没能拿到确定结论——这次把I组放在整个脚本
// 最前面单独跑，账号也是全新注册、刚好是它的头2个登录请求，尽量避免撞限流。
// ============================================================
function runGroupI_ConcurrentLogin(adminToken) {
    console.log('========== I组：真正并发(同时)登录PWA+APP，验证是否存在竞态漏洞 ==========');
    ensureDownloadRewardConfig(adminToken, {
        DownloadRewardRechargeType: '0',
        DownloadRewardDeviceLimit: '9', DownloadRewardIpLimit: '0', DownloadRewardFingerprintLimit: '9',
        DownloadRewardPwaIsOpen: '1', DownloadRewardAppIsOpen: '1'
    }, 'I组准备');
    sleep(2);

    const phone = generateRandomPhone('91');
    const reg = phoneRegister(phone, {}); // 普通H5注册，不触发clientType注入漏洞
    if (!reg) { console.error('[I组] 注册失败'); return; }
    sleep(3);

    const route = resolveApiRoute('/api/Home/Login', true, false);
    const signClient = new httpClient.constructor();

    const td1 = getTimeRandom();
    const payload1 = {
        loginType: 'Mobile', userName: phone, password: 'qwer1234',
        deviceId: '', browserId: generateCryptoRandomString(32), packageName: '',
        clientType: 1, language: td1.language, random: td1.random
    };
    const signed1 = signClient.signData(payload1);

    const td2 = getTimeRandom();
    const payload2 = {
        loginType: 'Mobile', userName: phone, password: 'qwer1234',
        deviceId: generateCryptoRandomString(16), browserId: generateCryptoRandomString(32), packageName: '',
        clientType: 2, language: td2.language, random: td2.random
    };
    const signed2 = signClient.signData(payload2);

    const headers = { 'Content-Type': 'application/json' };
    const batchResults = http.batch([
        { method: 'POST', url: route.url, body: JSON.stringify(signed1), params: { headers } },
        { method: 'POST', url: route.url, body: JSON.stringify(signed2), params: { headers } }
    ]);

    const b1 = JSON.parse(batchResults[0].body);
    const b2 = JSON.parse(batchResults[1].body);
    console.log(`[I组] 并发登录1(PWA) msgCode=${b1.msgCode} msg=${b1.msg}`);
    console.log(`[I组] 并发登录2(APP) msgCode=${b2.msgCode} msg=${b2.msg}`);
    const userId = (b1.data && b1.data.userId) || (b2.data && b2.data.userId);

    sleep(5); // 给异步奖励发放流程留足时间
    const allRecords = userId ? getAllDownloadRewardRecordsByUserId(adminToken, userId) : [];

    const expected = '同一账号几乎同时发起PWA+APP两次登录请求，"合计限1次"规则下应该只产生0或1条奖励记录，不应该产生2条(2条=存在竞态漏洞，判定逻辑没有并发互斥保护)';
    const actual = allRecords.length === 0
        ? '0条记录(两次登录都没有成功发放)'
        : `${allRecords.length}条记录: ${JSON.stringify(allRecords.map(r => ({ orderNo: r.orderNo, state: r.state, rewardAmount: r.rewardAmount })))}`;
    const line = `caseId=I1-并发登录竞态测试 | 会员ID=${userId} | 账号=${phone} | 预期=${expected} | 实际=${actual}`;
    results.push(line);
    console.log(`[用例报告] ${line}`);
    if (allRecords.length >= 2) {
        console.warn(`[I组⚠️] 检测到${allRecords.length}条记录——疑似存在并发竞态漏洞！`);
    }
}

// ============================================================
// A组：clientType客户端识别(含安全发现1)
// ============================================================
function runGroupA_ClientTypeDetection(adminToken) {
    console.log('========== A组：clientType客户端识别(含安全发现1) ==========');
    ensureDownloadRewardConfig(adminToken, {
        DownloadRewardRechargeType: '0', // 无需充值，注册当下即可判定，方便快速验证
        DownloadRewardDeviceLimit: '9', DownloadRewardIpLimit: '0', DownloadRewardFingerprintLimit: '9'
    }, 'A组准备');
    sleep(2);

    // A1: clientType=2(套壳包)在注册阶段注入，验证安全问题1——注册当下即应发放，不需要登录
    const phoneA1 = generateRandomPhone('91');
    const regA1 = registerAsDownloadRewardClient(phoneA1, 2);
    const tokenA1 = regA1.data ? regA1.data.token : null;
    const infoA1 = tokenA1 ? getFrontUserInfo(tokenA1) : null;
    const userIdA1 = infoA1 ? infoA1.userId : null;
    sleep(3);
    reportCase('A1-clientType=2注册时注入(安全问题1)', userIdA1, phoneA1,
        '仅注册阶段手动传clientType:2(无真实APP环境)，后端零校验，注册当下即应发放奖励——这是一处业务逻辑漏洞，不是正常行为',
        userIdA1 ? getDownloadRewardRecordByUserId(adminToken, userIdA1) : null);

    // A2: clientType=1(H5/PWA)同样在注册阶段注入，印证同一套漏洞对H5/PWA也成立
    sleep(2);
    const phoneA2 = generateRandomPhone('91');
    const regA2 = registerAsDownloadRewardClient(phoneA2, 1);
    const tokenA2 = regA2.data ? regA2.data.token : null;
    const infoA2 = tokenA2 ? getFrontUserInfo(tokenA2) : null;
    const userIdA2 = infoA2 ? infoA2.userId : null;
    sleep(3);
    reportCase('A2-clientType=1注册时注入(PWA对照组)', userIdA2, phoneA2,
        '同样手动传clientType:1，验证H5/PWA路径同样零校验，注册当下即应发放',
        userIdA2 ? getDownloadRewardRecordByUserId(adminToken, userIdA2) : null);
}

// ============================================================
// B组：PWA+APP合计限1次
// ============================================================
function runGroupB_CombinedClaimLimit(adminToken) {
    console.log('========== B组：PWA+APP合计限1次 ==========');
    ensureDownloadRewardConfig(adminToken, {
        DownloadRewardRechargeType: '0',
        DownloadRewardDeviceLimit: '9', DownloadRewardIpLimit: '0', DownloadRewardFingerprintLimit: '9'
    }, 'B组准备');
    sleep(2);

    const phone = generateRandomPhone('91');
    const reg = phoneRegister(phone, {});
    if (!reg) { console.error('[B组] 注册失败'); return; }
    sleep(2);

    const loginPwa = loginAsDownloadRewardClient(phone, 1);
    const userId = loginPwa.data ? loginPwa.data.userId : null;
    sleep(3);
    const recordAfterPwa = userId ? getDownloadRewardRecordByUserId(adminToken, userId) : null;
    reportCase('B1-PWA首次登录', userId, phone, 'PWA(clientType=1)首次登录应正常发放一次奖励', recordAfterPwa);

    sleep(3); // 避开登录接口限流窗口
    loginAsDownloadRewardClient(phone, 2); // 同账号紧接着套壳包APP登录
    sleep(3);
    const recordAfterApp = userId ? getDownloadRewardRecordByUserId(adminToken, userId) : null;
    reportCase('B2-同账号紧接着APP登录', userId, phone,
        'PWA已领取过，APP(clientType=2)登录不应再触发第二次发放，奖励记录应跟PWA那次是同一条(不新增)',
        recordAfterApp);
    if (recordAfterPwa && recordAfterApp) {
        console.log(`[B组核实] PWA/APP两次查询到的订单号是否一致: ${recordAfterPwa.orderNo === recordAfterApp.orderNo}`);
    }
}

// ============================================================
// C组：充值规则6场景(首充阈值1200)
// ============================================================
function runGroupC_RechargeRules(adminToken) {
    console.log('========== C组：充值规则6场景(首充阈值1200) ==========');
    updateDownloadRewardSetting(adminToken, 'DownloadRewardRechargeType', '1', '1200'); // 1=首笔充值
    ensureDownloadRewardConfig(adminToken, {
        DownloadRewardRechargeType: '1',
        DownloadRewardDeviceLimit: '9', DownloadRewardIpLimit: '0', DownloadRewardFingerprintLimit: '9'
    }, 'C组准备');
    sleep(2);

    // C0 对照组：完全不充值
    sleep(2);
    let u = newAccount('C0-对照组不充值', 2);
    if (u) {
        sleep(3);
        reportCase('C0-对照组-完全不充值', u.userId, u.phone,
            '首充模式下完全不充值，不应发放(对照组，排除"随便登录就发"的误判)',
            getDownloadRewardRecordByUserId(adminToken, u.userId));
    }

    // C1 正例-精确等于1200
    sleep(2);
    u = newAccount('C1-正例等于1200', 2);
    if (u) {
        updateDownloadRewardSetting(adminToken, 'DownloadRewardRechargeType', '1', '1200');
        manualRecharge(adminToken, u.userId, 1200, 1, 'C1-精确等于', 3, true);
        sleep(3);
        reportCase('C1-正例-精确等于1200', u.userId, u.phone, '一次性充值精确等于阈值1200，应发放', getDownloadRewardRecordByUserId(adminToken, u.userId));
    }

    // C2 正例-大于1200
    sleep(2);
    u = newAccount('C2-正例大于1200', 2);
    if (u) {
        updateDownloadRewardSetting(adminToken, 'DownloadRewardRechargeType', '1', '1200');
        manualRecharge(adminToken, u.userId, 1500, 1, 'C2-大于阈值', 3, true);
        sleep(3);
        reportCase('C2-正例-大于1200(充1500)', u.userId, u.phone, '一次性充值大于阈值1200(1500)，应发放', getDownloadRewardRecordByUserId(adminToken, u.userId));
    }

    // C3 反例1-累计充值凑够1200(两笔各600)
    sleep(2);
    u = newAccount('C3-反例1累计1200', 2);
    if (u) {
        updateDownloadRewardSetting(adminToken, 'DownloadRewardRechargeType', '1', '1200');
        manualRecharge(adminToken, u.userId, 600, 1, 'C3-第1笔600', 3, true);
        sleep(2);
        manualRecharge(adminToken, u.userId, 600, 1, 'C3-第2笔600(累计1200)', 3, true);
        sleep(3);
        reportCase('C3-反例1-累计充值凑够1200(600+600)', u.userId, u.phone, '不支持累计充值凑够阈值，两笔都不达标，不应发放', getDownloadRewardRecordByUserId(adminToken, u.userId));
    }

    // C4 反例2-只发起充值，后台不审核(留在Wait/PendingReview状态)
    // 注意：assembleFiatRechargeNoUsdt 内部查订单之前有个缺口(backendRechargeApi.js的
    // getRechargeOrderPageList等4个函数都没透传forceTenant给sendRequest)，导致不管传
    // 商户token还是集团token都会卡住(商户token报"Account type does not match"，换集团
    // token又可能报"No operation permission"权限不足)——2026-11-11已经直接修好这4个
    // 函数+pollAndAudit的透传链路，这里直接用外层的forceTenant商户token，传
    // {forceTenant:true}即可，不用再绕道集团token。
    sleep(2);
    u = newAccount('C4-反例2发起不审核', 2);
    if (u && u.token) {
        updateDownloadRewardSetting(adminToken, 'DownloadRewardRechargeType', '1', '1200');
        const depositResult = assembleFiatRechargeNoUsdt(u.token, adminToken, u.userId, 1200, { audit: false, forceTenant: true });
        console.log(`[C4] 发起充值结果: ${JSON.stringify(depositResult)}`);
        sleep(3);
        reportCase('C4-反例2-只发起充值不审核', u.userId, u.phone, '只是发起充值，后台不进行补单(不审核)，不算成功充值，不应发放', getDownloadRewardRecordByUserId(adminToken, u.userId));
    } else if (u) {
        console.error('[C4] 没拿到userToken，跳过发起充值这一步');
    }

    // C5 反例3-先小后大(第1笔小于阈值，第2笔大于等于阈值)
    sleep(2);
    u = newAccount('C5-反例3先小后大', 2);
    if (u) {
        updateDownloadRewardSetting(adminToken, 'DownloadRewardRechargeType', '1', '1200');
        manualRecharge(adminToken, u.userId, 500, 1, 'C5-第1笔500(小于阈值)', 3, true);
        sleep(2);
        manualRecharge(adminToken, u.userId, 1300, 1, 'C5-第2笔1300(大于阈值)', 3, true);
        sleep(3);
        reportCase('C5-反例3-先小后大(500→1300)', u.userId, u.phone, '首笔(500)未达标，资格已失效，第2笔再怎么充都不应被追认发放', getDownloadRewardRecordByUserId(adminToken, u.userId));
    }
}

// ============================================================
// D组：设备ID限流(限2，套壳包APP场景)
// ============================================================
function runGroupD_DeviceIdLimit(adminToken) {
    console.log('========== D组：设备ID限流(限2，套壳包APP场景) ==========');
    ensureDownloadRewardConfig(adminToken, {
        DownloadRewardRechargeType: '0',
        DownloadRewardDeviceLimit: '2', DownloadRewardIpLimit: '0', DownloadRewardFingerprintLimit: '0'
    }, 'D组准备');
    sleep(2);

    const fixedDeviceId = 'FIXED-DEVICE-' + generateCryptoRandomString(8);
    console.log(`[D组] 固定使用的deviceId=${fixedDeviceId}`);

    for (let i = 1; i <= 3; i++) {
        sleep(2);
        ensureDownloadRewardConfig(adminToken, {
            DownloadRewardDeviceLimit: '2', DownloadRewardIpLimit: '0', DownloadRewardFingerprintLimit: '0'
        }, `D组-第${i}次前`);
        const u = newAccount(`D组-设备ID-第${i}次`, 2, fixedDeviceId);
        if (u) {
            sleep(3);
            const expected = i <= 2
                ? `全新账号(userId=${u.userId})用同一设备ID领取，该设备ID累计未超限(2)，应发放`
                : `全新账号(userId=${u.userId})用同一设备ID领取，该设备ID已累计达上限(2)，即使是全新用户也应被拦截，不发放`;
            reportCase(`D${i}-设备ID限流-第${i}次`, u.userId, u.phone, expected, getDownloadRewardRecordByUserId(adminToken, u.userId));
        }
    }
}

// ============================================================
// E组：IP限流(限2)
// ============================================================
function runGroupE_IpLimit(adminToken) {
    console.log('========== E组：IP限流(限2) ==========');
    const proxyConfigured = !!(__ENV.HTTP_PROXY || __ENV.HTTPS_PROXY);
    if (!proxyConfigured) {
        console.warn('[E组] ⚠️ 未检测到HTTP_PROXY/HTTPS_PROXY环境变量——本机直连出口IP历史关联账号数可能已经很高，'
            + '"额度内应放行"这部分可能验不出来(只能验到"超额度会被拦截")。要完整验证，参考文件头注释第7条用代理换一个'
            + '干净出口IP重跑这个脚本。');
    }
    ensureDownloadRewardConfig(adminToken, {
        DownloadRewardRechargeType: '0',
        DownloadRewardDeviceLimit: '0', DownloadRewardIpLimit: '2', DownloadRewardFingerprintLimit: '0'
    }, 'E组准备');
    sleep(2);

    for (let i = 1; i <= 3; i++) {
        sleep(2);
        ensureDownloadRewardConfig(adminToken, {
            DownloadRewardDeviceLimit: '0', DownloadRewardIpLimit: '2', DownloadRewardFingerprintLimit: '0'
        }, `E组-第${i}次前`);
        const u = newAccount(`E组-IP-第${i}次`, 2); // deviceId随机，不固定；IP天然共享本次运行的出口IP
        if (u) {
            sleep(3);
            const expected = i <= 2
                ? `全新账号(userId=${u.userId})同一出口IP领取，该IP累计未超限(2)，应发放${proxyConfigured ? '' : '(若未配代理且该IP历史额度已耗尽，可能仍会被拦截，属已知环境限制)'}`
                : `全新账号(userId=${u.userId})同一出口IP领取，该IP已累计达上限(2)，应被拦截，不发放`;
            reportCase(`E${i}-IP限流-第${i}次`, u.userId, u.phone, expected, getDownloadRewardRecordByUserId(adminToken, u.userId));
        }
    }
}

// ============================================================
// F组：浏览器指纹限流(限2，H5/PWA场景，安全问题2)
// ============================================================
function runGroupF_FingerprintLimit(adminToken) {
    console.log('========== F组：浏览器指纹限流(限2，H5/PWA场景) ==========');
    ensureDownloadRewardConfig(adminToken, {
        DownloadRewardRechargeType: '0',
        DownloadRewardDeviceLimit: '0', DownloadRewardIpLimit: '0', DownloadRewardFingerprintLimit: '2'
    }, 'F组准备');
    sleep(2);

    const fixedFingerprint = 'FIXED-FP-' + generateCryptoRandomString(8);
    console.log(`[F组] 固定使用的browserId(即fingerprint)=${fixedFingerprint}，全部用PWA(clientType=1)登录`);

    for (let i = 1; i <= 3; i++) {
        sleep(2);
        ensureDownloadRewardConfig(adminToken, {
            DownloadRewardDeviceLimit: '0', DownloadRewardIpLimit: '0', DownloadRewardFingerprintLimit: '2'
        }, `F组-第${i}次前`);
        const phone = generateRandomPhone('91');
        const reg = phoneRegister(phone, {});
        if (!reg) { console.error(`[F组-第${i}次] 注册失败`); continue; }
        sleep(2);
        const login = loginAsDownloadRewardClient(phone, 1, { browserId: fixedFingerprint });
        const userId = login.data ? login.data.userId : null;
        console.log(`[F组-第${i}次] 账号=${phone} userId=${userId} msgCode=${login.msgCode}`);
        sleep(3);
        const expected = i <= 2
            ? `PWA登录，第${i}次用同一浏览器指纹(browserId)领取，未超过限制(2)，应发放`
            : `PWA登录，第${i}次用同一浏览器指纹(browserId)领取，已达上限(2)，不应发放`;
        reportCase(`F${i}-指纹限流-PWA-固定browserId-第${i}次`, userId, phone, expected, userId ? getDownloadRewardRecordByUserId(adminToken, userId) : null);
    }
}

// ============================================================
// G组：PWA/APP下载奖励开关关闭场景(2026-11-11用户补充)
// 关键点：开关(DownloadRewardPwaIsOpen/DownloadRewardAppIsOpen)改完之后，
// 必须等待1分钟才能继续后续验证逻辑(用户明确要求)——跟C-F组的配置项不同，
// 这两个开关生效有延迟，不能像限流额度那样改完立刻验证。
// ============================================================
function runGroupG_SwitchToggle(adminToken) {
    console.log('========== G组：PWA/APP下载奖励开关关闭场景 ==========');
    ensureDownloadRewardConfig(adminToken, {
        DownloadRewardRechargeType: '0',
        DownloadRewardDeviceLimit: '9', DownloadRewardIpLimit: '0', DownloadRewardFingerprintLimit: '9',
        DownloadRewardPwaIsOpen: '1', DownloadRewardAppIsOpen: '1'
    }, 'G组准备-确认开关先都是开启状态');
    sleep(2);

    // ---- G1：关闭PWA开关，APP开关保持开启 ----
    console.log('[G1] 关闭PWA下载奖励开关，等待1分钟生效...');
    updateDownloadRewardSetting(adminToken, 'DownloadRewardPwaIsOpen', '0');
    sleep(60);
    ensureDownloadRewardConfig(adminToken, { DownloadRewardPwaIsOpen: '0', DownloadRewardAppIsOpen: '1' }, 'G1前复核');

    let u = newAccount('G1a-PWA关闭后PWA登录', 1);
    if (u) {
        sleep(3);
        reportCase('G1a-PWA开关关闭后PWA登录', u.userId, u.phone,
            'PWA下载奖励开关(DownloadRewardPwaIsOpen)已关闭，PWA(clientType=1)登录不应能领取奖励',
            getDownloadRewardRecordByUserId(adminToken, u.userId));
    }
    sleep(2);
    u = newAccount('G1b-PWA关闭后APP登录', 2);
    if (u) {
        sleep(3);
        reportCase('G1b-PWA开关关闭,APP登录', u.userId, u.phone,
            'PWA开关关闭不应影响APP开关，套壳包APP(clientType=2)登录应能正常领取奖励',
            getDownloadRewardRecordByUserId(adminToken, u.userId));
    }

    // ---- 恢复PWA开关，为G2做准备 ----
    console.log('[G1恢复] 重新打开PWA下载奖励开关，等待1分钟生效...');
    updateDownloadRewardSetting(adminToken, 'DownloadRewardPwaIsOpen', '1');
    sleep(60);

    // ---- G2：关闭APP开关，PWA开关保持开启 ----
    console.log('[G2] 关闭APP下载奖励开关，等待1分钟生效...');
    updateDownloadRewardSetting(adminToken, 'DownloadRewardAppIsOpen', '0');
    sleep(60);
    ensureDownloadRewardConfig(adminToken, { DownloadRewardPwaIsOpen: '1', DownloadRewardAppIsOpen: '0' }, 'G2前复核');

    u = newAccount('G2a-APP关闭后APP登录', 2);
    if (u) {
        sleep(3);
        reportCase('G2a-APP开关关闭后APP登录', u.userId, u.phone,
            'APP下载奖励开关(DownloadRewardAppIsOpen)已关闭，套壳包APP(clientType=2)登录不应能领取奖励',
            getDownloadRewardRecordByUserId(adminToken, u.userId));
    }
    sleep(2);
    u = newAccount('G2b-APP关闭后PWA登录', 1);
    if (u) {
        sleep(3);
        reportCase('G2b-APP开关关闭,PWA登录', u.userId, u.phone,
            'APP开关关闭不应影响PWA开关，PWA(clientType=1)登录应能正常领取奖励',
            getDownloadRewardRecordByUserId(adminToken, u.userId));
    }

    // ---- G3：两个开关都关闭(APP此时已经是关闭状态，只需再关PWA) ----
    console.log('[G3] 两个开关都关闭(在G2基础上再关PWA)，等待1分钟生效...');
    updateDownloadRewardSetting(adminToken, 'DownloadRewardPwaIsOpen', '0');
    sleep(60);
    ensureDownloadRewardConfig(adminToken, { DownloadRewardPwaIsOpen: '0', DownloadRewardAppIsOpen: '0' }, 'G3前复核');

    u = newAccount('G3a-都关闭后PWA登录', 1);
    if (u) {
        sleep(3);
        reportCase('G3a-两开关都关闭,PWA登录', u.userId, u.phone,
            'PWA/APP开关都已关闭，PWA(clientType=1)登录不应能领取奖励',
            getDownloadRewardRecordByUserId(adminToken, u.userId));
    }
    sleep(2);
    u = newAccount('G3b-都关闭后APP登录', 2);
    if (u) {
        sleep(3);
        reportCase('G3b-两开关都关闭,APP登录', u.userId, u.phone,
            'PWA/APP开关都已关闭，套壳包APP(clientType=2)登录不应能领取奖励',
            getDownloadRewardRecordByUserId(adminToken, u.userId));
    }

    // ---- 恢复两个开关，留给后续其它组/其它人干净状态 ----
    console.log('[G组恢复] 重新打开PWA和APP下载奖励开关，等待1分钟生效...');
    updateDownloadRewardSetting(adminToken, 'DownloadRewardPwaIsOpen', '1');
    updateDownloadRewardSetting(adminToken, 'DownloadRewardAppIsOpen', '1');
    sleep(60);
}

// ============================================================
// H组：注册端(PWA/APP)靠安全问题1已经拿到一次奖励后，再用其它端登录，
// 验证"合计限1次"这条规则是否也跨接口路径生效(2026-11-11用户补充)。
// 关键点：B组验证的"合计限1次"只覆盖了"两次都走登录接口"这一种情况；
// A组验证的"注册阶段clientType注入即发放"走的是Register接口，不是Login
// 接口。这里要验证：Register接口发放过奖励后，Login接口(不管是哪个
// clientType，包括不传clientType的H5默认请求)是否仍然正确识别"已经领过"
// 这个状态，不会把两条不同接口路径的发放次数算错。
// ============================================================
function runGroupH_RegisterLoginCrossPath(adminToken) {
    console.log('========== H组：注册端已拿奖励后，再用其它端登录是否会重复发放 ==========');
    ensureDownloadRewardConfig(adminToken, {
        DownloadRewardRechargeType: '0',
        DownloadRewardDeviceLimit: '9', DownloadRewardIpLimit: '0', DownloadRewardFingerprintLimit: '9',
        DownloadRewardPwaIsOpen: '1', DownloadRewardAppIsOpen: '1'
    }, 'H组准备');
    sleep(2);

    /** 用clientType在注册阶段注入拿到奖励，返回{phone, userId, token} */
    function registerAndGetReward(label, registerClientType) {
        const phone = generateRandomPhone('91');
        const reg = registerAsDownloadRewardClient(phone, registerClientType);
        const token = reg.data ? reg.data.token : null;
        const info = token ? getFrontUserInfo(token) : null;
        const userId = info ? info.userId : null;
        console.log(`[${label}] 全新账号=${phone} userId=${userId}`);
        return { phone, userId, token };
    }

    const cases = [
        { id: 'H1', registerClientType: 1, registerLabel: 'PWA(clientType=1)', loginClientType: 2, loginLabel: 'APP(clientType=2)登录' },
        { id: 'H2', registerClientType: 1, registerLabel: 'PWA(clientType=1)', loginClientType: null, loginLabel: 'H5(不带clientType)登录' },
        { id: 'H3', registerClientType: 2, registerLabel: 'APP(clientType=2)', loginClientType: 1, loginLabel: 'PWA(clientType=1)登录' },
        { id: 'H4', registerClientType: 2, registerLabel: 'APP(clientType=2)', loginClientType: null, loginLabel: 'H5(不带clientType)登录' }
    ];

    for (const c of cases) {
        sleep(3);
        const u = registerAndGetReward(`${c.id}-${c.registerLabel}注册`, c.registerClientType);
        if (!u.userId) { console.error(`[${c.id}] 没拿到userId，跳过`); continue; }
        sleep(3);
        const recordAfterReg = getDownloadRewardRecordByUserId(adminToken, u.userId);
        reportCase(`${c.id}a-${c.registerLabel}注册后`, u.userId, u.phone,
            `${c.registerLabel}注册阶段应已发放一次奖励(安全问题1的直接后果)`,
            recordAfterReg);

        sleep(3); // 避开登录接口限流窗口
        loginAsDownloadRewardClient(u.phone, c.loginClientType);
        sleep(3);
        const recordAfterLogin = getDownloadRewardRecordByUserId(adminToken, u.userId);
        reportCase(`${c.id}b-${c.registerLabel}注册后${c.loginLabel}`, u.userId, u.phone,
            `注册阶段已经发放过，之后${c.loginLabel}不应再触发第二次发放(跨接口路径仍应遵循合计限1次)`,
            recordAfterLogin);
        if (recordAfterReg && recordAfterLogin) {
            console.log(`[${c.id}核实] 注册后/登录后查到的订单号是否一致: ${recordAfterReg.orderNo === recordAfterLogin.orderNo}`);
        }
    }
}

// ============================================================
// J组：复现用户截图发现的"充值类型=无需充值但待完成"现象(2026-11-11)——
// 见文件头事实11。J1(切到首充模式+全新账号不充值)应该长期待完成，且充值
// 类型/充值要求会停留在从未被赋值的默认0/0(容易被误读成"无需充值")；J2
// (切回无需充值+全新账号)应该立即发放，且充值类型/充值要求正确等于当下
// GetSetting查到的配置(0/0)——两相对照，证明"字段停在0"只发生在"从未发生
// 过充值判定事件"的待完成记录上，不是无需充值模式本身没有发放。
// ============================================================
/** 记录自身的充值类型/充值要求字段，跟同一时刻GetSetting查到的"当前配置"做对比并打印，
 * 不对一致/不一致做任何预先假设，只如实记录观察结果。 */
function logRecordVsLiveConfig(adminToken, userId, label) {
    const record = getDownloadRewardRecordByUserId(adminToken, userId);
    const liveConfig = getDownloadRewardSetting(adminToken);
    const liveType = liveConfig.downloadRewardRechargeType ? liveConfig.downloadRewardRechargeType.value1 : undefined;
    const liveRequire = liveConfig.downloadRewardRechargeType ? liveConfig.downloadRewardRechargeType.value2 : undefined;
    if (record) {
        const matches = String(record.rechargeType) === String(liveType) && String(record.rechargeRequire) === String(liveRequire);
        console.log(`[${label}] 记录: rechargeType=${record.rechargeType}/rechargeRequire=${record.rechargeRequire}/state=${record.state} `
            + `| GetSetting当下配置: rechargeType=${liveType}/rechargeRequire=${liveRequire} | 两者一致=${matches}`);
    } else {
        console.log(`[${label}] 无记录；GetSetting当下配置: rechargeType=${liveType}/rechargeRequire=${liveRequire}`);
    }
    return record;
}

function runGroupJ_PendingRecordDefaultFields(adminToken) {
    console.log('========== J组：复现"待完成记录的充值类型/充值要求停留在从未被赋值的默认0/0" ==========');

    // J1：首充模式(1200)下，全新账号完全不充值——判定事件(充值订单完成/审核)永远不会
    // 发生，充值类型/充值要求应该永远停留在初始默认值0/0，跟"规则真的是无需充值"长得
    //一模一样，但state应该停在0(待完成)，不会被误发放。
    updateDownloadRewardSetting(adminToken, 'DownloadRewardRechargeType', '1', '1200');
    ensureDownloadRewardConfig(adminToken, {
        DownloadRewardRechargeType: '1',
        DownloadRewardDeviceLimit: '9', DownloadRewardIpLimit: '0', DownloadRewardFingerprintLimit: '9'
    }, 'J1准备-首充模式');
    sleep(3);
    const u1 = newAccount('J1-首充模式下从未充值(造永久待完成记录)', 2);
    if (u1) {
        sleep(3);
        const record1 = logRecordVsLiveConfig(adminToken, u1.userId, 'J1');
        reportCase('J1-首充模式下从未充值', u1.userId, u1.phone,
            '账号完全不充值，没有发生过"充值订单完成/审核"这个判定事件，应长期停留在待完成(state=0)——'
            + '这是预期行为；此时充值类型/充值要求字段会停留在从未被赋值的默认0/0，看起来像"无需充值"，'
            + '实际上账号全程都在首充模式下，只是这两个字段压根没机会被真正赋值',
            record1);
    } else {
        console.error('[J1] 账号创建失败，跳过');
    }

    // J2：对照组——无需充值模式下，"登录"本身就是判定事件，应该立刻正确写入0/0+state=1，
    // 证明"字段停在0"只发生在"从未发生过判定事件"的待完成记录上，不是无需充值模式本身
    // 没有发放。
    updateDownloadRewardSetting(adminToken, 'DownloadRewardRechargeType', '0');
    ensureDownloadRewardConfig(adminToken, { DownloadRewardRechargeType: '0' }, 'J2准备-无需充值(对照组)');
    sleep(3);
    const u2 = newAccount('J2-无需充值模式对照组', 2);
    if (u2) {
        sleep(3);
        const record2 = logRecordVsLiveConfig(adminToken, u2.userId, 'J2');
        reportCase('J2-无需充值模式对照组', u2.userId, u2.phone,
            '无需充值模式下"登录"本身就是判定事件，应立刻正确发放(state=1)，且充值类型/充值要求正确'
            + '等于0/0(因为规则真的是无需充值，不是因为字段没被赋值)——用来跟J1对照，证明问题只出现在'
            + '"从未发生过判定事件"的待完成记录上',
            record2);
    } else {
        console.error('[J2] 账号创建失败，跳过');
    }
}

// ============================================================
// 主流程
// ============================================================
export default function () {
    const adminToken = tenantAdminLogin(TENANT_ID, true);
    if (!adminToken) { console.error('后台登录失败'); return; }

    runGroupI_ConcurrentLogin(adminToken); // 放最前面，避开其它组消耗掉的限流窗口
    runGroupA_ClientTypeDetection(adminToken);
    runGroupB_CombinedClaimLimit(adminToken);
    runGroupC_RechargeRules(adminToken);
    runGroupD_DeviceIdLimit(adminToken);
    runGroupE_IpLimit(adminToken);
    runGroupF_FingerprintLimit(adminToken);
    runGroupG_SwitchToggle(adminToken); // 含多次sleep(60)等待开关生效，这一组本身比较耗时
    runGroupH_RegisterLoginCrossPath(adminToken);
    runGroupJ_PendingRecordDefaultFields(adminToken);

    console.log('========== 清理：恢复限流配置到初始观察值(设备9/IP0/指纹2) ==========');
    updateDownloadRewardSetting(adminToken, 'DownloadRewardDeviceLimit', '9');
    updateDownloadRewardSetting(adminToken, 'DownloadRewardIpLimit', '0');
    updateDownloadRewardSetting(adminToken, 'DownloadRewardFingerprintLimit', '2');

    console.log('\n========== 全部用例汇总(会员ID/账号/预期/实际) ==========');
    results.forEach(line => console.log(line));

    console.log('\n========== ⚠️ 安全问题汇总 ==========');
    console.log('安全问题1：clientType字段完全由客户端自报，后端零校验。配合"无需充值"模式，手动在/api/Home/Register'
        + '或/api/Home/Login的payload里传clientType:2(或1)，不需要真实APP/PWA环境即可触发下载奖励发放。见A组用例。');
    console.log('安全问题2：fingerprint字段是browserId的原样回显，没有真实浏览器指纹采集；随机化browserId即可绕过'
        + '浏览器指纹限流(F组验证的限流机制本身生效，但前提"指纹不可伪造"不成立)。见F组用例。');
    console.log('数据展示问题3(2026-11-11用户截图发现)：后台看到过10条"充值类型=无需充值但待完成"的记录，核实后'
        + '确认它们都是从未完成过任何已审核到账充值的账号，待完成是预期行为，不是无需充值模式没有自动发放。'
        + '真正原因：充值类型/充值要求这两个字段不是在记录创建时写入，而是在"充值订单完成/被审核"这个判定'
        + '事件发生时才被赋值——如果账号从头到尾都没有发生过这个事件，字段就会永远停留在从未被赋值的默认'
        + '0/0，跟"规则真的是无需充值"长得一模一样，造成误导。建议开发侧把"字段尚未赋值"和"字段确实等于0"'
        + '在展示上区分开(比如前者显示为空/--)。见J组用例。');
}
