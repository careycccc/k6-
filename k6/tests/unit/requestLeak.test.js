/**
 * sendRequest 状态泄漏回归测试（真实请求，只读）
 *   k6 run -e TENANT_ID=3101 -e TENANT=3101 -e ACCOUNT=919028199762 k6/tests/unit/requestLeak.test.js
 */
import { sendRequest } from '../api/common/request.js';
import { adminLogin, loginByPassword } from '../api/common/auth.js';

export const options = { vus: 1, iterations: 1 };
export default function () {
    const admin = adminLogin(__ENV.TENANT_ID);
    const ok = sendRequest({ pageNo: 1, pageSize: 1, orderBy: 'Desc' }, '/api/Users/GetPageList', 'Leak', false, admin);
    const bad = sendRequest({}, '/api/NoSuchController/NoSuchAction', 'Leak', false, admin);
    console.log(`RESULT 1) 正常查询拿到数据=${!!(ok && ok.list)} | 随后请求不存在接口返回=${JSON.stringify(bad && bad.list ? '上一个请求的数据(泄漏!)' : bad)}`);

    const user = loginByPassword(__ENV.ACCOUNT);
    const me = sendRequest({}, '/api/User/GetUserInfo', 'Leak', true, user);
    const anon = sendRequest({}, '/api/User/GetUserInfo', 'Leak', true, '');
    const leaked = anon && anon.userId === (me && me.userId);
    console.log(`RESULT 2) 带token查到 userId=${me && me.userId} | 不带token ${leaked ? '仍查到同一人(泄漏!)' : '未拿到用户信息(正确)'} 返回=${JSON.stringify(anon).slice(0, 120)}`);
}
