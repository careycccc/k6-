#!/usr/bin/env node

/**
 * K6 测试框架初始化脚本
 * 用于创建项目目录结构和示例文件
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

// 创建颜色输出函数
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

const colorize = (color, text) => `${colors[color]}${text}${colors.reset}`;

// 创建命令行界面
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 配置选项
let config = {
  projectName: 'k6-test-framework',
  baseUrl: 'http://localhost:3000',
  apiVersion: 'v1',
  environments: ['local', 'dev', 'staging', 'production'],
  testTypes: ['smoke', 'api', 'load', 'stress', 'endurance'],
  installDependencies: true
};

// 创建目录结构
const directories = [
  // K6 目录结构
  'k6/config',
  'k6/libs/http',
  'k6/libs/auth',
  'k6/libs/data',
  'k6/libs/utils',
  'k6/libs/checks',
  
  // 测试目录
  'k6/tests/smoke',
  'k6/tests/api/user',
  'k6/tests/api/product',
  'k6/tests/api/order',
  'k6/tests/performance/load',
  'k6/tests/performance/stress',
  'k6/tests/performance/endurance',
  'k6/tests/integration/workflow',
  'k6/tests/integration/third-party',
  
  // 数据目录
  'k6/data/fixtures',
  'k6/data/schemas',
  'k6/data/csv',
  
  // 脚本目录
  'k6/scripts',
  
  // 报告目录
  'reports/html',
  'reports/json',
  'reports/junit',
  
  // 日志目录
  'logs',
  
  // Docker 目录
  'docker'
];

// 需要创建的文件列表
const files = [
  // 配置文件
  '.env.example',
  '.eslintrc.js',
  '.prettierrc',
  '.gitignore',
  
  // 项目配置
  'package.json',
  'README.md',
  
  // 主要脚本
  'scripts/run-test.js',
  
  // K6 核心配置文件
  'k6/config/environment.js',
  'k6/config/thresholds.js',
  'k6/config/scenarios.js',
  
  // K6 工具库
  'k6/libs/http/client.js',
  'k6/libs/http/requestBuilder.js',
  'k6/libs/http/responseValidator.js',
  'k6/libs/auth/tokenManager.js',
  'k6/libs/data/dataGenerator.js',
  'k6/libs/data/csvLoader.js',
  'k6/libs/utils/logger.js',
  'k6/libs/utils/reporter.js',
  'k6/libs/utils/performance.js',
  'k6/libs/utils/helper.js',
  'k6/libs/checks/apiChecks.js',
  'k6/libs/checks/businessChecks.js',
  'k6/libs/checks/performanceChecks.js',
  
  // 测试示例文件
  'k6/tests/smoke/health.test.js',
  'k6/tests/smoke/auth.test.js',
  'k6/tests/api/user/user.create.test.js',
  'k6/tests/api/user/user.read.test.js',
  'k6/tests/api/user/user.update.test.js',
  'k6/tests/api/user/user.delete.test.js',
  'k6/tests/performance/load/normal-load.test.js',
  
  // 数据文件
  'k6/data/fixtures/users.json',
  'k6/data/fixtures/products.json',
  'k6/data/schemas/user.schema.json',
  'k6/data/schemas/product.schema.json',
  
  // Docker 文件
  'docker/Dockerfile',
  'docker/docker-compose.yml'
];

// 显示标题
function showTitle() {
  console.log('');
  console.log(colorize('cyan', '╔══════════════════════════════════════════════════════════════╗'));
  console.log(colorize('cyan', '║                K6 企业级测试框架初始化工具                ║'));
  console.log(colorize('cyan', '╚══════════════════════════════════════════════════════════════╝'));
  console.log('');
}

// 显示进度
function showProgress(current, total, message) {
  const percentage = Math.round((current / total) * 100);
  const barLength = 40;
  const filledLength = Math.round(barLength * (current / total));
  const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
  
  process.stdout.write(`\r${colorize('blue', '[' + bar + ']')} ${percentage}% ${message}`);
  
  if (current === total) {
    process.stdout.write('\n');
  }
}

// 创建目录
function createDirectories() {
  console.log(colorize('cyan', '📁 创建目录结构...'));
  
  directories.forEach((dir, index) => {
    const dirPath = path.join(process.cwd(), dir);
    
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      showProgress(index + 1, directories.length, `创建目录: ${dir}`);
    } else {
      showProgress(index + 1, directories.length, `目录已存在: ${dir}`);
    }
  });
  
  console.log(colorize('green', '✓ 目录结构创建完成\n'));
}

// 创建文件内容
function getFileContent(filePath) {
  const fileName = path.basename(filePath);
  
  // 根据文件名返回不同的内容
  switch (fileName) {
    case 'package.json':
      return JSON.stringify({
        "name": config.projectName,
        "version": "1.0.0",
        "description": "企业级 K6 性能测试与自动化接口测试框架",
        "main": "index.js",
        "scripts": {
          "test:smoke": "node scripts/run-test.js --type smoke",
          "test:api": "node scripts/run-test.js --type api",
          "test:load": "node scripts/run-test.js --type load",
          "test:stress": "node scripts/run-test.js --type stress",
          "test:endurance": "node scripts/run-test.js --type endurance",
          "test:all": "npm run test:smoke && npm run test:api && npm run test:load",
          "lint": "eslint k6/**/*.js",
          "format": "prettier --write k6/**/*.js scripts/**/*.js",
          "security:check": "npm audit",
          "security:fix": "npm audit fix",
          "clean": "rm -rf reports/* logs/*",
          "report": "node scripts/generate-report.js",
          "docker:build": "docker build -t k6-test-framework -f docker/Dockerfile .",
          "docker:run": "docker-compose -f docker/docker-compose.yml up k6",
          "precommit": "npm run lint && npm run format"
        },
        "keywords": ["k6", "performance", "testing", "load-testing", "api-testing", "automation"],
        "author": "K6 Test Team",
        "license": "MIT",
        "devDependencies": {
          "eslint": "^8.56.0",
          "eslint-config-prettier": "^9.1.0",
          "eslint-plugin-import": "^2.29.1",
          "prettier": "^3.2.5",
          "cross-env": "^7.0.3",
          "dotenv": "^16.3.1",
          "js-yaml": "^4.1.0",
          "csv-parse": "^5.5.3",
          "chalk": "^4.1.2",
          "inquirer": "^8.2.6",
          "yargs": "^17.7.2",
          "glob": "^10.3.10"
        },
        "engines": {
          "node": ">=14.0.0",
          "npm": ">=6.0.0"
        }
      }, null, 2);

    case '.gitignore':
      return `# 依赖目录
node_modules/

# 环境变量
.env
.env.local
.env.*.local

# 日志文件
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# 报告目录
reports/*.html
reports/*.json
reports/*.xml
!reports/.gitkeep

# IDE 文件
.vscode/
.idea/
*.swp
*.swo

# 操作系统文件
.DS_Store
Thumbs.db

# 临时文件
tmp/
temp/

# Docker
*.dockerignore
docker-compose.override.yml

# 缓存
.cache/
.eslintcache

# 测试数据
test-data/
*.testdata.*`;

    case '.env.example':
      return `# 测试环境配置
ENVIRONMENT=local
TEST_TYPE=smoke

# 认证信息
TEST_USER=admin
TEST_PASSWORD=password

# API 配置
API_BASE_URL=${config.baseUrl}
API_VERSION=${config.apiVersion}

# K6 配置
K6_OUTPUT=reports
K6_LOG_LEVEL=info

# 性能阈值
THRESHOLD_P95=1000
THRESHOLD_P99=2000
THRESHOLD_ERROR_RATE=0.01

# 报告配置
GENERATE_HTML=true
GENERATE_JSON=true
GENERATE_SUMMARY=true`;

    case '.eslintrc.js':
      return `module.exports = {
  env: {
    browser: false,
    node: true,
    es6: true
  },
  extends: [
    'eslint:recommended',
    'prettier'
  ],
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module'
  },
  rules: {
    'no-console': 'off',
    'no-unused-vars': ['error', { 
      'argsIgnorePattern': '^_',
      'varsIgnorePattern': '^_' 
    }],
    'quotes': ['error', 'single'],
    'semi': ['error', 'always'],
    'indent': ['error', 2]
  },
  overrides: [
    {
      files: ['**/*.test.js'],
      rules: {
        'no-undef': 'off'
      }
    }
  ]
};`;

    case '.prettierrc':
      return JSON.stringify({
        "semi": true,
        "trailingComma": "none",
        "singleQuote": true,
        "printWidth": 100,
        "tabWidth": 2,
        "useTabs": false,
        "bracketSpacing": true,
        "arrowParens": "always",
        "endOfLine": "lf"
      }, null, 2);

    case 'README.md':
      return `# ${config.projectName}

## 🚀 快速开始

### 1. 安装 K6
\`\`\`bash
# macOS
brew install k6

# Ubuntu/Debian
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# Windows
choco install k6
\`\`\`

### 2. 安装项目依赖
\`\`\`bash
npm install
\`\`\`

### 3. 配置环境变量
\`\`\`bash
cp .env.example .env
# 编辑 .env 文件配置您的环境
\`\`\`

### 4. 运行测试
\`\`\`bash
# 运行冒烟测试
npm run test:smoke

# 运行 API 测试
npm run test:api

# 运行负载测试
npm run test:load

# 运行所有测试
npm run test:all
\`\`\`

## 📁 项目结构

\`\`\`
${config.projectName}/
├── k6/                    # K6 测试代码
│   ├── config/           # 配置文件
│   ├── libs/             # 公共库
│   ├── tests/            # 测试用例
│   ├── data/             # 测试数据
│   └── scripts/          # K6 脚本
├── scripts/              # Node.js 脚本
├── reports/              # 测试报告
├── docker/               # Docker 配置
├── .env.example          # 环境变量模板
├── package.json          # 项目配置
└── README.md            # 说明文档
\`\`\`

## 🎯 特性

- ✅ 完整的 HTTP 客户端封装
- ✅ 认证管理（Token、OAuth2）
- ✅ 数据生成与管理
- ✅ 响应验证与断言
- ✅ 性能监控与报告
- ✅ 多环境支持
- ✅ 多种测试类型

## 🛠 高级用法

### 自定义测试
\`\`\`bash
# 运行特定测试文件
node scripts/run-test.js --test k6/tests/api/user.test.js

# 自定义虚拟用户数
node scripts/run-test.js --type load --vus 100 --duration 5m

# 自定义环境
node scripts/run-test.js --env staging --type stress
\`\`\`

### Docker 运行
\`\`\`bash
# 构建镜像
npm run docker:build

# 运行测试
npm run docker:run
\`\`\`

## 📊 报告

测试完成后，报告将生成在 \`reports/\` 目录：
- \`reports/html/\` - HTML 可视化报告
- \`reports/json/\` - JSON 详细数据
- \`reports/junit/\` - JUnit 格式报告

## 📄 许可证

MIT
`;

    case 'scripts/run-test.js':
      return `#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const chalk = require('chalk');

const argv = yargs(hideBin(process.argv))
  .option('type', {
    alias: 't',
    type: 'string',
    description: '测试类型 (smoke, api, load, stress, endurance)',
    default: 'smoke'
  })
  .option('env', {
    alias: 'e',
    type: 'string',
    description: '测试环境 (local, dev, staging, production)',
    default: process.env.ENVIRONMENT || 'local'
  })
  .option('test', {
    alias: 'f',
    type: 'string',
    description: '特定的测试文件'
  })
  .option('vus', {
    alias: 'v',
    type: 'number',
    description: '虚拟用户数'
  })
  .option('duration', {
    alias: 'd',
    type: 'string',
    description: '测试持续时间'
  })
  .option('output', {
    alias: 'o',
    type: 'string',
    description: '输出目录',
    default: 'reports'
  })
  .option('summary', {
    type: 'boolean',
    description: '显示测试摘要',
    default: true
  })
  .help()
  .argv;

async function runTest() {
  const testFile = argv.test || \`k6/tests/\${argv.type}/health.test.js\`;
  const reportName = \`report-\${argv.type}-\${argv.env}-\${Date.now()}\`;
  
  let command = \`k6 run --out json=\${argv.output}/json/\${reportName}.json\`;
  
  if (argv.vus) command += \` --vus \${argv.vus}\`;
  if (argv.duration) command += \` --duration \${argv.duration}\`;
  
  command += \` -e ENVIRONMENT=\${argv.env}\`;
  command += \` -e TEST_TYPE=\${argv.type}\`;
  
  command += \` \${testFile}\`;
  
  console.log(chalk.blue(\`🚀 执行命令: \${command}\`));
  
  return new Promise((resolve) => {
    const k6Process = spawn(command, [], { shell: true, stdio: 'inherit' });
    
    k6Process.on('close', (code) => {
      if (code === 0) {
        console.log(chalk.green('✅ 测试完成'));
        resolve(true);
      } else {
        console.log(chalk.red(\`❌ 测试失败，退出码: \${code}\`));
        resolve(false);
      }
    });
  });
}

runTest().catch(console.error);`;

    case 'k6/config/environment.js':
      return `/**
 * 环境配置管理
 */
export const environments = {
  local: {
    baseUrl: '${config.baseUrl}',
    apiVersion: '${config.apiVersion}',
    timeout: 30000
  },
  dev: {
    baseUrl: 'https://dev-api.example.com',
    apiVersion: '${config.apiVersion}',
    timeout: 30000
  },
  staging: {
    baseUrl: 'https://staging-api.example.com',
    apiVersion: '${config.apiVersion}',
    timeout: 60000
  },
  production: {
    baseUrl: 'https://api.example.com',
    apiVersion: '${config.apiVersion}',
    timeout: 60000
  }
};

export function getEnvironment() {
  const env = __ENV.ENVIRONMENT || 'local';
  return {
    ...environments[env],
    name: env
  };
}

export function getApiUrl(endpoint) {
  const env = getEnvironment();
  return \`\${env.baseUrl}/\${env.apiVersion}\${endpoint}\`;
}

export default {
  environments,
  getEnvironment,
  getApiUrl
};`;

    case 'k6/config/thresholds.js':
      return `/**
 * 性能测试阈值配置
 */
export const thresholds = {
  http: {
    'http_req_duration': ['p(95)<1000', 'p(99)<2000'],
    'http_req_failed': ['rate<0.01'],
    'http_reqs': ['count>100']
  },
  
  custom: {
    'failed_requests': ['rate<0.05']
  }
};

export function getThresholds(testType, environment = null) {
  const env = environment || __ENV.ENVIRONMENT || 'local';
  
  const envThresholds = {
    local: {
      'http_req_duration': ['p(95)<2000', 'p(99)<5000']
    },
    dev: {
      'http_req_duration': ['p(95)<1500', 'p(99)<3000']
    },
    staging: {
      'http_req_duration': ['p(95)<1000', 'p(99)<2000']
    },
    production: {
      'http_req_duration': ['p(95)<800', 'p(99)<1500']
    }
  };
  
  return {
    ...thresholds.http,
    ...thresholds.custom,
    ...(envThresholds[env] || {})
  };
}

export default {
  thresholds,
  getThresholds
};`;

    case 'k6/config/scenarios.js':
      return `/**
 * 测试场景配置
 */
export const scenarios = {
  smoke: {
    executor: 'shared-iterations',
    vus: 1,
    iterations: 10,
    maxDuration: '5m'
  },
  
  load: {
    normal: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '2m', target: 50 },
        { duration: '30s', target: 10 }
      ]
    }
  },
  
  stress: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '1m', target: 500 },
        { duration: '30s', target: 100 }
      ]
    }
  },
  
  endurance: {
    short: {
      executor: 'constant-vus',
      vus: 20,
      duration: '1h'
    }
  }
};

export function getScenario(scenarioName) {
  const scenarioPath = scenarioName.split('.');
  let config = scenarios;
  
  for (const path of scenarioPath) {
    if (config[path]) {
      config = config[path];
    } else {
      throw new Error(\`场景 \${scenarioName} 不存在\`);
    }
  }
  
  return config;
}

export default {
  scenarios,
  getScenario
};`;

    case 'k6/libs/http/client.js':
      return `import http from 'k6/http';
import { check } from 'k6';
import { getApiUrl } from '../../config/environment.js';

/**
 * HTTP客户端封装类
 */
export class HttpClient {
  constructor(baseConfig = {}) {
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      'User-Agent': 'K6-Performance-Test/1.0',
      ...baseConfig.headers
    };
    
    this.timeout = baseConfig.timeout || 30000;
  }

  setAuthToken(token) {
    this.defaultHeaders['Authorization'] = \`Bearer \${token}\`;
  }

  async get(endpoint, params = {}, config = {}) {
    const url = config.fullUrl || getApiUrl(endpoint);
    const headers = { ...this.defaultHeaders, ...config.headers };
    
    const response = http.get(url, {
      headers,
      params: { ...params, ...config.params },
      timeout: config.timeout || this.timeout,
      tags: config.tags || {}
    });
    
    return this.handleResponse(response, config);
  }

  async post(endpoint, data = {}, config = {}) {
    const url = config.fullUrl || getApiUrl(endpoint);
    const headers = { ...this.defaultHeaders, ...config.headers };
    
    const response = http.post(url, JSON.stringify(data), {
      headers,
      timeout: config.timeout || this.timeout,
      tags: config.tags || {}
    });
    
    return this.handleResponse(response, config);
  }

  async put(endpoint, data = {}, config = {}) {
    const url = config.fullUrl || getApiUrl(endpoint);
    const headers = { ...this.defaultHeaders, ...config.headers };
    
    const response = http.put(url, JSON.stringify(data), {
      headers,
      timeout: config.timeout || this.timeout,
      tags: config.tags || {}
    });
    
    return this.handleResponse(response, config);
  }

  async delete(endpoint, config = {}) {
    const url = config.fullUrl || getApiUrl(endpoint);
    const headers = { ...this.defaultHeaders, ...config.headers };
    
    const response = http.del(url, null, {
      headers,
      timeout: config.timeout || this.timeout,
      tags: config.tags || {}
    });
    
    return this.handleResponse(response, config);
  }

  async handleResponse(response, config) {
    const checks = {
      '状态码为2xx或3xx': (r) => r.status >= 200 && r.status < 400,
      '响应时间小于5s': (r) => r.timings.duration < 5000
    };
    
    const checkResult = check(response, checks);
    
    return {
      success: checkResult,
      status: response.status,
      headers: response.headers,
      body: response.json(),
      timings: response.timings
    };
  }
}

export const httpClient = new HttpClient();

export default {
  HttpClient,
  httpClient
};`;

    case 'k6/libs/auth/tokenManager.js':
      return `import { httpClient } from '../http/client.js';

/**
 * Token管理器
 */
export class TokenManager {
  constructor(config = {}) {
    this.tokens = new Map();
    this.config = {
      authEndpoint: '/auth/login',
      refreshEndpoint: '/auth/refresh',
      tokenKey: 'access_token',
      ...config
    };
  }

  async getToken(credentials) {
    const tokenKey = \`\${credentials.username || credentials.client_id}\`;
    
    if (this.tokens.has(tokenKey)) {
      return this.tokens.get(tokenKey);
    }
    
    return this.acquireToken(credentials);
  }

  async acquireToken(credentials) {
    try {
      const response = await httpClient.post(this.config.authEndpoint, credentials, {
        validate: false,
        tags: { type: 'auth' }
      });
      
      if (!response.success) {
        throw new Error(\`认证失败: \${response.status}\`);
      }
      
      const token = response.body[this.config.tokenKey];
      const tokenKey = \`\${credentials.username || credentials.client_id}\`;
      
      this.tokens.set(tokenKey, token);
      
      return token;
    } catch (error) {
      console.error('Token获取失败:', error.message);
      throw error;
    }
  }

  clearToken(credentials) {
    const tokenKey = \`\${credentials.username || credentials.client_id}\`;
    this.tokens.delete(tokenKey);
  }
}

export const tokenManager = new TokenManager();

export default {
  TokenManager,
  tokenManager
};`;

    case 'k6/libs/data/dataGenerator.js':
      return `/**
 * 数据生成器
 */
export class DataGenerator {
  constructor(seed = null) {
    this.seed = seed;
    this.counters = new Map();
  }

  randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  randomString(length = 10) {
    const charset = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += charset.charAt(this.randomInt(0, charset.length - 1));
    }
    return result;
  }

  randomEmail(domain = 'test.com') {
    const username = this.randomString(8);
    return \`\${username}@\${domain}\`;
  }

  incrementId(key = 'default', start = 1) {
    if (!this.counters.has(key)) {
      this.counters.set(key, start);
    }
    const current = this.counters.get(key);
    this.counters.set(key, current + 1);
    return current;
  }

  generateUser(overrides = {}) {
    const id = this.incrementId('user');
    
    return {
      id,
      username: \`user\${id}\`,
      email: this.randomEmail(),
      firstName: \`FirstName\${id}\`,
      lastName: \`LastName\${id}\`,
      age: this.randomInt(18, 60),
      active: true,
      ...overrides
    };
  }

  generateProduct(overrides = {}) {
    const id = this.incrementId('product');
    const categories = ['Electronics', 'Clothing', 'Books', 'Home', 'Sports'];
    const prices = [19.99, 29.99, 49.99, 99.99, 199.99];
    
    return {
      id,
      name: \`Product \${id}\`,
      sku: \`SKU-\${this.randomString(8).toUpperCase()}\`,
      category: categories[this.randomInt(0, categories.length - 1)],
      price: prices[this.randomInt(0, prices.length - 1)],
      stock: this.randomInt(0, 1000),
      ...overrides
    };
  }
}

export const dataGenerator = new DataGenerator();

export default {
  DataGenerator,
  dataGenerator
};`;

    case 'k6/libs/utils/logger.js':
      return `/**
 * 日志工具类
 */
export class Logger {
  constructor(config = {}) {
    this.level = config.level || 'info';
    this.vuId = __VU || 0;
    this.iterId = __ITER || 0;
  }

  formatMessage(level, message, data) {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);
    const prefix = \`[\${timestamp}] [\${levelStr}] [VU\${this.vuId}-ITER\${this.iterId}]\`;
    
    let formatted = \`\${prefix} \${message}\`;
    
    if (data) {
      if (typeof data === 'object') {
        try {
          formatted += \` \${JSON.stringify(data, null, 0)}\`;
        } catch {
          formatted += \` \${String(data)}\`;
        }
      } else {
        formatted += \` \${data}\`;
      }
    }
    
    return formatted;
  }

  debug(message, data) {
    if (this.level === 'debug') {
      console.log(this.formatMessage('debug', message, data));
    }
  }

  info(message, data) {
    console.log(this.formatMessage('info', message, data));
  }

  warn(message, data) {
    console.log(this.formatMessage('warn', message, data));
  }

  error(message, data) {
    console.log(this.formatMessage('error', message, data));
  }
}

export const logger = new Logger();

export default {
  Logger,
  logger
};`;

    case 'k6/tests/smoke/health.test.js':
      return `import http from 'k6/http';
import { check, sleep } from 'k6';
import { getApiUrl } from '../../config/environment.js';

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.01']
  },
  tags: {
    test_type: 'smoke',
    service: 'health'
  }
};

export default function() {
  const response = http.get(getApiUrl('/health'));
  
  check(response, {
    '状态码是 200': (r) => r.status === 200,
    '响应时间 < 500ms': (r) => r.timings.duration < 500,
    '响应体包含 status': (r) => r.body && r.body.includes('"status"')
  });
  
  sleep(1);
}`;

    case 'k6/tests/api/user/user.create.test.js':
      return `import { check } from 'k6';
import { httpClient } from '../../../libs/http/client.js';
import { dataGenerator } from '../../../libs/data/dataGenerator.js';

export const options = {
  vus: 5,
  duration: '1m',
  thresholds: {
    'http_req_duration{type:create}': ['p(95)<1000'],
    'http_req_failed{type:create}': ['rate<0.01']
  },
  tags: {
    test_type: 'api',
    service: 'user',
    operation: 'create'
  }
};

export default function() {
  // 生成测试用户数据
  const userData = dataGenerator.generateUser({
    username: \`testuser_\${__VU}_\${__ITER}\`,
    email: \`test_\${__VU}_\${__ITER}@test.com\`
  });
  
  // 发送创建用户请求
  const response = httpClient.post('/users', userData, {
    tags: { type: 'create' }
  });
  
  // 检查响应
  check(response, {
    '创建用户成功': () => response.status === 201,
    '返回用户ID': () => response.body && response.body.id !== undefined,
    '用户名匹配': () => response.body && response.body.username === userData.username
  });
}`;

    case 'docker/Dockerfile':
      return `FROM grafana/k6:latest

WORKDIR /app

COPY . /app

RUN chmod +x /app/scripts/run-test.js

ENTRYPOINT ["/app/scripts/run-test.js"]`;

    case 'docker/docker-compose.yml':
      return `version: '3.8'

services:
  k6:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    container_name: k6-test-runner
    volumes:
      - ../reports:/app/reports
      - ../logs:/app/logs
    environment:
      - ENVIRONMENT=local
      - TEST_TYPE=smoke
    command: --type smoke

  test-api:
    image: node:14
    container_name: test-api
    working_dir: /app
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=test
    command: sh -c "echo 'Test API running on port 3000' && tail -f /dev/null"`;

    default:
      // 对于其他文件，返回简单的占位内容
      const fileType = fileName.split('.').pop();
      if (fileType === 'json') {
        return JSON.stringify({}, null, 2);
      } else {
        return `/**
 * ${fileName}
 * 自动生成的文件
 * 
 * 请根据实际需求修改此文件
 */
`;
      }
  }
}

