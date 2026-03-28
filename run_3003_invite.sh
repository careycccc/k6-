#!/bin/bash

################################################################################
# 3003租户多级下级邀请测试脚本
# 
# 功能：为3003租户使用52区号进行多级下级邀请测试
# 
# 使用方法：
#   ./run_3003_invite.sh [层级配置]
# 
# 参数说明：
#   层级配置：可选参数，格式为 "2,2,3" 表示第1层2人，第2层2人，第3层3人
#             默认为 "2,2"（2层，每层2人）
# 
# 示例：
#   ./run_3003_invite.sh                    # 使用默认配置（2层，每层2人）
#   ./run_3003_invite.sh "2,2,3"            # 3层：2->2->3
#   ./run_3003_invite.sh "3,3,3,3"          # 4层：3->3->3->3
#
# 配置信息：
#   租户ID: 3003
#   总代邀请码: QRVJ5RN
#   区号: 52
#   前台域名: https://arplatsaassit3.club
#   后台域名: https://arsitasdfghj.com
################################################################################

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 打印分隔线
print_separator() {
    echo "================================================================================"
}

# 检查k6是否安装
check_k6() {
    if ! command -v k6 &> /dev/null; then
        print_error "k6 未安装，请先安装 k6"
        print_info "安装方法: https://k6.io/docs/getting-started/installation/"
        exit 1
    fi
    print_success "k6 已安装"
}

# 检查测试文件是否存在
check_test_file() {
    local test_file="k6/tests/api/invite/runInviteByTenant.test.js"
    if [ ! -f "$test_file" ]; then
        print_error "测试文件不存在: $test_file"
        exit 1
    fi
    print_success "测试文件存在: $test_file"
}

# 打印配置信息
print_config() {
    local levels=$1
    
    # 计算层级数和总用户数
    IFS=',' read -ra LEVEL_ARRAY <<< "$levels"
    local level_count=${#LEVEL_ARRAY[@]}
    local total=0
    for level in "${LEVEL_ARRAY[@]}"; do
        total=$((total + level))
    done
    
    print_separator
    echo -e "${GREEN}3003租户多级下级邀请测试配置${NC}"
    print_separator
    echo "租户ID:        3003"
    echo "租户名称:      租户3003"
    echo "总代邀请码:    QRVJ5RN"
    echo "区号:          52"
    echo "前台域名:      https://arplatsaassit3.club"
    echo "后台域名:      https://arsitasdfghj.com"
    echo "层级配置:      $levels"
    echo "层级数:        $level_count"
    echo "总用户数:      $total"
    echo "测试文件:      k6/tests/api/invite/runInviteByTenant.test.js"
    print_separator
}

# 解析层级配置
parse_levels() {
    local levels=$1
    
    if [ -z "$levels" ]; then
        levels="2,2"
        print_warning "未指定层级配置，使用默认配置: $levels"
    fi
    
    # 验证层级配置格式
    if ! echo "$levels" | grep -qE '^[0-9]+(,[0-9]+)*$'; then
        print_error "层级配置格式错误: $levels"
        print_info "正确格式示例: 2,2,3 或 3,3,3,3"
        exit 1
    fi
    
    # 只返回层级配置字符串
    printf "%s" "$levels"
}

# 执行测试
run_test() {
    local levels=$1
    
    print_info "开始执行测试..."
    print_separator
    
    # 执行k6测试
    k6 run \
        -e TENANT_ID=3003 \
        -e ROOT_INVITE_CODE=QRVJ5RN \
        -e LEVELS="$levels" \
        k6/tests/api/invite/runInviteByTenant.test.js
    
    local exit_code=$?
    
    print_separator
    
    if [ $exit_code -eq 0 ]; then
        print_success "测试执行完成！"
    else
        print_error "测试执行失败，退出码: $exit_code"
        exit $exit_code
    fi
}

# 主函数
main() {
    print_separator
    echo -e "${GREEN}3003租户多级下级邀请测试脚本${NC}"
    print_separator
    echo ""
    
    # 检查环境
    check_k6
    check_test_file
    echo ""
    
    # 解析参数
    local levels=$(parse_levels "$1")
    echo ""
    
    # 打印配置
    print_config "$levels"
    echo ""
    
    # 确认执行
    read -p "确认执行测试？(y/n): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_warning "测试已取消"
        exit 0
    fi
    echo ""
    
    # 执行测试
    run_test "$levels"
    echo ""
    
    print_separator
    print_success "所有操作完成！"
    print_separator
}

# 执行主函数
main "$@"
