#!/bin/bash
# Redis + K6 Seed 自动启动脚本
# 用法: ./run-seed-with-redis.sh

echo "🔍 检查 Redis 是否运行..."

# 检查 Redis 是否已启动
if ! redis-cli ping > /dev/null 2>&1; then
    echo "⚠️  Redis 未运行，正在启动..."
    
    # Windows 环境下启动 Redis
    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
        # 检查 Redis 是否安装
        if command -v redis-server &> /dev/null; then
            start redis-server &
            echo "⏳ 等待 Redis 启动..."
            sleep 3
        else
            echo "❌ 错误: 未找到 redis-server，请先安装 Redis"
            echo "   下载地址: https://github.com/tporadowski/redis/releases"
            exit 1
        fi
    else
        # Linux/Mac 环境
        if command -v redis-server &> /dev/null; then
            redis-server --daemonize yes
            echo "⏳ 等待 Redis 启动..."
            sleep 2
        else
            echo "❌ 错误: 未找到 redis-server，请先安装 Redis"
            exit 1
        fi
    fi
    
    # 再次检查
    if ! redis-cli ping > /dev/null 2>&1; then
        echo "❌ Redis 启动失败"
        exit 1
    fi
fi

echo "✅ Redis 运行正常"

# 运行 K6 seed 脚本
echo "🚀 开始执行数据预热..."
k6 run \
    -e TENANT_ID="${TENANT_ID:-3004}" \
    -e SEED_MODE="${SEED_MODE:-flat}" \
    -e USER_COUNT="${USER_COUNT:-10}" \
    -e INVITE_CODE="${INVITE_CODE:-}" \
    -e REDIS_URL="${REDIS_URL:-redis://localhost:6379}" \
    seed.tokenPool.js

echo "✅ 预热完成"
