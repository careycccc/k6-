#!/bin/bash

# 测试注册脚本
# 用于验证 register-account.js 是否正常工作

echo "========================================="
echo "测试 K6 账号注册服务"
echo "========================================="
echo ""

# 测试1: 注册单个手机号账号（3002平台）
echo "测试1: 注册单个手机号账号（3002平台）"
node scripts/register-account.js --tenant=3002 --type=phone --count=1
echo ""

# 测试2: 注册单个邮箱账号（3003平台）
echo "测试2: 注册单个邮箱账号（3003平台）"
node scripts/register-account.js --tenant=3003 --type=email --count=1
echo ""

# 测试3: 批量注册2个手机号账号（3004平台）
echo "测试3: 批量注册2个手机号账号（3004平台）"
node scripts/register-account.js --tenant=3004 --type=phone --count=2
echo ""

echo "========================================="
echo "测试完成"
echo "========================================="
