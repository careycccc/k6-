#!/bin/bash

###############################################################################
# Figma 图片同步脚本
# 
# 功能：从 Figma 自动下载并更新项目中的活动图片
# 
# 使用方法：
#   ./sync-figma.sh                    # 同步所有图片
#   ./sync-figma.sh banner             # 只同步 banner 分类
#   ./sync-figma.sh --help             # 显示帮助信息
# 
# 环境变量：
#   FIGMA_ACCESS_TOKEN  Figma 访问令牌（可选，优先级高于配置文件）
###############################################################################

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 脚本目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYNC_SCRIPT="$SCRIPT_DIR/sync-figma-images.js"

# 显示帮助信息
show_help() {
    echo ""
    echo "Figma 图片同步工具"
    echo ""
    echo "使用方法:"
    echo "  ./sync-figma.sh                    # 同步所有图片"
    echo "  ./sync-figma.sh banner             # 只同步指定分类"
    echo "  ./sync-figma.sh --help             # 显示此帮助信息"
    echo ""
    echo "可用分类:"
    echo "  banner, champion, customisablepopup, dailyTasks, faq,"
    echo "  inmail, loginafter, order, outlink, rechargegiftpack,"
    echo "  rechargeWheel, rescue, signin, systemActive"
    echo ""
    echo "环境变量:"
    echo "  FIGMA_ACCESS_TOKEN  Figma 访问令牌（可选）"
    echo ""
    echo "配置文件:"
    echo "  figma-sync-config.json  配置 Figma 文件和图片映射关系"
    echo ""
}

# 检查 Node.js
check_nodejs() {
    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ 错误: 未找到 Node.js${NC}"
        echo -e "${YELLOW}请先安装 Node.js: https://nodejs.org/${NC}"
        exit 1
    fi
}

# 主函数
main() {
    # 检查参数
    if [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
        show_help
        exit 0
    fi

    # 检查 Node.js
    check_nodejs

    # 检查同步脚本
    if [[ ! -f "$SYNC_SCRIPT" ]]; then
        echo -e "${RED}❌ 错误: 找不到同步脚本 $SYNC_SCRIPT${NC}"
        exit 1
    fi

    # 执行同步
    if [[ -n "$1" ]]; then
        echo -e "${BLUE}🔄 同步分类: $1${NC}"
        node "$SYNC_SCRIPT" --category="$1"
    else
        echo -e "${BLUE}🔄 同步所有图片${NC}"
        node "$SYNC_SCRIPT"
    fi
}

# 运行主函数
main "$@"
