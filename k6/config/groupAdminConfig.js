// ============================================
// 集团后台配置 - 跨租户数据汇总后台
// ============================================
//
// 背景：
//   envconfig.js 里的 3001~3007 属于测试环境，3101 属于预发布(UAT)环境，
//   这些都是"单租户"后台(每个租户各自的业务管理后台)。
//
//   集团后台是另一套独立系统，按"测试/预发布"两个环境各一套，分别汇总
//   收集旗下多个租户的数据：
//     - 测试环境集团后台：收集 3001~3007 这些测试租户的数据
//     - 预发布环境集团后台：收集 3101 这个UAT租户的数据
//
//   2026-10-24 第一次整理进项目，目前只记录登录凭据/覆盖范围，还没有
//   写任何请求封装——集团后台的API协议、域名解析方式是否能直接复用
//   envconfig.js 那套 tenantRequest/getBaseUrl 机制，未经验证，不能假设
//   和现有租户后台一致，等真的要写集团后台相关脚本时再确认。
//
// GOOGLE_SECRET 用途同 envconfig.js：TOTP(RFC6238) 密钥，配合
//   k6/libs/http/tenantRequest.js 的 totpVCode() 可以算出6位验证码。
//   2026-10-24 两套配置均已实测登录成功(直接调用 GROUP_ADMIN_TEST/UAT 对应
//   账号+totpVCode算出的vCode打 /api/Login/Login，返回 code=0 拿到真实
//   token，GroupCode 分别是 G1002/G001)。
//   ⚠️ GROUP_ADMIN_TEST 的 GOOGLE_SECRET 里有一个字符"4"，不属于标准
//   Base32 字符集(A-Z+2-7)——一开始怀疑是抄录笔误，但实测证明密钥本身
//   没问题：项目的 base32Decode() 对不认识的字符是静默跳过
//   (`if (idx < 0) continue`)，不会报错也不会中断解码，"4"被自动忽略，
//   不影响算出来的验证码。记录这一点是提醒：以后遇到"密钥里有不像
//   Base32的字符"，不代表密钥一定错，不能只凭字符集判断，要实际登录验证。
// ============================================

// 测试环境集团后台（收集 3001~3007 数据）
export const GROUP_ADMIN_TEST = {
    NAME: "测试环境集团后台",
    BASE_URL: "https://g1002.mggametransit.com/",
    ADMIN_USERNAME: "carey_jt_admin",
    ADMIN_PASSWORD: "qwer1234",
    GOOGLE_SECRET: "GEYDAMJQGAYDEMJWGM4TEOBUGQYTONJQGMYTCMJQGUYDEMTJMQ", // 含非标准字符"4"但实测有效，见文件头注释
    COVERS_TENANT_IDS: [3001, 3002, 3003, 3004, 3005, 3006, 3007]
};

// 预发布(UAT)环境集团后台（收集 3101 数据）
export const GROUP_ADMIN_UAT = {
    NAME: "预发布环境集团后台",
    BASE_URL: "https://uatgroup-manger.arplatsaasuat.com/",
    ADMIN_USERNAME: "carey_uat_jt_admin",
    ADMIN_PASSWORD: "qwer1234",
    GOOGLE_SECRET: "GY3DGOJSHA2DIMJZGEYTEMBUGIZTSNTKMZTXS",
    COVERS_TENANT_IDS: [3101]
};

// 全部集团后台列表，供需要遍历"所有集团后台"的场景使用
export const GROUP_ADMIN_LIST = [GROUP_ADMIN_TEST, GROUP_ADMIN_UAT];

/**
 * 根据租户ID找到负责汇总它数据的集团后台配置。
 * @param {string|number} tenantId
 * @returns {object|null} 对应的 GROUP_ADMIN_* 配置对象，找不到归属时返回 null
 */
export function getGroupAdminByTenantId(tenantId) {
    const id = Number(tenantId);
    return GROUP_ADMIN_LIST.find(g => g.COVERS_TENANT_IDS.includes(id)) || null;
}
