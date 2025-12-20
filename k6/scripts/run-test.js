#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const chalk = require('chalk');
const dotenv = require('dotenv');

// 加载环境变量
dotenv.config();

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
  .option('iterations', {
    alias: 'i',
    type: 'number',
    description: '迭代次数'
  })
  .option('output', {
    alias: 'o',
    type: 'string',
    description: '输出目录',
    default: 'reports'
  })
  .option('tags', {
    type: 'array',
    description: '添加测试标签'
  })
  .option('thresholds', {
    type: 'array',
    description: '设置阈值'
  })
  .option('html', {
    type: 'boolean',
    description: '生成HTML报告',
    default: true
  })
  .option('json', {
    type: 'boolean',
    description: '生成JSON报告',
    default: true
  })
  .option('summary', {
    type: 'boolean',
    description: '显示测试摘要',
    default: true
  })
  .option('dry-run', {
    type: 'boolean',
    description: '空运行，不执行测试',
    default: false
  })
  .option('debug', {
    type: 'boolean',
    description: '调试模式',
    default: false
  })
  .help()
  .argv;

class TestRunner {
  constructor(options) {
    this.options = options;
    this.projectRoot = process.cwd();
    this.k6Path = this.findK6Path();
    this.timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  }

  findK6Path() {
    try {
      // 尝试在系统路径中查找 k6
      execSync('which k6', { stdio: 'pipe' });
      return 'k6';
    } catch (error) {
      console.log(chalk.yellow('未找到系统 k6，尝试使用 npx k6'));
      return 'npx k6';
    }
  }

  getTestFiles() {
    const { type, test } = this.options;
    
    if (test) {
      return [test];
    }

    const testDir = path.join(this.projectRoot, 'k6', 'tests');
    let pattern = '';
    
    switch (type) {
      case 'smoke':
        pattern = '**/smoke/**/*.test.js';
        break;
      case 'api':
        pattern = '**/api/**/*.test.js';
        break;
      case 'load':
        pattern = '**/performance/load/**/*.test.js';
        break;
      case 'stress':
        pattern = '**/performance/stress/**/*.test.js';
        break;
      case 'endurance':
        pattern = '**/performance/endurance/**/*.test.js';
        break;
      default:
        pattern = '**/*.test.js';
    }

    const { globSync } = require('glob');
    const files = globSync(pattern, { 
      cwd: testDir,
      absolute: true 
    });

    if (files.length === 0) {
      throw new Error(`未找到匹配的测试文件: ${pattern}`);
    }

    return files;
  }

  buildK6Command(testFile) {
    const {
      env,
      vus,
      duration,
      iterations,
      tags,
      thresholds,
      html,
      json,
      debug,
      dryRun
    } = this.options;

    let command = `${this.k6Path} run`;

    // 添加环境变量
    command += ` -e ENVIRONMENT=${env}`;
    command += ` -e TEST_TYPE=${this.options.type}`;

    // 添加用户和密码（如果设置了）
    if (process.env.TEST_USER) {
      command += ` -e TEST_USER=${process.env.TEST_USER}`;
    }
    if (process.env.TEST_PASSWORD) {
      command += ` -e TEST_PASSWORD=${process.env.TEST_PASSWORD}`;
    }

    // 添加覆盖参数
    if (vus) {
      command += ` --vus ${vus}`;
    }
    if (duration) {
      command += ` --duration ${duration}`;
    }
    if (iterations) {
      command += ` --iterations ${iterations}`;
    }

    // 添加标签
    if (tags && tags.length > 0) {
      tags.forEach(tag => {
        command += ` --tag ${tag}`;
      });
    }

    // 添加阈值
    if (thresholds && thresholds.length > 0) {
      thresholds.forEach(threshold => {
        command += ` --threshold ${threshold}`;
      });
    }

    // 添加输出选项
    const outputDir = path.join(this.projectRoot, this.options.output);
    const reportName = `report-${this.options.type}-${env}-${this.timestamp}`;

    if (html) {
      const htmlReport = path.join(outputDir, 'html', `${reportName}.html`);
      command += ` --out html=${htmlReport}`;
    }

    if (json) {
      const jsonReport = path.join(outputDir, 'json', `${reportName}.json`);
      command += ` --out json=${jsonReport}`;
    }

    // 添加调试选项
    if (debug) {
      command += ' --verbose';
    }

    // 添加测试文件
    command += ` ${testFile}`;

    return command;
  }

