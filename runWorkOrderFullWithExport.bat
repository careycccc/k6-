@echo off
REM 工单全流程测试 - 自动导出账号 + 运行测试
REM 用法: runWorkOrderFullWithExport.bat 3004 1
REM 参数1: TENANT_ID (必填)
REM 参数2: ACCOUNT_COUNT (可选，默认1)

setlocal

set TENANT_ID=%1
set ACCOUNT_COUNT=%2

if "%TENANT_ID%"=="" (
    echo [错误] 缺少租户ID参数
    echo 用法: runWorkOrderFullWithExport.bat 3004 1
    exit /b 1
)

if "%ACCOUNT_COUNT%"=="" set ACCOUNT_COUNT=1

echo.
echo ========================================
echo 步骤 1/2: 导出租户 %TENANT_ID% 会员账号
echo ========================================
echo.

k6 run -e TENANT_ID=%TENANT_ID% -e OUTPUT_MODE=csv k6\tests\api\presetup\exportAccounts.test.js > k6\data\csv\accounts.csv 2>&1

if %ERRORLEVEL% NEQ 0 (
    echo [错误] 账号导出失败
    pause
    exit /b 1
)

echo [成功] 账号已导出到 k6\data\csv\accounts.csv
echo.
echo ========================================
echo 步骤 2/2: 运行工单全流程测试
echo ========================================
echo.

cd k6\tests\api\activity\workOrderSuite
k6 run -e TENANT_ID=%TENANT_ID% -e ACCOUNT_COUNT=%ACCOUNT_COUNT% runWorkOrderFull.test.js

cd ..\..\..\..

echo.
echo ========================================
echo 完成
echo ========================================
pause