// 创建文件
function createFiles() {
  console.log(colorize('cyan', '📄 创建文件...'));
  
  files.forEach((file, index) => {
    const filePath = path.join(process.cwd(), file);
    const dirPath = path.dirname(filePath);
    
    // 确保目录存在
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    // 如果文件不存在，则创建
    if (!fs.existsSync(filePath)) {
      const content = getFileContent(filePath);
      fs.writeFileSync(filePath, content, 'utf8');
      showProgress(index + 1, files.length, `创建文件: ${file}`);
    } else {
      showProgress(index + 1, files.length, `文件已存在: ${file}`);
    }
  });
  
  console.log(colorize('green', '\n✓ 文件创建完成\n'));
}

// 安装依赖
function installDependencies() {
  if (!config.installDependencies) {
    console.log(colorize('yellow', '⏭️ 跳过依赖安装'));
    return;
  }
  
  console.log(colorize('cyan', '📦 安装依赖...'));
  
  try {
    // 检查 package.json 是否存在
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      console.log(colorize('red', '❌ package.json 不存在，无法安装依赖'));
      return;
    }
    
    execSync('npm install', { stdio: 'inherit' });
    console.log(colorize('green', '✓ 依赖安装完成\n'));
  } catch (error) {
    console.log(colorize('yellow', '⚠ 依赖安装失败，请手动运行: npm install'));
  }
}

