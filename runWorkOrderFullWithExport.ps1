# 工单全流程测试 - 自动导出账号 + 运行测试
# 用法: .\runWorkOrderFullWithExport.ps1 -TenantId 3004 -AccountCount 1

param(
    [Parameter(Mandatory=$true)]
    [string]$TenantId,
    
    [Parameter(Mandatory=$false)]
    [int]$AccountCount = 1
)

Write-Host ""
Write-Host "========================================"
Write-Host "步骤 1/2: 导出租户 $TenantId 会员账号"
Write-Host "========================================"
Write-Host ""

# 导出账号到 CSV
$exportCmd = "k6 run -e TENANT_ID=$TenantId -e OUTPUT_MODE=csv k6\tests\api\presetup\exportAccounts.test.js"
$csvContent = Invoke-Expression $exportCmd 2>&1 | Out-String

# 写入 CSV 文件
$csvPath = "k6\data\csv\accounts.csv"
[System.IO.File]::WriteAllText((Resolve-Path $csvPath), $csvContent.Trim(), [System.Text.UTF8Encoding]::new($false))

Write-Host "✅ 账号已导出到 $csvPath"
Write-Host ""
Write-Host "预览前 3 行:"
Get-Content $csvPath -First 3

Write-Host ""
Write-Host "========================================"
Write-Host "步骤 2/2: 运行工单全流程测试"
Write-Host "========================================"
Write-Host ""

# 运行工单测试
Set-Location "k6\tests\api\activity\workOrderSuite"
k6 run -e TENANT_ID=$TenantId -e ACCOUNT_COUNT=$AccountCount runWorkOrderFull.test.js
Set-Location "..\..\..\..\"

Write-Host ""
Write-Host "========================================"
Write-Host "完成"
Write-Host "========================================"
