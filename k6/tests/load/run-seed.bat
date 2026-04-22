@echo off
chcp 65001 > nul
setlocal

REM ============================================================
REM Redis + K6 Seed 自动启动脚本 (Windows)
REM 用法: run-seed.bat [TENANT_ID] [SEED_MODE] [USER_COUNT] [INVITE_CODE]
REM 示例: run-seed.bat 3004 flat 10 3EPLRGNERRO
REM ============================================================

set TENANT_ID=%~1
set SEED_MODE=%~2
set USER_COUNT=%~3
set INVITE_CODE=%~4

if "%TENANT_ID%"=="" set TENANT_ID=3004
if "%SEED_MODE%"=="" set SEED_MODE=flat
if "%USER_COUNT%"=="" set USER_COUNT=10
if "%REDIS_URL%"=="" set REDIS_URL=redis://localhost:6379

echo 🔍 检查 Redis 是否运行...
redis-cli ping > nul 2>&1
if %errorlevel% neq 0 (
    echo ⚠️  Redis 未运行，正在尝试启动...

    REM 尝试已知安装路径
    set REDIS_BIN=
    for %%p in (
        "D:\TOOLS\Redis-8.6.2-Windows-x64-cygwin-with-Service\Redis-8.6.2-Windows-x64-cygwin-with-Service\redis-server.exe"
        "C:\Program Files\Redis\redis-server.exe"
        "C:\Redis\redis-server.exe"
        "C:\tools\redis\redis-server.exe"
    ) do (
        if exist %%p (
            set REDIS_BIN=%%p
            goto :found
        )
    )

    REM 尝试 PATH 中的 redis-server
    where redis-server > nul 2>&1
    if %errorlevel% equ 0 (
        set REDIS_BIN=redis-server
        goto :found
    )

    echo ❌ 未找到 redis-server，请检查安装路径:
    echo    D:\TOOLS\Redis-8.6.2-Windows-x64-cygwin-with-Service\...
    pause
    exit /b 1

    :found
    echo 📦 找到 Redis: %REDIS_BIN%
    start "Redis Server" /min %REDIS_BIN%
    echo ⏳ 等待 Redis 启动 (3秒)...
    timeout /t 3 /nobreak > nul

    redis-cli ping > nul 2>&1
    if %errorlevel% neq 0 (
        echo ❌ Redis 启动失败，请手动启动后重试
        pause
        exit /b 1
    )
)

echo ✅ Redis 运行正常

echo.
echo 🚀 开始执行数据预热...
echo    TENANT_ID  = %TENANT_ID%
echo    SEED_MODE  = %SEED_MODE%
echo    USER_COUNT = %USER_COUNT%
echo    INVITE_CODE= %INVITE_CODE%
echo    REDIS_URL  = %REDIS_URL%
echo.

k6 run ^
    -e TENANT_ID=%TENANT_ID% ^
    -e SEED_MODE=%SEED_MODE% ^
    -e USER_COUNT=%USER_COUNT% ^
    -e INVITE_CODE=%INVITE_CODE% ^
    -e REDIS_URL=%REDIS_URL% ^
    seed.tokenPool.js

echo.
echo ✅ 预热完成
pause
