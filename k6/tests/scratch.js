import { tenantAdminLogin } from '../libs/http/tenantRequest.js';
import { fetchAllRechargeOrders } from './api/retention/rechargeRetentionApi.js';

export const options = { vus: 1, iterations: 1 };

export default function() {
    const adminToken = tenantAdminLogin('3004');
    const orders = fetchAllRechargeOrders(adminToken, Date.now() - 86400*1000*30, Date.now(), 'Payed', 100051);
    console.log(JSON.stringify(orders[0], null, 2));
}
