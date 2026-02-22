#!/bin/bash

# 数据清理脚本（不运行测试）
# 功能：
# 1. 清理 InfluxDB 旧数据（保留最近2次）
# 2. 清理报告文件（保留最近2次）

# 获取脚本所在目录的父目录（项目根目录）
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# 切换到项目根目录
cd "$PROJECT_ROOT" || exit 1

# 配置
INFLUXDB_URL="http://localhost:8086"
INFLUXDB_DB="k6"
KEEP_LAST_N=2
REPORTS_DIR="reports"

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║              数据清理脚本                                    ║"
echo "╠═══════════════════════════════════════════════════════════╣"
echo "║  1. 清理 InfluxDB 旧数据（保留最近 ${KEEP_LAST_N} 次）                  ║"
echo "║  2. 清理报告文件（保留最近 ${KEEP_LAST_N} 次）                        ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# ============================================
# 步骤 1: 清理 InfluxDB 旧数据
# ============================================
echo -e "${BLUE}[1/2] 清理 InfluxDB 旧数据...${NC}"
echo ""

# 获取所有 testid
TESTIDS=$(curl -s -G "${INFLUXDB_URL}/query" \
    --data-urlencode "db=${INFLUXDB_DB}" \
    --data-urlencode "q=SHOW TAG VALUES WITH KEY = \"testid\"" \
    | grep -o '"value":"[^"]*"' \
    | sed 's/"value":"//g' \
    | sed 's/"//g')

if [ -z "$TESTIDS" ]; then
    echo -e "${GREEN}✓ InfluxDB 中没有测试数据，无需清理${NC}"
else
    TESTID_COUNT=$(echo "$TESTIDS" | wc -l | tr -d ' ')
    echo "找到 $TESTID_COUNT 个测试记录"
    
    if [ "$TESTID_COUNT" -le "$KEEP_LAST_N" ]; then
        echo -e "${GREEN}✓ 测试数量 ($TESTID_COUNT) <= 保留数量 ($KEEP_LAST_N)，无需清理${NC}"
    else
        # 获取每个 testid 的最新时间戳并排序
        declare -A testid_times
        
        for testid in $TESTIDS; do
            # 获取该 testid 的最新时间
            LAST_TIME=$(curl -s -G "${INFLUXDB_URL}/query" \
                --data-urlencode "db=${INFLUXDB_DB}" \
                --data-urlencode "q=SELECT LAST(\"value\") FROM \"http_req_duration\" WHERE \"testid\" = '$testid'" \
                | grep -o '"time":"[^"]*"' \
                | head -1 \
                | sed 's/"time":"//g' \
                | sed 's/"//g')
            
            if [ -n "$LAST_TIME" ]; then
                # 转换为时间戳（秒）
                TIMESTAMP=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$(echo $LAST_TIME | cut -d'.' -f1)" "+%s" 2>/dev/null || echo "0")
                testid_times[$testid]=$TIMESTAMP
            fi
        done
        
        # 按时间排序（最新的在前）
        SORTED_TESTIDS=$(for testid in "${!testid_times[@]}"; do
            echo "${testid_times[$testid]} $testid"
        done | sort -rn | awk '{print $2}')
        
        # 保留最近 N 个
        KEEP_TESTIDS=$(echo "$SORTED_TESTIDS" | head -n "$KEEP_LAST_N")
        DELETE_TESTIDS=$(echo "$SORTED_TESTIDS" | tail -n +$((KEEP_LAST_N + 1)))
        
        if [ -n "$DELETE_TESTIDS" ]; then
            echo ""
            echo "保留的测试:"
            echo "$KEEP_TESTIDS" | while read -r testid; do
                echo "  ✓ $testid"
            done
            
            echo ""
            echo "将要删除的测试:"
            echo "$DELETE_TESTIDS" | while read -r testid; do
                echo "  ✗ $testid"
            done
            
            echo ""
            read -p "确认删除以上测试数据? (y/n) " -n 1 -r
            echo ""
            
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                # 执行删除
                DELETED_COUNT=0
                echo ""
                echo "开始删除..."
                echo "$DELETE_TESTIDS" | while read -r testid; do
                    curl -s -X POST "${INFLUXDB_URL}/query" \
                        --data-urlencode "db=${INFLUXDB_DB}" \
                        --data-urlencode "q=DROP SERIES WHERE \"testid\" = '$testid'" > /dev/null
                    
                    echo -e "${GREEN}✓ 删除测试: $testid${NC}"
                    DELETED_COUNT=$((DELETED_COUNT + 1))
                done
                
                DELETE_COUNT=$(echo "$DELETE_TESTIDS" | wc -l | tr -d ' ')
                echo ""
                echo -e "${GREEN}✓ InfluxDB 清理完成，删除了 ${DELETE_COUNT} 个旧测试${NC}"
            else
                echo -e "${YELLOW}⚠ 取消删除 InfluxDB 数据${NC}"
            fi
        else
            echo -e "${GREEN}✓ 无需删除数据${NC}"
        fi
    fi
