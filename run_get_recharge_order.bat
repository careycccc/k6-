@echo off
REM GetRechargeOrderPageList 接口测试脚本 (Windows)
REM 
REM 功能：查询指定用户的充值订单列表（默认查询昨天的数据）
REM 
REM 使用方法：
REM 1. 基本用法（使用默认用户ID 110655）
REM    run_get_recharge_order.bat
REM 
REM 2. 指定用户ID
REM    run_get_recharge_order.bat 110655
REM 
REM 3. 指定租户ID和用户ID
REM    set TENANT_ID=3004 && run_get_recharge_order.bat 110655

REM 默认配置
set DEFAULT_TENANT_ID=3004
set DEFAULT_USER_ID=110655

REM 从环境变量或参数获取配置
if "%TENANT_ID%"=="" set TENANT_ID=%DEFAULT_TENANT_ID%
if "%1"=="" (
    set USER_ID=%DEFAULT_USER_ID%
) else (
    set USER_ID=%1
)

echo ==========================================
echo GetRechargeOrderPageList 接口测试
echo ==========================================
echo 租户ID: %TENANT_ID%
echo 用户ID: %USER_ID%
echo ==========================================
echo.

REM 运行测试
k6 run -e TENANT_ID=%TENANT_ID% -e USER_ID=%USER_ID% k6/tests/api/recharge/getRechargeOrderPageList.test.js

echo.
echo ==========================================
echo 测试完成
echo ==========================================
