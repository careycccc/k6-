//import { RunDesklogin } from './k6/tests/api/login/desklogin.test.js';
import { handleSummary } from './k6/tests/api/common/request.js';
// import { AdminLogin } from './k6/tests/api/login/adminlogin.test.js';
import moreAddCoupon from './k6/tests/api/activity/coupon.test.js';
//import { redisClient } from './k6/tests/utils/redis.js';

export { handleSummary };
export default function () {
  // logger.info('redis的连接', redisClient);
  //RunDesklogin();
  //AdminLogin();
  moreAddCoupon();
}