fi

echo ""

# ============================================
# 步骤 2: 清理报告文件
# ============================================
echo -e "${BLUE}[2/2] 清理报告文件...${NC}"
echo ""

if [ ! -d "$REPORTS_DIR" ]; then
    echo -e "${GREEN}✓ 报告目录不存在，无需清理${NC}"
else
    # 获取所有报告文件的时间戳
    TIMESTAMPS=$(ls -1 "$REPORTS_DIR"/batch-report-*.html 2>/dev/null | sed 's/.*batch-report-//' | sed 's/\.html//' | sort -r)
    
    if [ -z "$TIMESTAMPS" ]; then
        echo -e "${GREEN}✓ 没有找到报告文件，无需清理${NC}"
    else
        REPORT_COUNT=$(echo "$TIMESTAMPS" | wc -l | tr -d ' ')
        echo "找到 $REPORT_COUNT 次测试的报告文件"
        
        if [ "$REPORT_COUNT" -le "$KEEP_LAST_N" ]; then
            echo -e "${GREEN}✓ 报告数量 ($REPORT_COUNT) <= 保留数量 ($KEEP_LAST_N)，无需清理${NC}"
        else
            # 保留最近 N 个，删除其余的
            KEEP_TIMESTAMPS=$(echo "$TIMESTAMPS" | head -n "$KEEP_LAST_N")
            DELETE_TIMESTAMPS=$(echo "$TIMESTAMPS" | tail -n +$((KEEP_LAST_N + 1)))
            
            echo ""
            echo "保留的报告:"
            echo "$KEEP_TIMESTAMPS" | while read -r ts; do
                echo "  ✓ $ts"
            done
            
            echo ""
            echo "将要删除的报告:"
            echo "$DELETE_TIMESTAMPS" | while read -r ts; do
                echo "  ✗ $ts"
            done
            
            echo ""
            read -p "确认删除以上报告文件? (y/n) " -n 1 -r
            echo ""
            
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                # 执行删除
                echo ""
                echo "开始删除..."
                echo "$DELETE_TIMESTAMPS" | while read -r ts; do
                    rm -f "$REPORTS_DIR/batch-report-${ts}.html" "$REPORTS_DIR/batch-report-${ts}-summary.json"
                    echo -e "${GREEN}✓ 删除报告: $ts${NC}"
                done
                
                DELETE_COUNT=$(echo "$DELETE_TIMESTAMPS" | wc -l | tr -d ' ')
                echo ""
                echo -e "${GREEN}✓ 报告文件清理完成，删除了 ${DELETE_COUNT} 次测试的报告${NC}"
            else
                echo -e "${YELLOW}⚠ 取消删除报告文件${NC}"
            fi
        fi
    fi
fi

echo ""

# ============================================
# 总结
# ============================================
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║                  清理完成                                    ║"
echo "╠═══════════════════════════════════════════════════════════╣"
echo "║  ✓ 数据清理操作已完成                                       ║"
echo "║                                                             ║"
echo "║  查看当前数据:                                              ║"
echo "║  - InfluxDB: curl -G '${INFLUXDB_URL}/query' \\              ║"
echo "║              --data-urlencode 'db=${INFLUXDB_DB}' \\         ║"
echo "║              --data-urlencode 'q=SHOW TAG VALUES WITH KEY = \"testid\"'  ║"
echo "║  - 报告文件: ls -lh ${REPORTS_DIR}/                          ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
