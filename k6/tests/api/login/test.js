import { guestRegister } from "./register.test.js";

export const options = {
    scenarios: {
        guest_register: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '1m',
        },
    },
};

export default function () {
    const res = guestRegister({
        // packageName: 'com.ar3007.fb.app',
        packageName: 'com.ar3004.fb.app',
        inviteCode: '',
    });

    if (res) {
        console.log(`[GuestRegister] 游客注册成功: ${res.data.userId}`);
    }
}