// 显示完成信息
function showCompletionMessage() {
  console.log(colorize('green', '╔══════════════════════════════════════════════════════════════╗'));
  console.log(colorize('green', '║                   初始化完成！🎉                           ║'));
  console.log(colorize('green', '╚══════════════════════════════════════════════════════════════╝'));
  console.log('');
  
  console.log(colorize('white', '📋 下一步操作：'));
  console.log('');
  console.log(colorize('cyan', '1. 配置环境变量'));
  console.log(colorize('white', '   cp .env.example .env'));
  console.log(colorize('white', '   然后编辑 .env 文件配置您的 API 地址和认证信息'));
  console.log('');
  
  console.log(colorize('cyan', '2. 检查 K6 是否安装'));
  console.log(colorize('white', '   k6 version'));
  console.log(colorize('white', '   如果未安装，请参考 README.md 安装 K6'));
  console.log('');
  
  console.log(colorize('cyan', '3. 运行冒烟测试'));
  console.log(colorize('white', '   npm run test:smoke'));
  console.log('');
  
  console.log(colorize('cyan', '4. 查看报告'));
  console.log(colorize('white', '   测试报告将生成在 reports/ 目录下'));
  console.log('');
  
  console.log(colorize('cyan', '5. 开始编写您的测试用例'));
  console.log(colorize('white', '   在 k6/tests/ 目录下创建新的测试文件'));
  console.log('');
  
  console.log(colorize('white', '📚 文档：'));
  console.log(colorize('white', '   详细使用说明请查看 README.md 文件'));
  console.log('');
  
  console.log(colorize('yellow', '💡 提示：'));
  console.log(colorize('white', '   您可以根据需要修改 k6/config/ 目录下的配置文件'));
  console.log(colorize('white', '   所有测试文件都在 k6/tests/ 目录下'));
}

// 主函数
async function main() {
  showTitle();
  
  // 询问用户配置
  const answer = await new Promise(resolve => {
    rl.question(colorize('cyan', '请输入项目名称 (默认: k6-test-framework): '), (input) => {
      if (input.trim()) config.projectName = input.trim();
      resolve();
    });
  });
  
  // 创建目录和文件
  createDirectories();
  createFiles();
  installDependencies();
  
  // 关闭 readline 接口
  rl.close();
  
  // 显示完成信息
  showCompletionMessage();
}

// 处理退出
process.on('SIGINT', () => {
  console.log(colorize('yellow', '\n\n⚠ 用户中断初始化'));
  rl.close();
  process.exit(0);
});

// 运行主函数
main().catch(error => {
  console.error(colorize('red', '❌ 初始化失败:'), error);
  rl.close();
  process.exit(1);
});
