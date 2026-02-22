/**
 * 站内信创建功能测试脚本
 * 
 * 使用方法：
 * k6 run k6/tests/api/activity/inmail/test_createInmail.js
 * 
 * 或者带环境变量：
 * k6 run -e TOKEN=your-token-here \
 *        -e IMAGE_SRC=https://example.com/image.jpg \
 *        -e IMAGE_URL=/image.jpg \
 *        k6/tests/api/activity/inmail/test_createInmail.js
 */

import { createInmail, createInmailTag, inmailIds } from './createInmail.js';

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: {
        checks: ['rate>0.9']
    }
};

export function setup() {
    // 从环境变量获取参数，或使用默认值
    const token = __ENV.TOKEN || 'your-default-token-here';
    const imageSrc = __ENV.IMAGE_SRC || 'https://example.com/default-image.jpg';
    const imageUrl = __ENV.IMAGE_URL || '/default-image.jpg';

    console.log('='.repeat(60));
    console.log('站内信创建功能测试');
    console.log('='.repeat(60));
    console.log(`Token: ${token.substring(0, 20)}...`);
    console.log(`Image Src: ${imageSrc}`);
    console.log(`Image URL: ${imageUrl}`);
    console.log('='.repeat(60));

    return {
        token,
        uploadedSrc: [imageSrc],
        uploadedUrls: [imageUrl]
    };
}

export default function (data) {
    console.log('\n开始测试站内信创建功能...\n');

    // 调用创建函数
    const result = createInmail(data);

    // 输出结果
    console.log('\n' + '='.repeat(60));
    console.log('测试结果');
    console.log('='.repeat(60));
    console.log(`成功状态: ${result.success}`);
    console.log(`标签: ${result.tag}`);
    console.log(`消息: ${result.message}`);

    if (result.inmailIds && result.inmailIds.length > 0) {
        console.log(`创建的站内信数量: ${result.inmailIds.length}`);
        console.log(`站内信IDs (前5个): ${JSON.stringify(result.inmailIds.slice(0, 5))}`);
        if (result.inmailIds.length > 5) {
            console.log(`... 还有 ${result.inmailIds.length - 5} 条`);
        }
    }

    console.log('='.repeat(60));

    // 验证结果
    if (result.success) {
        console.log('✅ 测试通过：站内信创建成功');
        console.log(`   预期创建 19 条站内信（根据 jumpType 数量）`);
        console.log(`   实际创建 ${result.inmailIds ? result.inmailIds.length : 0} 条`);
    } else {
        console.log('⚠️  测试结果：站内信创建被跳过或失败');
        console.log(`   原因: ${result.message}`);
    }

    console.log('='.repeat(60) + '\n');

    return result;
}

export function teardown(data) {
    console.log('\n测试完成！');
    console.log(`最终收集的站内信ID数量: ${inmailIds.length}`);
    if (inmailIds.length > 0) {
        console.log(`站内信IDs (前5个): ${JSON.stringify(inmailIds.slice(0, 5))}`);
        if (inmailIds.length > 5) {
            console.log(`... 还有 ${inmailIds.length - 5} 条`);
        }
    }
}
