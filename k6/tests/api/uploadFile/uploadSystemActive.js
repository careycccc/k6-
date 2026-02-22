import http from 'k6/http';
import { check, sleep } from 'k6';
import { AdminLogin, adminTag } from '../login/adminlogin.test.js';
import { ENV_CONFIG } from '../../../config/envconfig.js';
import { systemJumpType } from '../common/type.js'
import logger from '../../../libs/utils/logger.js';

export const uploadInmailFileTag = 'uploadInmailFile';

// 导出文件路径配置
export const FILE_CONFIG = {
    fileCount: systemJumpType.length,
    basePath: '../uploadFile/img/systemActive/',
    getFilePaths: () => {
        const paths = [];
        systemJumpType.forEach(item => {
            const filePath = `${FILE_CONFIG.basePath}${item.pageType}.png`;
            paths.push(filePath);
        });
        return paths;
    }
};

// 在模块顶层定义fileContents并预加载所有文件
// 在模块顶层定义fileContents并预加载所有文件
const fileContents = {};
const filePaths = FILE_CONFIG.getFilePaths();

for (const filePath of filePaths) {
    try {
        // 检查文件是否存在
        const file = open(filePath, 'b');
        fileContents[filePath] = file;
        logger.info(`✓ 成功加载文件: ${filePath.split('/').pop()}`);
    } catch (error) {
        // 安全地获取错误信息
        let errorMessage = '未知错误';
        if (error instanceof Error) {
            errorMessage = error.message;
        } else if (typeof error === 'object') {
            errorMessage = JSON.stringify(error);
        } else if (typeof error === 'string') {
            errorMessage = error;
        } else {
            errorMessage = String(error);
        }

        logger.error(`✗ 加载文件失败: ${filePath},错误信息: ${errorMessage}`);
        // 继续加载其他文件，不中断整个流程
        fileContents[filePath] = null;
    }
}

logger.info(`文件加载完成: 成功 ${Object.values(fileContents).filter(f => f !== null).length}/${filePaths.length}`);



export function uploadFile(filePath, token) {
    //logger.info('上传文件:', filePath);

    // 从预加载的内容中获取文件数据
    const fileContent = fileContents[filePath];
    if (!fileContent) {
        logger.error('文件未预加载:', filePath);
        return {
            status: 404,
            error: 'File not found in preloaded contents'
        };
    }

    // 构建表单数据
    const formData = {
        files: http.file(fileContent, filePath.split('/').pop(), 'image/png'),
        fileType: 'other',
        customPath: '',
    };

    const headerUrl = ENV_CONFIG.BASE_ADMIN_URL;
    // 从URL中提取主机名：移除协议前缀(http://或https://)和端口
    const host = headerUrl.replace(/^(https?:\/\/)?([^:\/\s]+).*$/, '$2');

    // 设置请求头（基于抓包数据）
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
        // 添加以下配置强制使用HTTP/1.1
        //http2: false,
    };

    // 发送POST请求
    const res = http.post(`${ENV_CONFIG.BASE_ADMIN_URL}/api/UploadFile/UploadToOss`, formData, params);

    // 检查响应
    check(res, {
        'status is 200': (r) => r.status === 200,
    });
    return res;
}


// 批量上传文件并返回所有URL
export function uploadAllFiles(filePaths, token) {
    const results = [];
    const totalFiles = filePaths.length;
    let currentFile = 0;

    for (const filePath of filePaths) {
        currentFile++;
        const progress = Math.round((currentFile / totalFiles) * 100);

        // 显示上传进度
        console.log(`[${currentFile}/${totalFiles}] 正在上传: ${filePath.split('/').pop()} (${progress}%)`);

        try {
            sleep(.5);
            const res = uploadFile(filePath, token);

            // 检查响应是否存在
            if (!res || !res.body) {
                logger.error(`✗ 文件 ${filePath} 上传失败: 无响应或响应体为空`);
                results.push({
                    file: filePath,
                    success: false,
                    error: 'No response or empty body'
                });
                continue;
            }

            // 解析响应
            let data;
            try {
                data = JSON.parse(res.body);
            } catch (parseError) {
                logger.error(`✗ 文件 ${filePath} 响应解析失败:`, parseError.message);
                results.push({
                    file: filePath,
                    success: false,
                    error: 'JSON parse error',
                    response: res.body
                });
                continue;
            }

            // 检查上传是否成功
            if (res.status === 200 && data.code === 0 && data.data && data.data.length > 0) {
                console.log(`✓ 文件 ${filePath.split('/').pop()} 上传成功`);
                results.push({
                    file: data.data[0].title,
                    src: data.data[0].src,
                    success: true
                });
            } else {
                logger.error(`✗ 文件 ${filePath} 上传失败:`, {
                    status: res.status,
                    code: data.code,
                    msg: data.msg
                });
                results.push({
                    file: filePath,
                    success: false,
                    error: res.status,
                    businessError: {
                        code: data.code,
                        msg: data.msg
                    }
                });
            }
        } catch (error) {
            logger.error(`✗ 文件 ${filePath} 上传异常:`, error.message);
            results.push({
                file: filePath,
                success: false,
                error: 'Upload exception',
                message: error.message
            });
        }
    }

    return results;
}


/** 
封装一个文件上传的函数,只需要调用
@returns {
    token,
    uploadedUrls, 只有文件一个相对路径，如：/img/inmail/1.png
    uploadedSrc,  全地址包括域名和文件
    uploadResults
};
**/
export function getUploadFileName() {
    try {
        console.log('开始上传图片...');
        const token = AdminLogin();

        if (!token) {
            logger.error('AdminLogin 返回空值，登录失败')
            throw new Error('AdminLogin 返回空 token');
        }

        // 定义要上传的文件列表
        const filePaths = FILE_CONFIG.getFilePaths();
        if (!filePaths || filePaths.length === 0) {
            console.error('没有要上传的文件');
            throw new Error('No files to upload');
        }

        console.log(`准备上传 ${filePaths.length} 个文件`);

        // 批量上传文件
        const uploadResults = uploadAllFiles(filePaths, token);

        // 统计上传结果
        const successCount = uploadResults.filter(r => r.success).length;
        const failedCount = uploadResults.filter(r => !r.success).length;

        console.log('\n===== 上传完成 =====');
        console.log(`总计: ${uploadResults.length} 个文件`);
        console.log(`成功: ${successCount} 个`);
        console.log(`失败: ${failedCount} 个`);
        console.log('==================\n');

        logger.info('文件上传结果:', uploadResults);

        // 提取所有URL（只包含成功的）
        const uploadedUrls = uploadResults
            .filter(r => r.success)
            .map(r => r.file);

        const uploadedSrc = uploadResults
            .filter(r => r.success)
            .map(r => r.src);

        return {
            token,
            uploadedUrls,
            uploadedSrc,
            uploadResults
        };
    } catch (error) {
        logger.error('Setup 发生异常:', error.message);
        throw error;
    }
}



