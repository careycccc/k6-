// debug_success.js
import { group, check } from 'k6';
import { httpClient } from '../../../libs/http/client.js';
import { logger } from '../../../libs/utils/logger.js';

export function debug(data) {
  group('调试success属性', () => {
    try {
      console.log('=== 开始调试 ===');

      // 发送请求
      const response = httpClient.post('/api/Home/Login', data, {
        tags: { type: 'login' }
      });

      console.log('1. response类型:', typeof response);
      console.log('2. response值:', response);

      // 测试不同的属性访问方式
      console.log('3. 直接访问 response.success:', response.success);
      console.log('4. 可选链访问 response?.success:', response?.success);
      console.log('5. "success" in response:', 'success' in response);
      console.log('6. hasOwnProperty:', Object.prototype.hasOwnProperty.call(response, 'success'));
      console.log(
        '7. response.hasOwnProperty:',
        response.hasOwnProperty
          ? Object.prototype.hasOwnProperty.call(response, 'success')
          : '没有hasOwnProperty方法'
      );

      // 测试logger.info
      console.log('8. 尝试logger.info...');
      try {
        logger.info('测试日志:', {
          success: response.success,
          status: response.status
        });
        console.log('9. logger.info 成功');
      } catch (loggerError) {
        console.log('9. logger.info 失败:', loggerError.message);
        console.log('9. 错误堆栈:', loggerError.stack);
      }

      // 测试check函数
      console.log('10. 尝试k6 check函数...');
      try {
        const checkResult = check(response, {
          状态码200: (r) => {
            console.log('11. check函数内部访问r.success:', r.success);
            return r.status === 200;
          }
        });
        console.log('12. check结果:', checkResult);
      } catch (checkError) {
        console.log('12. check函数失败:', checkError.message);
        console.log('12. 错误堆栈:', checkError.stack);
      }

      console.log('=== 调试结束 ===');
    } catch (error) {
      console.log('整体错误:', error.message);
      console.log('错误堆栈:', error.stack);
    }
  });
}
