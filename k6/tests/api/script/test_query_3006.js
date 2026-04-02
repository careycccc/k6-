
import { AdminLogin } from '../login/adminlogin.test.js';
import { logger } from '../../../libs/utils/logger.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { sendQueryRequest } from '../common/request.js';

// ==================== setup：全局登录一次 ====================
export function setup() {
    try {
        // 固定使用3006租户
        const tenantId = '3006';
        logger.info(`[Setup] 目标租户: ${tenantId}`);

        // 切换到3006租户的环境配置
        const targetEnv = getEnvByTenantId(tenantId);

        if (targetEnv) {
            logger.info(`[Setup]   前台域名: ${targetEnv.BASE_DESK_URL}`);
            logger.info(`[Setup]   后台域名: ${targetEnv.BASE_ADMIN_URL}`);
            logger.info(`[Setup]   管理员账号: ${targetEnv.ADMIN_USERNAME}`);
            Object.assign(ENV_CONFIG, targetEnv);
        }

        const token = AdminLogin();
        if (!token) {
            throw new Error('AdminLogin 返回空 token');
        }

        logger.info('[Setup] ✅ 管理员登录成功');
        return { token, tenantId };
    } catch (error) {
        logger.error('登录失败:', error.message);
        throw error;
    }
}

// ==================== 测试查询 ====================
export default function (data) {
    const tenantId = data.tenantId;
    const token = data.token;

    // 重新切换环境配置
    const targetEnv = getEnvByTenantId(tenantId);
    if (targetEnv) {
        Object.assign(ENV_CONFIG, targetEnv);
    }

    logger.info(`========== 测试查询3006租户系统活动 ==========`);

    // 测试不同语言的查询
    const languages = ['bn', 'en', 'zh-CN'];

    languages.forEach(lang => {
        logger.info(`\n---------- 查询语言: ${lang} ----------`);

        const api = '/api/ActivityInformation/GetPageList';
        const payload = {
            pageNo: 1,
            pageSize: 50,
            activityType: 0,
            sysLanguage: lang,
            orderBy: "Desc"
        };

        logger.info(`查询参数: ${JSON.stringify(payload)}`);

        try {
            const result = sendQueryRequest(payload, api, 'test_query', false, token);

            logger.info(`响应类型: ${typeof result}`);

            if (result) {
                const resultStr = JSON.stringify(result);
                logger.info(`响应长度: ${resultStr.length}`);
                logger.info(`响应内容: ${resultStr.substring(0, 1000)}`);

                // 尝试解析
                let parsedResult = result;
                if (typeof result !== 'object') {
                    parsedResult = JSON.parse(result);
                }

                // 检查数据结构
                if (parsedResult) {
                    logger.info(`响应键: ${JSON.stringify(Object.keys(parsedResult))}`);

                    if (parsedResult.list) {
                        logger.info(`✅ 找到list字段，长度: ${parsedResult.list.length}`);
                        if (parsedResult.list.length > 0) {
                            logger.info(`第一条数据: ${JSON.stringify(parsedResult.list[0])}`);
                        }
                    } else if (parsedResult.data) {
                        logger.info(`找到data字段: ${JSON.stringify(parsedResult.data).substring(0, 200)}`);
                    } else {
                        logger.warn(`⚠️ 未找到list或data字段`);
                    }
                }
            } else {
                logger.error(`❌ 响应为空`);
            }
        } catch (error) {
            logger.error(`查询异常: ${error.message}`);
        }

        logger.info(`---------- 查询完成: ${lang} ----------\n`);
    });

    logger.info(`========== 测试完成 ==========`);
}
