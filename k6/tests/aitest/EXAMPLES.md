# AI安全测试 - 使用示例

本文档提供实际使用场景的示例。

## 示例1: 首次使用

### 场景
你刚拿到这套测试脚本，想要快速验证是否能正常运行。

### 步骤

1. **检查k6是否安装**
```bash
k6 version
# 如果未安装，参考 QUICKSTART.md 安装
```

2. **修改AI接口地址**
```bash
# 编辑工具类文件
vim k6/tests/aitest/common/aiTestUtils.js

# 找到第13行，修改为实际接口
const api = '/api/ai/chat';  # 改为你的实际接口
```

3. **确认账号配置**
```bash
# 查看当前配置
cat k6/config/envconfig.js | grep -A 5 "export const ENV_CONFIG"

# 确认以下配置正确：
# - ADMIN_USERNAME
# - ADMIN_PASSWORD
# - TENANTID
```

4. **运行最简单的测试**
```bash
# 先运行接口安全测试（最基础）
./k6/tests/aitest/run-api-security.sh
```

5. **查看结果**
```bash
# 控制台会显示测试结果
# 如果看到 ✓ 表示通过
# 如果看到 ✗ 表示失败，需要检查配置
```

## 示例2: 完整安全测试

### 场景
你需要对AI系统进行完整的安全测试，生成测试报告。

### 步骤

1. **确保配置正确**
```bash
# 检查AI接口地址
grep "const api" k6/tests/aitest/common/aiTestUtils.js

# 检查账号配置
grep "ADMIN_USERNAME\|ADMIN_PASSWORD" k6/config/envconfig.js
```

2. **运行完整测试套件**
```bash
./k6/tests/aitest/run-all.sh
```

3. **等待测试完成**
```
预计耗时: 8-10分钟
测试内容:
- 接口安全测试 (10个用例)
- 数据隔离测试 (7个用例)
- 服务器探测测试 (5个用例)
- 输入验证测试 (5个用例)
```

4. **查看HTML报告**
```bash
# 报告保存在 reports/ 目录
ls -lt reports/ | head -5

# 打开最新的报告
open reports/ai-security-test-*.html
```

5. **分析结果**
```
查看报告中的：
- 通过率
- 失败的测试用例
- 响应时间统计
- 错误详情
```

## 示例3: 针对性测试

### 场景
你只想测试数据隔离功能，不需要运行所有测试。

### 步骤

1. **运行数据隔离测试**
```bash
./k6/tests/aitest/run-data-isolation.sh
```

2. **查看测试输出**
```
[TENANT-001] 测试: 跨租户数据查询隔离
  ✓ 数据查询正确隔离，仅返回当前租户数据

[TENANT-002] 测试: 伪造租户ID进行跨租户访问
  ✓ 系统正确忽略伪造的租户ID

...
```

3. **如果测试失败**
```bash
# 查看详细日志
k6 run k6/tests/aitest/2-data-isolation/data-isolation.test.js --verbose

# 或者修改测试文件，添加更多日志
vim k6/tests/aitest/2-data-isolation/data-isolation.test.js
```

## 示例4: 调试单个测试用例

### 场景
某个测试用例一直失败，你需要调试它。

### 步骤

1. **找到测试文件**
```bash
# 假设 API-006 SQL注入测试失败
vim k6/tests/aitest/1-api-security/api-security.test.js
```

2. **注释掉其他测试**
```javascript
export default function() {
    // 注释掉其他测试
    // results.push(testAPI001_UnauthorizedAccess());
    // results.push(testAPI002_TokenForgery(validToken));
    
    // 只运行需要调试的测试
    results.push(testAPI006_SQLInjection(validToken));
    
    // 注释掉其他测试
    // results.push(testAPI007_XSSInjection(validToken));
}
```

3. **添加详细日志**
```javascript
function testAPI006_SQLInjection(token) {
    logger.info('[API-006] 测试: SQL注入');
    
    for (const payload of sqlPayloads) {
        logger.info(`测试payload: ${payload}`);
        
        const result = AITestUtils.sendAIRequest(
            `查询用户信息: ${payload}`,
            token,
            { testName: 'api006_sql_injection' }
        );
        
        // 添加详细日志
        logger.info(`响应状态: ${result.status}`);
        logger.info(`响应内容: ${JSON.stringify(result.body)}`);
        
        // ... 其余代码
    }
}
```

4. **运行测试**
```bash
k6 run k6/tests/aitest/1-api-security/api-security.test.js
```

5. **分析输出**
```
查看日志中的：
- 请求参数
- 响应状态码
- 响应内容
- 失败原因
```

## 示例5: 集成到CI/CD

### 场景
你想把安全测试集成到CI/CD流程中。

### GitHub Actions 示例

创建 `.github/workflows/ai-security-test.yml`:

