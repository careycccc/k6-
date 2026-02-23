import { AdminLogin } from '../login/adminlogin.test.js';
import { uploadSingleFile } from './uploadUtils.js';

export const uploadChampionFileTag = 'uploadChampionFile';

// 导出文件路径配置
export const FILE_CONFIG = {
    fileCount: 1,
    basePath: '../uploadFile/img/champion/',
    getFilePaths: () => {
        const paths = [];
        for (let i = 1; i <= FILE_CONFIG.fileCount; i++) {
            paths.push(`${FILE_CONFIG.basePath}${i}.png`);
        }
        return paths;
    }
};

/**
 * 封装的文件上传函数，用于champion活动
 * @returns {Object} 上传结果 { token, uploadedSrc, uploadedUrls, uploadResults }
 */
export function getUploadFileName() {
    try {
        console.log('开始上传图片...');
        const token = AdminLogin();

        if (!token) {
            console.error('AdminLogin 返回空值，登录失败');
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
        const uploadResults = [];

        for (const filePath of filePaths) {
            const result = uploadSingleFile(filePath, token);
            if (result.success) {
                uploadResults.push({
                    file: result.file,
                    src: result.src,
                    success: true
                });
                console.log(`✓ 文件 ${filePath.split('/').pop()} 上传成功`);
            } else {
                uploadResults.push({
                    file: filePath,
                    success: false,
                    error: result.error
                });
                console.log(`✗ 文件 ${filePath.split('/').pop()} 上传失败`);
            }
        }

        // 统计上传结果
        const successCount = uploadResults.filter(r => r.success).length;
        const failedCount = uploadResults.filter(r => !r.success).length;

        console.log('\n===== 上传完成 =====');
        console.log(`总计: ${uploadResults.length} 个文件`);
        console.log(`成功: ${successCount} 个`);
        console.log(`失败: ${failedCount} 个`);
        console.log('==================\n');

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
        const errorMsg = error && error.message ? error.message : String(error);
        console.error('Setup 发生异常:', errorMsg);
        throw error;
    }
}
