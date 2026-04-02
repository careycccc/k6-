#!/bin/bash

# 系统活动任务测试脚本

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           系统活动任务测试                                      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# 检查配置文件
if [ ! -f "$SCRIPT_DIR/figma-sync/config/global-config.json" ]; then
    echo -e "${YELLOW}⚠️  配置文件不存在，正在创建...${NC}"
    
    if [ -f "$SCRIPT_DIR/figma-sync/config/global-config.example.json" ]; then
        cp "$SCRIPT_DIR/figma-sync/config/global-config.example.json" "$SCRIPT_DIR/figma-sync/config/global-config.json"
        echo -e "${GREEN}✅ 已创建配置文件${NC}"
        echo -e "${YELLOW}请编辑配置文件后再运行:${NC}"
        echo "   vim figma-sync/config/global-config.json"
        echo ""
        exit 1
    else
        echo -e "${RED}❌ 配置示例文件不存在${NC}"
        exit 1
    fi
fi

cd "$SCRIPT_DIR/figma-sync/tasks"
node systemActive-test.js
