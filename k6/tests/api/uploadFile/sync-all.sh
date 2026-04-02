#!/bin/bash

# Figma 图片同步主控脚本

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           Figma 图片同步主控系统                                ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
    echo -e "${YELLOW}使用方法:${NC}"
    echo ""
    echo "  ./sync-all.sh [选项]"
    echo ""
    echo -e "${YELLOW}选项:${NC}"
    echo "  --dry-run       预览模式，不实际删除或下载"
    echo "  --skip-clean    跳过清空图片步骤"
    echo "  --task=NAME     只处理指定任务"
    echo "  --help, -h      显示帮助信息"
    echo ""
    echo -e "${YELLOW}示例:${NC}"
    echo "  ./sync-all.sh                    # 完整流程"
    echo "  ./sync-all.sh --dry-run          # 预览模式"
    echo "  ./sync-all.sh --task=systemActive # 只处理 systemActive"
    echo ""
    exit 0
fi

cd "$SCRIPT_DIR/figma-sync"
node master.js "$@"
