import http from 'k6/http';
import { check } from 'k6';
import { AdminLogin } from '../login/adminlogin.test.js';
import { ENV_CONFIG } from '../../../config/envconfig.js';

/**
 * 上传单个文件的底层函数
 * @param {*} fileContent 文件内容（二进制）
 * @param {string} fileName 文件名
 * @param {string} token 认证token
 * @returns {Object} 上传响应
 */
function uploadFileRequest(fileContent, fileName, token) {
    // 构建表单数据
    const formData = {
        files: http.file(fileContent, fileName, 'image/png'),
        fileType: 'other',
        customPath: '',
    };

    const headerUrl = ENV_CONFIG.BASE_ADMIN_URL;
    const host = headerUrl.replace(/^(https?:\/\/)?([^:\/\s]+).*$/, '$2');

    // 设置请求头
    const params = {
        headers: {
            'Host': `${host}`,
            'ignorecanceltoken': 'true',
            'referer': `${headerUrl}/`,
            'sec-ch-ua-mobile': '?0',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
            'accept': 'application/json, text/plain, */*',
            'origin': `${headerUrl}/`,
            'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
            'accept-language': 'zh-CN,zh;q=0.9',
            'authorization': `Bearer ${token}`,
            'sec-fetch-dest': 'empty',
            'sec-fetch-site': 'same-origin',
            'accept-encoding': 'gzip, deflate, br, zstd',
            'priority': 'u=1, i',
            'domainurl': `${headerUrl}/`,
            'sec-fetch-mode': 'cors',
            'sec-ch-ua-platform': '"Windows"',
        },
    };

    // 发送POST请求
    const res = http.post(`${ENV_CONFIG.BASE_ADMIN_URL}/api/UploadFile/UploadToOss`, formData, params);

    // 检查响应
    check(res, {
        'status is 200': (r) => r.status === 200,
    });

    return res;
}

/**
 * 通用的单文件上传函数
 * @param {string} filePath 文件路径（相对于script目录，例如：'../uploadFile/img/champion/1.png'）
 * @param {string} token 可选的token，如果不提供则自动登录
 * @returns {Object} 上传结果 { success, src, file, error }
 * 
 * 返回格式说明：
 * - success: true/false 表示上传是否成功
 * - src: 完整的图片URL（包含域名）
 * - file: 文件相对路径
 * - error: 错误信息（如果失败）
 * 
 * 使用示例：
 * ```javascript
 * import { uploadSingleFile } from '../../uploadFile/uploadUtils.js';
 * 
 * const result = uploadSingleFile('../uploadFile/img/champion/1.png', token);
 * if (result.success) {
 *     console.log('上传成功:', result.src);
 * } else {
 *     console.error('上传失败:', result.error);
 * }
 * ```
 */
export function uploadSingleFile(filePath, token = null) {
    try {
        // 如果没有提供token，则自动登录
        if (!token) {
            token = AdminLogin();
            if (!token) {
                return {
                    success: false,
                    error: 'Login failed, no token'
                };
            }
        }

        // 读取文件内容
        let fileContent;
        try {
            fileContent = open(filePath, 'b');
        } catch (e) {
            return {
                success: false,
                error: `File not found: ${filePath}`
            };
        }

        // 提取文件名
        const fileName = filePath.split('/').pop();

        // 上传文件
        const res = uploadFileRequest(fileContent, fileName, token);

        if (!res || !res.body) {
            return {
                success: false,
                error: 'No response or empty body'
            };
        }

        // 解析响应
        let data;
        try {
            data = JSON.parse(res.body);
        } catch (parseError) {
            return {
                success: false,
                error: 'JSON parse error',
                response: res.body
            };
        }

        // 检查上传是否成功
        if (res.status === 200 && data.code === 0 && data.data && data.data.length > 0) {
            return {
                success: true,
                src: data.data[0].src,      // 完整URL
                file: data.data[0].title    // 文件路径
            };
        } else {
            return {
                success: false,
                error: res.status,
                businessError: {
                    code: data.code,
                    msg: data.msg
                }
            };
        }
    } catch (error) {
        const errorMsg = error && error.message ? error.message : String(error);
        return {
            success: false,
            error: 'Upload exception',
            message: errorMsg
        };
    }
}

/**
 * 批量上传文件
 * @param {Array<string>} filePaths 文件路径数组
 * @param {string} token 可选的token
 * @returns {Array} 上传结果数组
 */
export function uploadMultipleFiles(filePaths, token = null) {
    // 如果没有提供token，则自动登录
    if (!token) {
        token = AdminLogin();
        if (!token) {
            throw new Error('Login failed, no token');
        }
    }

    const results = [];

    for (const filePath of filePaths) {
        const result = uploadSingleFile(filePath, token);
        results.push(result);

        if (result.success) {
            console.log(`✓ 文件 ${filePath.split('/').pop()} 上传成功`);
        } else {
            console.log(`✗ 文件 ${filePath.split('/').pop()} 上传失败`);
        }
    }

    return results;
}
