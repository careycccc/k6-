/**
 * 临时一次性脚本：给指定账号发起一笔前台充值请求（不审核，故意留在未到账状态）
 * 用途：制造一条可在"Deposit history"里点 Submit Receipt 的订单，验证完就删除。
 */
import { generateCryptoRandomString, getTimeRandom } from '../../utils/utils.js';
import { testCommonRequest, sendRequest } from '../common/request.js';
import { goodsDepositRecharge } from './frontendRechargeApi.js';

export const options = { vus: 1, iterations: 1 };

const ACCOUNT = __ENV.ACCOUNT || '913117582761';

export default function () {
    let token = __ENV.TOKEN || '';
    if (!token) {
        const timeData = getTimeRandom();
        const data = {
            userName: ACCOUNT,
            password: 'qwer1234',
            loginType: 'Mobile',
            deviceId: '',
            browserId: generateCryptoRandomString(32),
            packageName: '',
            random: timeData.random,
            language: timeData.language,
            signature: '',
            timestamp: timeData.timestamp
        };
        token = testCommonRequest(data, '/api/Home/Login', 'oneshot_login');
        if (!token || typeof token !== 'string') {
            console.error(`[OneShot] 登录失败，拿不到 token: ${JSON.stringify(token)}`);
            return;
        }
        console.log(`[OneShot] 登录成功，账号=${ACCOUNT}`);
    } else {
        console.log(`[OneShot] 复用已登录 token（跳过登录，避免互踢浏览器 session）`);
    }

    const basic = sendRequest({}, '/api/Recharge/GetRechargeBasicInfo', 'GetRechargeBasicInfo', true, token);
    console.log(`[OneShot] GetRechargeBasicInfo: ${JSON.stringify(basic)}`);
    const goodsList = basic && Array.isArray(basic.goodsList) ? basic.goodsList : (basic && basic.data && basic.data.goodsList) || [];
    if (!goodsList.length) {
        console.error('[OneShot] 无商品盘面');
        return;
    }
    const goods = goodsList[0];
    const cats = (goods.supportCategories || []).filter(c => c.rechargeType !== 'ArUpi' && c.rechargeType !== 'ARPay');
    if (!cats.length) {
        console.error(`[OneShot] 商品 ${JSON.stringify(goods)} 无可用充值方式`);
        return;
    }
    const cat = cats[0];
    console.log(`[OneShot] 选用商品 amt=${goods.rechargeAmount} goodsId=${goods.id}，充值方式 ${cat.rechargeType}(id=${cat.id})`);
    const resp = goodsDepositRecharge(token, goods.id, cat.id);
    console.log(`[OneShot] GoodsDepositRecharge 响应: ${JSON.stringify(resp)}`);
}
