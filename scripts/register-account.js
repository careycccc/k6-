#!/usr/bin/env node

/**
 * 独立账号注册脚本
 * 供 Go 服务通过子进程调用
 * 
 * 用法：
 *   node register-account.js --tenant=3002 --type=phone --count=1
 *   node register-account.js --tenant=3003 --type=email --count=2 --password=custom123
 */

import { registerAccountsForTenant } from '../k6/services/registerService.js';

// 解析命令行参数
function parseArgs() {
    const args = process.argv.slice(2);
    const params = {
        tenant: '3004',      // 默认租户
        type: 'phone',       // 默认手机号注册
        count: 1,            // 默认注册1个
        password: 'qwer1234' // 默认密码
    };

    args.forEach(arg => {
        const [key, value] = arg.replace('--', '').split('=');
        if (key && value) {
            if (key === 'count') {
                params[key] = parseInt(value, 10);
            } else {
                params[key] = value;
            }
        }
    });

    return params;
}

// 主函数
async function main() {
    try {
        const params = parseArgs();

        // 验证参数
        if (!['3001', '3002', '3003', '3004'].includes(params.tenant)) {
            throw new Error(`无效的租户ID: ${params.tenant}，必须是 3001/3002/3003/3004`);
        }

        if (!['phone', 'email'].includes(params.type)) {
            throw new Error(`无效的注册类型: ${params.type}，必须是 phone 或 email`);
        }

        if (params.count < 1 || params.count > 10) {
            throw new Error(`无效的注册数量: ${params.count}，必须在 1-10 之间`);
        }

        // 执行注册
        const accounts = registerAccountsForTenant(
            params.tenant,
            params.type,
            params.count,
            params.password
        );

        // 输出 JSON 结果到 stdout（Go 服务会读取这个输出）
        const result = {
            success: true,
            count: accounts.length,
            accounts: accounts,
            tenant: params.tenant,
            type: params.type
        };

        console.log('__RESULT_START__');
        console.log(JSON.stringify(result, null, 2));
        console.log('__RESULT_END__');

        process.exit(0);

    } catch (error) {
        // 输出错误信息
        const errorResult = {
            success: false,
            error: error.message,
            stack: error.stack
        };

        console.error('__ERROR_START__');
        console.error(JSON.stringify(errorResult, null, 2));
        console.error('__ERROR_END__');

        process.exit(1);
    }
}

// 运行主函数
main();
