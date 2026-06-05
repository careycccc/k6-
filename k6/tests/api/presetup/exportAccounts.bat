@echo off
REM 导出租户会员账号为 CSV (Windows批处理版本)
REM 用法: exportAccounts.bat 3004 100
REM 参数1: TENANT_ID (必填)
REM 参数2: PAGE_SIZE (可选，默认100)

setlocal

set TENANT_ID=%1
set PAGE_SIZE=%2

if "%TENANT_ID%"=="" (
    echo [错误] 缺少租户ID参数
    echo 用法: exportAccounts.bat 3004 100
    exit /b 1
)

if "%PAGE_SIZE%"=="" set PAGE_SIZE=100

set OUTPUT_FILE=..\..\..\data\csv\accounts.csv

echo.
echo ========================================
echo 导出租户 %TENANT_ID% 会员账号
echo ========================================
echo.

REM 运行k6并捕获输出
k6 run -e TENANT_ID=%TENANT_ID% -e PAGE_SIZE=%PAGE_SIZE% exportAccounts.test.js > temp_output.txt 2>&1

REM 提取CSV内容（从"userName,loginType,remark"开始到最后一个有效行）
powershell -Command "$content = Get-Content temp_output.txt -Raw; if ($content -match '(?s)userName,loginType,remark.*?(?=\n\n|$)') { $matches[0] | Out-File -FilePath '%OUTPUT_FILE%' -Encoding utf8 -NoNewline; Write-Host '[成功] CSV已写入: %OUTPUT_FILE%' } else { Write-Host '[失败] 未找到CSV内容，请检查输出'; Get-Content temp_output.txt }"

REM 清理临时文件
del temp_output.txt

echo.
echo ========================================
echo 完成
echo ========================================
pause
