#!/bin/bash

# K6性能测试执行脚本
# 用法: ./run.sh [测试类型] [环境] [其他选项]

set -e

# 默认配置
DEFAULT_ENV="local"
DEFAULT_TEST_TYPE="smoke"
OUTPUT_DIR="reports"
LOG_DIR="logs"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 显示帮助
show_help() {
    cat << EOF
K6性能测试执行脚本

用法: $0 [选项] <测试文件>

选项:
  -h, --help           显示此帮助信息
  -e, --env ENV        测试环境 (local, dev, staging, production) [默认: $DEFAULT_ENV]
  -t, --type TYPE      测试类型 (smoke, load, stress, endurance, api) [默认: $DEFAULT_TEST_TYPE]
  -o, --output DIR     输出目录 [默认: $OUTPUT_DIR]
  -u, --user USER      测试用户
  -p, --password PASS  测试密码
  -v, --vus VUS        虚拟用户数 (覆盖配置)
  -d, --duration DUR   测试持续时间 (覆盖配置)
  -i, --iterations ITER迭代次数 (覆盖配置)
  --tag KEY=VALUE      添加测试标签
  --threshold KEY=VALUE设置阈值
  --html               生成HTML报告
  --json               生成JSON报告
  --junit              生成JUnit报告
  --summary            显示测试摘要
  --dry-run            空运行，不执行测试
  --debug              调试模式

示例:
  $0 -e dev -t smoke tests/api/user.test.js
  $0 -e staging -t load -v 100 -d 10m tests/performance/load.test.js
  $0 -e production -t endurance --tag priority=high tests/performance/endurance.test.js
EOF
}

# 解析参数
parse_args() {
    TEST_FILE=""
    ENV="$DEFAULT_ENV"
    TEST_TYPE="$DEFAULT_TEST_TYPE"
    EXTRA_ARGS=()
    TAGS=()
    THRESHOLDS=()
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -e|--env)
                ENV="$2"
                shift 2
                ;;
            -t|--type)
                TEST_TYPE="$2"
                shift 2
                ;;
            -o|--output)
                OUTPUT_DIR="$2"
                shift 2
                ;;
            -u|--user)
                export TEST_USER="$2"
                shift 2
                ;;
            -p|--password)
                export TEST_PASSWORD="$2"
                shift 2
                ;;
            -v|--vus)
                EXTRA_ARGS+=("--vus=$2")
                shift 2
                ;;
            -d|--duration)
                EXTRA_ARGS+=("--duration=$2")
                shift 2
                ;;
            -i|--iterations)
                EXTRA_ARGS+=("--iterations=$2")
                shift 2
                ;;
            --tag)
                TAGS+=("$2")
                shift 2
                ;;
            --threshold)
                THRESHOLDS+=("$2")
                shift 2
                ;;
            --html)
                export GENERATE_HTML="true"
                shift
                ;;
            --json)
                export GENERATE_JSON="true"
                shift
                ;;
            --junit)
                export GENERATE_JUNIT="true"
                shift
                ;;
            --summary)
                export SHOW_SUMMARY="true"
                shift
                ;;
            --dry-run)
                DRY_RUN="true"
                shift
                ;;
            --debug)
                set -x
                export LOG_LEVEL="DEBUG"
                shift
                ;;
            -*)
                log_error "未知选项: $1"
                show_help
                exit 1
                ;;
            *)
                TEST_FILE="$1"
                shift
                ;;
        esac
    done
    
    # 检查必需参数
    if [[ -z "$TEST_FILE" ]]; then
        log_error "必须指定测试文件"
        show_help
        exit 1
    fi
    
    # 检查测试文件是否存在
    if [[ ! -f "$TEST_FILE" ]]; then
        log_error "测试文件不存在: $TEST_FILE"
        exit 1
    fi
}

# 初始化环境
init_environment() {
    log_info "初始化测试环境..."
    
    # 创建目录
    mkdir -p "$OUTPUT_DIR"
    mkdir -p "$OUTPUT_DIR/html"
    mkdir -p "$OUTPUT_DIR/json"
    mkdir -p "$OUTPUT_DIR/junit"
    mkdir -p "$LOG_DIR"
    
    # 设置环境变量
    export ENVIRONMENT="$ENV"
    export TEST_TYPE="$TEST_TYPE"
    export K6_OUTPUT="$OUTPUT_DIR/json/output-$(date +%Y%m%d-%H%M%S).json"
    
    # 添加标签
    for tag in "${TAGS[@]}"; do
        EXTRA_ARGS+=("--tag=$tag")
    done
    
    # 添加阈值
    for threshold in "${THRESHOLDS[@]}"; do
        EXTRA_ARGS+=("--threshold=$threshold")
    done
    
    # 设置报告选项
    if [[ "$GENERATE_HTML" == "true" ]]; then
        EXTRA_ARGS+=("--out json=$K6_OUTPUT")
    fi
    
    log_success "环境初始化完成"
    log_info "环境变量: ENV=$ENV, TYPE=$TEST_TYPE"
}

