1.安装K6
# macOS
brew install k6

# Linux
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# Windows
choco install k6

2.初始化项目
git clone <your-repo>
cd k6-test-framework
npm install
chmod +x k6/scripts/run.sh


3.配置环境变量
cp .env.example .env
# 编辑.env文件，配置环境变量


 3.1运行测试
 运行冒烟测试
 ./k6/scripts/run.sh -e local -t smoke k6/tests/smoke/health.test.js
 运行API测试
./k6/scripts/run.sh -e dev -t api k6/tests/api/user/user.create.test.js
 运行性能测试
./k6/scripts/run.sh -e staging -t load -v 100 -d 5m k6/tests/performance/load/normal-load.test.js

使用Docker运行
docker-compose -f docker/docker-compose.yml up k6

 3.2查看报告
 运行测试后，报告将保存在k6/reports目录下，包括HTML、JSON、JUnit和文本摘要报告。您可以使用浏览器打开HTML报告以查看测试结果。
 # 报告生成在 reports/html/ 目录
open reports/html/report-*.html
# 使用jq查看JSON报告
jq '.' reports/json/report-*.json | less


添加新的测试用例
```js
// k6/tests/api/new/new.test.js
import { group } from 'k6';
import { httpClient } from '../../../libs/http/client.js';

export default function() {
  group('新的API测试', () => {
    // 测试逻辑
  });
}

添加自定义指标
```js`
import { Trend, Counter, Rate, Gauge } from 'k6/metrics';

// 自定义指标
const customTrend = new Trend('custom_duration');
const customCounter = new Counter('custom_count');
const customRate = new Rate('custom_rate');
const customGauge = new Gauge('custom_gauge');

// 在测试中使用
export default function() {
  const start = Date.now();
  // 执行操作
  const duration = Date.now() - start;
  
  customTrend.add(duration);
  customCounter.add(1);
  customRate.add(duration > 1000);
  customGauge.add(Math.random() * 100);
}



集成第三方工具
集成InfluxDB + Grafana
k6 run --out influxdb=http://localhost:8086/k6 script.js

集成Prometheus
k6 run --out experimental-prometheus-rw script.js



# 运行冒烟测试
npm run test:smoke

# 运行 API 测试
npm run test:api

# 运行负载测试
npm run test:load

# 运行所有测试
npm run test:all


自定义测试
# 运行特定测试文件
node scripts/run-test.js --test k6/tests/api/user.test.js

# 自定义虚拟用户数
node scripts/run-test.js --type load --vus 100 --duration 5m

# 自定义环境
node scripts/run-test.js --env staging --type stress


### 快速启动项目
# 在项目根目录下创建 scripts 目录和 setup.js 文件
mkdir -p scripts
# 将上面的内容保存到 scripts/setup.js

给脚本添加执行权限
chmod +x scripts/setup.js

运行初始化脚本
node scripts/setup.js
运行完成后，您将得到以下完整的项目结构