/**
 * 直接测试3002后台登录
 */

import http from 'k6/http';
import { SignedHttpClient } from '../k6/libs/utils/signature.js';
import { getTimeRandom } from '../k6/tests/utils/utils.js';

export const options = {
    vus: 1,
    iterations: 1
};

export default function () {
    const url = 'https://arsitasdfghjklg.com/api/Login/Login';

    const timeData = getTimeRandom();
    const payload = {
        userName: 'carey3002',
        pwd: 'qwer1234',
        random: timeData.random,
        language: timeData.language,
        timestamp: timeData.timestamp
    };

    // 生成签名
    const signClient = new SignedHttpClient();
    const signedData = signClient.signData(payload);

    console.log('请求URL:', url);
    console.log('请求payload:', JSON.stringify(signedData));

    const response = http.post(url, JSON.stringify(signedData), {
        headers: {
            'Content-Type': 'application/json',
            'Domainurl': 'https://arsitasdfghjklg.com',
            'Referrer': 'https://arsitasdfghjklg.com'
        }
    });

    console.log('响应状态:', response.status);
    //console.log('响应体:', response.body);

    if (response.body) {
        const result = JSON.parse(response.body);
        console.log('msgCode:', result.msgCode);
        console.log('msg:', result.msg);
        if (result.data && result.data.token) {
            console.log('✅ 登录成功，token:', result.data.token.substring(0, 20) + '...');
        }
    }
}
