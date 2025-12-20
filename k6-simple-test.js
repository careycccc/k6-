import crypto from 'k6/crypto';
import { signatureUtil } from './k6/libs/utils/signature.js';

export default function() {
    console.log('🚀 开始签名比对测试');
    
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
    
    console.log('\n📊 原始测试数据:');
    console.log(JSON.stringify(testData, null, 2));
    
    // 方法1：使用修复后的签名工具
    const signature1 = signatureUtil.getSignature(testData, '');
    console.log('\n🔍 方法1（修复后）计算出的签名:', signature1);
    console.log('\n✅ 测试完成');
}
