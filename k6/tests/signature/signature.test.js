/**
 * 签名生成器 —— 给定一个 JSON，输出可直接用于抓包软件的 signature 和完整请求体
 *
 * 用法：
 *   1. 把要签名的 JSON 填到下面的 testData 里
 *   2. 运行：k6 run k6/tests/signature/signature.test.js
 *   3. 控制台会打印：刷新后的 timestamp、计算出的 signature、以及可直接复制的完整请求体
 *
 * 说明：
 *   - 签名算法与真实后端一致（libs/utils/signature.js 的 SignatureUtil）：
 *       过滤 signature/timestamp/track 及空值字段 → 按 key 字典序排序 → JSON.stringify → 拼接密钥 → MD5 大写
 *   - 签名密钥默认空字符串（与 tenantRequest 的真实请求一致），可用 -e SIGNATURE_SECRET=xxx 覆盖
 *   - timestamp 不参与签名，脚本会自动刷新为当前执行时间（秒级）
 *   - random 参与签名，脚本每次运行会自动刷新为新的 12 位随机数（与后端一致）
 */

import crypto from 'k6/crypto';
import { SignatureUtil } from '../../libs/utils/signature.js';
import { randomTwelveK6 } from '../utils/utils.js';

export const options = {
  vus: 1,
  iterations: 1
};

// ==================== 在这里填入要签名的 JSON ====================
const testData = {
  "walletId": "1789965624523002004",
  "withdrawCategoryId": 500058,
  "withdrawType": "USDT",
  "withdrawPassword": "123456",
  "amount": 2000000000000000000,
  "language": "en",
  "random": 300062397614,
  "signature": "7811BA73B373FDD104E00DBCC2465625",
  "timestamp": 1789967268
};

// 签名密钥：真实后端使用空字符串；如需覆盖用 -e SIGNATURE_SECRET=xxx
const VERIFY_PWD = __ENV.SIGNATURE_SECRET || '';

export default function () {
  // 1. 刷新 timestamp 为当前执行时间（秒级），random 刷新为新的 12 位随机数（均与后端一致）
  const nowSec = Math.floor(Date.now() / 1000);
  const newRandom = randomTwelveK6();
  const payload = { ...testData, random: newRandom, timestamp: nowSec };

  // 2. 还原「待签名字符串」用于对照（过滤 + 排序 + JSON.stringify）
  const filtered = SignatureUtil.filterObject(payload);
  const sorted = SignatureUtil.sortObject(filtered);
  const rawString = JSON.stringify(sorted);

  // 3. 计算签名（拼接密钥 → MD5 大写）
  const signature = crypto.md5(rawString + VERIFY_PWD, 'hex').toUpperCase();
  payload.signature = signature;

  // 4. 输出结果
  console.log('==================== 签名结果 ====================');
  console.log('random    : ' + newRandom);
  console.log('timestamp : ' + nowSec);
  console.log('signature : ' + signature);
  console.log('密钥       : ' + (VERIFY_PWD === '' ? '(空)' : VERIFY_PWD));
  console.log('--------------------------------------------------');
  console.log('待签名字符串（参与签名的字段）:');
  console.log(rawString);
  console.log('--------------------------------------------------');
  console.log('完整请求体（可直接复制到抓包软件）:');
  console.log(JSON.stringify(payload));
  console.log('==================================================');
}