  async runTest(testFile) {
    const command = this.buildK6Command(testFile);
    const testName = path.relative(this.projectRoot, testFile);

    console.log(chalk.blue(`\n🚀 开始测试: ${testName}`));
    console.log(chalk.gray(`命令: ${command}`));

    if (this.options.dryRun) {
      console.log(chalk.yellow('📋 空运行模式，不执行测试'));
      return { success: true, skipped: true };
    }

    return new Promise((resolve) => {
      const startTime = Date.now();
      const k6Process = spawn(command, [], {
        shell: true,
        stdio: 'inherit'
      });

      k6Process.on('close', (code) => {
        const duration = (Date.now() - startTime) / 1000;
        
        if (code === 0) {
          console.log(chalk.green(`✅ 测试通过 (${duration.toFixed(2)}s)`));
          resolve({ success: true, duration });
        } else {
          console.log(chalk.red(`❌ 测试失败 (${duration.toFixed(2)}s)`));
          resolve({ success: false, duration, code });
        }
      });

      k6Process.on('error', (error) => {
        console.log(chalk.red(`❌ 执行错误: ${error.message}`));
        resolve({ success: false, error: error.message });
      });
    });
  }

  async runAll() {
    console.log(chalk.cyan('='.repeat(60)));
    console.log(chalk.cyan.bold('🎯 K6 性能测试框架'));
    console.log(chalk.cyan('='.repeat(60)));

    const testFiles = this.getTestFiles();
    const results = [];
    let passed = 0;
    let failed = 0;

    console.log(chalk.blue(`📁 找到 ${testFiles.length} 个测试文件`));

    for (const testFile of testFiles) {
      const result = await this.runTest(testFile);
      results.push({ file: testFile, ...result });
      
      if (result.success) {
        passed++;
      } else {
        failed++;
      }
    }

    // 生成报告
    this.generateSummary(results, passed, failed);
    
    return {
      total: testFiles.length,
      passed,
      failed,
      results
    };
  }

  generateSummary(results, passed, failed) {
    console.log(chalk.cyan('\n' + '='.repeat(60)));
    console.log(chalk.cyan.bold('📊 测试摘要'));
    console.log(chalk.cyan('='.repeat(60)));

    console.log(chalk.white(`总计: ${results.length}`));
    console.log(chalk.green(`通过: ${passed}`));
    console.log(chalk.red(`失败: ${failed}`));

    if (failed > 0) {
      console.log(chalk.yellow('\n🔍 失败详情:'));
      results
        .filter(r => !r.success)
        .forEach(r => {
          console.log(chalk.red(`  ❌ ${path.relative(this.projectRoot, r.file)}`));
          if (r.code) console.log(chalk.gray(`     退出码: ${r.code}`));
          if (r.error) console.log(chalk.gray(`     错误: ${r.error}`));
        });
    }

    const passRate = (passed / results.length * 100).toFixed(1);
    console.log(chalk.blue(`\n📈 通过率: ${passRate}%`));

    // 保存摘要到文件
    const summary = {
      timestamp: new Date().toISOString(),
      options: this.options,
      summary: {
        total: results.length,
        passed,
        failed,
        passRate: `${passRate}%`
      },
      results: results.map(r => ({
        file: path.relative(this.projectRoot, r.file),
        success: r.success,
        duration: r.duration,
        code: r.code
      }))
    };

    const outputDir = path.join(this.projectRoot, this.options.output);
    const summaryFile = path.join(outputDir, `summary-${this.timestamp}.json`);
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
    console.log(chalk.green(`📄 摘要保存到: ${summaryFile}`));
  }
}

// 主执行函数
async function main() {
  try {
    const runner = new TestRunner(argv);
    await runner.runAll();
  } catch (error) {
    console.error(chalk.red(`❌ 执行失败: ${error.message}`));
    process.exit(1);
  }
}

main();