```yaml
name: AI Security Test

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]
  schedule:
    - cron: '0 2 * * *'  # 每天凌晨2点运行

jobs:
  security-test:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v2
    
    - name: Install k6
      run: |
        sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
        echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
        sudo apt-get update
        sudo apt-get install k6
    
    - name: Run AI Security Tests
      run: |
        chmod +x k6/tests/aitest/*.sh
        ./k6/tests/aitest/run-all.sh
      env:
        AI_API_URL: ${{ secrets.AI_API_URL }}
        ADMIN_USERNAME: ${{ secrets.ADMIN_USERNAME }}
        ADMIN_PASSWORD: ${{ secrets.ADMIN_PASSWORD }}
    
    - name: Upload Test Report
      uses: actions/upload-artifact@v2
      if: always()
      with:
        name: security-test-report
        path: reports/
```

### GitLab CI 示例

创建 `.gitlab-ci.yml`:

```yaml
stages:
  - test

ai-security-test:
  stage: test
  image: loadimpact/k6:latest
  script:
    - chmod +x k6/tests/aitest/*.sh
    - ./k6/tests/aitest/run-all.sh
  artifacts:
    when: always
    paths:
      - reports/
    expire_in: 30 days
  only:
    - main
    - develop
  schedule:
    - cron: "0 2 * * *"
```

## 示例6: 多环境测试

### 场景
你需要在开发、测试、生产环境分别运行测试。

### 步骤

1. **创建环境配置文件**
```bash
# 开发环境
cp k6/config/envconfig.js k6/config/envconfig.dev.js

# 测试环境
cp k6/config/envconfig.js k6/config/envconfig.test.js

# 生产环境
cp k6/config/envconfig.js k6/config/envconfig.prod.js
```

2. **修改各环境配置**
```javascript
// envconfig.dev.js
export const ENV_CONFIG = {
    BASE_ADMIN_URL: "https://dev.example.com",
    TENANTID: 3004,
    // ...
};

// envconfig.test.js
export const ENV_CONFIG = {
    BASE_ADMIN_URL: "https://test.example.com",
    TENANTID: 3004,
    // ...
};
```

3. **创建环境切换脚本**
```bash
#!/bin/bash
# run-test-env.sh

ENV=$1

if [ -z "$ENV" ]; then
    echo "用法: ./run-test-env.sh [dev|test|prod]"
    exit 1
fi

# 备份当前配置
cp k6/config/envconfig.js k6/config/envconfig.backup.js

# 切换到指定环境
cp k6/config/envconfig.$ENV.js k6/config/envconfig.js

# 运行测试
./k6/tests/aitest/run-all.sh

# 恢复配置
mv k6/config/envconfig.backup.js k6/config/envconfig.js
```

4. **运行测试**
```bash
# 开发环境
./run-test-env.sh dev

# 测试环境
./run-test-env.sh test

# 生产环境（谨慎）
./run-test-env.sh prod
```

## 示例7: 定期安全扫描

### 场景
你想每天自动运行安全测试，并发送报告。

### 使用cron定时任务

1. **创建测试脚本**
```bash
#!/bin/bash
# daily-security-scan.sh

DATE=$(date +%Y%m%d)
LOG_FILE="logs/security-scan-$DATE.log"

echo "开始每日安全扫描: $DATE" | tee -a $LOG_FILE

# 运行测试
./k6/tests/aitest/run-all.sh 2>&1 | tee -a $LOG_FILE

# 检查是否有失败
if grep -q "✗" $LOG_FILE; then
    echo "发现安全问题！" | tee -a $LOG_FILE
    # 发送告警邮件
    mail -s "AI安全测试失败 - $DATE" admin@example.com < $LOG_FILE
fi

echo "扫描完成: $DATE" | tee -a $LOG_FILE
```

2. **添加cron任务**
```bash
# 编辑crontab
crontab -e

# 添加每天凌晨2点运行
0 2 * * * /path/to/daily-security-scan.sh
```

## 常见问题解决

### 问题1: 所有测试都失败
```bash
# 检查登录是否成功
k6 run k6/tests/api/login/adminlogin.test.js

# 如果登录失败，检查账号配置
vim k6/config/envconfig.js
```

### 问题2: 部分测试超时
```bash
# 增加超时时间
# 编辑 aiTestUtils.js
vim k6/tests/aitest/common/aiTestUtils.js

# 修改 timeout 配置
const response = httpClient.post(
    api,
    payload,
    {
        timeout: '60s',  // 增加到60秒
        // ...
    }
);
```

### 问题3: 测试结果不稳定
```bash
# 增加重试次数
# 或者增加测试间隔
sleep(2);  // 在测试之间增加等待时间
```

## 更多示例

查看各测试文件中的详细注释，了解每个测试用例的具体实现。
