import http from 'k6/http';
import { check } from 'k6';
import { AdminLogin, adminTag } from '../login/adminlogin.test.js';
import { ENV_CONFIG } from '../../../config/envconfig.js';

export const uploadInmailFileTag = 'uploadInmailFile';

// 导出文件路径配置
export const FILE_CONFIG = {
    fileCount: 1,
    basePath: './img/inmail/',
    getFilePaths: () => {
        const paths = [];
        for (let i = 1; i <= FILE_CONFIG.fileCount; i++) {
            paths.push(`${FILE_CONFIG.basePath}${i}.png`);
        }
        return paths;
    }
};

// 在模块顶层定义fileContents并预加载所有文件
const fileContents = {};
const filePaths = FILE_CONFIG.getFilePaths();
for (const filePath of filePaths) {
    fileContents[filePath] = open(filePath, 'b');
}


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

    for (const filePath of filePaths) {
        const res = uploadFile(filePath, token);
        const data = JSON.parse(res.body);
        //logger.info('上传响应数据:', data);
        if (res.status === 200 && data.data && data.data.length > 0) {
            // 假设返回的JSON结构中包含url字段，根据实际API响应调整
            const url = res.json('url');
            results.push({
                file: data.data[0].title,
                src: data.data[0].src,
                success: true
            });
        } else {
            results.push({
                file: filePath,
                success: false,
                error: res.status
            });
        }
    }

    return results;
}

/*
封装一个文件上传的函数,只需要调用
return {
    token,
    uploadedUrls,
    uploadResults
};
**/
export function getUploadFileName() {
    try {
        const token = AdminLogin();

        if (!token) {
            logger.error('AdminLogin 返回空值，登录失败');
            throw new Error('AdminLogin 返回空 token');
        }

        // 定义要上传的文件列表
        const filePaths = FILE_CONFIG.getFilePaths();
        // 批量上传文件
        const uploadResults = uploadAllFiles(filePaths, token);

        //logger.info('文件上传结果:', uploadResults);

        // 检查是否所有文件都上传成功
        const failedUploads = uploadResults.filter(r => !r.success);
        if (failedUploads.length > 0) {
            logger.error('部分文件上传失败:', failedUploads);
            throw new Error(`${failedUploads.length}个文件上传失败`);
        }

        // 提取所有URL
        const uploadedUrls = uploadResults.map(r => r.file);
        const uploadedSrc = uploadResults.map(r => r.src);

        return {
            token,
            uploadedUrls,  // 返回上传成功后的文件路径表
            uploadedSrc,
            uploadResults
        };
    } catch (error) {
        logger.error('Setup 发生异常:', error.message);
        throw error;
    }
}

