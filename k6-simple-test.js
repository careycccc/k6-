import crypto from 'k6/crypto';
import { signatureUtil } from './k6/libs/utils/signature.js';

export default function () {
    logger.info('🚀 开始签名比对测试');

    // 测试数据
    const testData = {
        "userName": "911208199708",
        "inviteCode": "5KWVU3W",
        "password": "qwer1234",
        "code": "141373",
        "loginType": "Mobile",
        "language": "en",
        "random": 472521829598,
        "signature": "",
        "timestamp": 1765171927
    };

    logger.info('\n📊 原始测试数据:');
    logger.info(JSON.stringify(testData, null, 2));

    // 方法1：使用修复后的签名工具
    const signature1 = signatureUtil.getSignature(testData, '');
    logger.info('\n🔍 方法1（修复后）计算出的签名:', signature1);
    logger.info('\n✅ 测试完成');
}
