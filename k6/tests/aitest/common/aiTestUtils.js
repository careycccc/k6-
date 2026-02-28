import { logger } from '../../../libs/utils/logger.js';
import { ENV_CONFIG } from '../../../config/envconfig.js';
import { sendRequest } from '../../api/common/request.js';
import { AdminLogin } from '../../api/login/adminlogin.test.js';

/**
 * AI测试通用工具类
 * 
 * 重要说明：
 * 1. AI是嵌入在系统中的，需要先登录系统后才能使用
 * 2. 租户之间通过租户ID区分（从token中解析）
 * 3. 登录逻辑使用项目现有的 AdminLogin 方法
 */
export class AITestUtils {
    /**
     * 发送AI对话请求
     * @param {string} message - 用户输入的消息
     * @param {string} token - 认证token（登录后获取）
     * @param {object} options - 额外选项
     * @returns {object} 响应结果
     * 
     * 使用说明：
     * 1. 修改下面的 api 变量为实际的AI接口地址
     * 2. 根据实际接口调整 payload 结构
     * 3. token会自动携带，租户ID会从token中解析
     */
    static sendAIRequest(message, token, options = {}) {
        // ⚠️ 重要：修改为实际的AI接口地址
        // 例如: '/api/ai/chat', '/api/assistant/message', '/api/ai/conversation' 等
        const api = '/api/ai/chat';

        // 构建请求payload
        // 根据实际接口格式调整
        const payload = {
            message: message,
            sessionId: options.sessionId || `session_${Date.now()}`,
            ...options.extraParams
        };

        try {
            // 使用项目通用的sendRequest方法
            // 会自动处理：签名、时间戳、random、language等
            const result = sendRequest(
                payload,
                api,
                options.testName || 'ai_test',
                false,  // isDesk: false 表示后台接口
                token   // 传入登录token
            );

            return this.parseResponse(result);
        } catch (error) {
            logger.error('AI请求异常', error.message);
            return {
                success: false,
                error: error.message,
                response: null
            };
        }
    }

    /**
     * 解析响应
     * @param {object} result - sendRequest返回的结果
     * @returns {object} 解析后的结果
     */
    static parseResponse(result) {
        if (!result) {
            return {
                success: false,
                error: '响应为空',
                response: null
            };
        }

        // sendRequest已经返回解析后的结果
        // 格式通常为: { msgCode, msg, data }
        return {
            success: result.msgCode === 0,
            status: 200,  // sendRequest不返回HTTP状态码
            msgCode: result.msgCode,
            msg: result.msg,
            data: result.data,
            body: result
        };
    }

    /**
     * 登录获取token
     * 使用项目现有的登录方法
     * 
     * @param {string} username - 用户名（可选，默认使用配置文件中的管理员账号）
     * @param {string} password - 密码（可选）
     * @param {boolean} isAdmin - 是否管理员登录（默认true）
     * @returns {string} token
     */
    static login(username = null, password = null, isAdmin = true) {
        try {
            // 如果没有提供用户名密码，使用配置文件中的默认值
            if (!username) {
                username = ENV_CONFIG.ADMIN_USERNAME;
                password = ENV_CONFIG.ADMIN_PASSWORD;
            }

            logger.info(`尝试登录: ${username}`);

            // 使用项目现有的登录方法
            const token = AdminLogin();

            if (token) {
                logger.info(`登录成功: ${username}`);
                return token;
            } else {
                logger.error(`登录失败: ${username}`);
                return null;
            }
        } catch (error) {
            logger.error(`登录异常: ${username}`, error.message);
            return null;
        }
    }

    /**
     * 使用指定账号登录
     * @param {string} username - 用户名
     * @param {string} password - 密码
     * @returns {string} token
     */
    static loginWithCredentials(username, password) {
        const api = '/api/Login/Login';
        const payload = {
            userName: username,
            pwd: password
        };

        try {
            const result = sendRequest(
                payload,
                api,
                'login',
                false  // 后台登录
            );

            if (result && result.msgCode === 0 && result.data && result.data.token) {
                logger.info(`登录成功: ${username}`);
                return result.data.token;
            } else {
                logger.error(`登录失败: ${username}`, result?.msg);
                return null;
            }
        } catch (error) {
            logger.error(`登录异常: ${username}`, error.message);
            return null;
        }
    }

    /**
     * 检查响应是否包含特定内容
     */
    static checkResponseContains(result, keyword) {
        if (!result || !result.body) {
            return false;
        }

        const bodyStr = JSON.stringify(result.body).toLowerCase();
        return bodyStr.includes(keyword.toLowerCase());
    }

    /**
     * 检查响应是否为权限错误
     */
    static isPermissionDenied(result) {
        if (!result) return false;

        const permissionKeywords = [
            '无权限',
            '权限不足',
            'permission denied',
            'unauthorized',
            'forbidden',
            '暂无相关权限',
            '没有权限'
        ];

        const bodyStr = JSON.stringify(result.body || {}).toLowerCase();
        const hasKeyword = permissionKeywords.some(keyword => bodyStr.includes(keyword));

        // 检查msgCode（通常403相关的业务码表示无权限）
        const isPermissionCode = result.msgCode === 403 ||
            result.msgCode === 401 ||
            result.msgCode === 4003;

        return hasKeyword || isPermissionCode || !result.success;
    }

    /**
     * 生成测试报告
     */
    static generateTestReport(testName, results) {
        const total = results.length;
        const passed = results.filter(r => r.passed).length;
        const failed = total - passed;
        const passRate = total > 0 ? ((passed / total) * 100).toFixed(2) : 0;

        logger.info(`\n========== ${testName} 测试报告 ==========`);
        logger.info(`总用例数: ${total}`);
        logger.info(`通过: ${passed}`);
        logger.info(`失败: ${failed}`);
        logger.info(`通过率: ${passRate}%`);
        logger.info(`==========================================\n`);

        return {
            testName,
            total,
            passed,
            failed,
            passRate: parseFloat(passRate),
            results
        };
    }
}

export default AITestUtils;
