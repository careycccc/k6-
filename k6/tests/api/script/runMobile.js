import { MobileAutoLogin } from '../login/MobileAutoLogin.test.js';

export function setup() {
    const userName = '911020199711';
    const verifyCode = '583166';
    const token = MobileAutoLogin(userName, verifyCode)
    console.log('token--', token)
    return token
}



export const options = {
    discardResponseBodies: true,
    scenarios: {
        my_scenario: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1, // 只运行一次
            maxDuration: '5s'
        },
    },
};

export default function () {
}