# 检查依赖
check_dependencies() {
    log_info "检查依赖..."
    
    # 检查k6是否安装
    if ! command -v k6 &> /dev/null; then
        log_error "k6 未安装，请参考 https://k6.io/docs/getting-started/installation/"
        exit 1
    fi
    
    # 检查k6版本
    K6_VERSION=$(k6 version | grep -oP 'v\d+\.\d+\.\d+')
    log_info "k6 版本: $K6_VERSION"
    
    # 推荐版本检查
    MIN_VERSION="v0.40.0"
    if [[ "$(printf '%s\n' "$MIN_VERSION" "$K6_VERSION" | sort -V | head -n1)" != "$MIN_VERSION" ]]; then
        log_warn "建议使用 k6 版本 >= $MIN_VERSION"
    fi
    
    log_success "依赖检查完成"
}

# 准备测试数据
prepare_test_data() {
    log_info "准备测试数据..."
    
    # 如果有数据准备脚本，执行它
    if [[ -f "$PROJECT_ROOT/scripts/setup.js" ]]; then
        node "$PROJECT_ROOT/scripts/setup.js" --env "$ENV" --type "$TEST_TYPE"
        if [[ $? -ne 0 ]]; then
            log_warn "测试数据准备脚本执行失败"
        fi
    fi
    
    log_success "测试数据准备完成"
}

# 执行测试
run_test() {
    local test_file="$1"
    local timestamp=$(date +%Y%m%d-%H%M%S)
    local report_prefix="$OUTPUT_DIR/report-$TEST_TYPE-$ENV-$timestamp"
    
    log_info "开始执行测试..."
    log_info "测试文件: $test_file"
    log_info "测试类型: $TEST_TYPE"
    log_info "测试环境: $ENV"
    
    # 构建k6命令
    local k6_cmd="k6 run"
    
    # 添加环境变量
    k6_cmd+=" -e ENVIRONMENT=$ENV"
    k6_cmd+=" -e TEST_TYPE=$TEST_TYPE"
    
    # 添加额外参数
    for arg in "${EXTRA_ARGS[@]}"; do
        k6_cmd+=" $arg"
    done
    
    # 添加输出选项
    if [[ "$GENERATE_HTML" == "true" ]]; then
        local html_file="$report_prefix.html"
        k6_cmd+=" --out html=$html_file"
        log_info "HTML报告: $html_file"
    fi
    
    if [[ "$GENERATE_JSON" == "true" ]]; then
        local json_file="$report_prefix.json"
        k6_cmd+=" --out json=$json_file"
        log_info "JSON报告: $json_file"
    fi
    
    if [[ "$GENERATE_JUNIT" == "true" ]]; then
        local junit_file="$report_prefix.xml"
        k6_cmd+=" --out xk6-junit=$junit_file"
        log_info "JUnit报告: $junit_file"
    fi
    
    # 添加测试文件
    k6_cmd+=" $test_file"
    
    # 输出完整命令（调试用）
    log_info "执行命令: $k6_cmd"
    
    # 空运行检查
    if [[ "$DRY_RUN" == "true" ]]; then
        log_success "空运行完成，未执行测试"
        exit 0
    fi
    
    # 执行测试
    local start_time=$(date +%s)
    eval $k6_cmd 2>&1 | tee "$LOG_DIR/k6-$timestamp.log"
    local exit_code=${PIPESTATUS[0]}
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    # 处理结果
    if [[ $exit_code -eq 0 ]]; then
        log_success "测试执行完成，耗时 ${duration} 秒"
        
        # 显示摘要
        if [[ "$SHOW_SUMMARY" == "true" ]]; then
            show_summary "$LOG_DIR/k6-$timestamp.log"
        fi
    else
        log_error "测试执行失败，退出码: $exit_code，耗时 ${duration} 秒"
        exit $exit_code
    fi
}

# 显示测试摘要
show_summary() {
    local log_file="$1"
    
    log_info "测试摘要:"
    echo "================================"
    
    # 提取关键指标
    grep -E "(checks|http_req|iteration|vus|data)" "$log_file" | \
        grep -E "(✓|✗|p\(95\)|p\(99\)|avg|min|max|rate)" | \
        head -20
    
    echo "================================"
    
    # 提取阈值检查结果
    if grep -q "thresholds" "$log_file"; then
        log_info "阈值检查结果:"
        grep -A5 "thresholds" "$log_file" | grep -E "(✓|✗|threshold)"
    fi
}

# 清理环境
cleanup() {
    log_info "清理测试环境..."
    
    # 如果有清理脚本，执行它
    if [[ -f "$PROJECT_ROOT/scripts/teardown.js" ]]; then
        node "$PROJECT_ROOT/scripts/teardown.js" --env "$ENV" --type "$TEST_TYPE"
        if [[ $? -ne 0 ]]; then
            log_warn "测试环境清理脚本执行失败"
        fi
    fi
    
    log_success "环境清理完成"
}

# 主函数
main() {
    log_info "K6性能测试框架启动"
    
    # 解析参数
    parse_args "$@"
    
    # 检查依赖
    check_dependencies
    
    # 初始化环境
    init_environment
    
    # 准备测试数据
    prepare_test_data
    
    # 执行测试
    run_test "$TEST_FILE"
    
    # 清理环境
    cleanup
    
    log_success "测试流程完成"
}

# 执行主函数
main "$@"
