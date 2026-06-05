# 导出租户会员账号为 CSV (PowerShell版本)
# 用法: .\exportAccounts.ps1 -TenantId 3004 -PageSize 100

param(
    [Parameter(Mandatory=$true)]
    [string]$TenantId,
    
    [Parameter(Mandatory=$false)]
    [int]$PageSize = 100
)

$OutputFile = "..\..\..\data\csv\accounts.csv"

Write-Host ""
Write-Host "========================================"
Write-Host "导出租户 $TenantId 会员账号"
Write-Host "========================================"
Write-Host ""

# 运行k6并捕获输出
$output = k6 run -e TENANT_ID=$TenantId -e PAGE_SIZE=$PageSize exportAccounts.test.js 2>&1 | Out-String

# 显示k6执行日志
Write-Host $output

# 提取CSV内容（从"userName,loginType,remark"开始）
if ($output -match '(?s)(userName,loginType,remark.+?)(?=\n\n|\n=|$)') {
    $csvContent = $matches[1].Trim()
    
    # 写入文件（UTF-8无BOM）
    [System.IO.File]::WriteAllText((Resolve-Path $OutputFile), $csvContent, [System.Text.UTF8Encoding]::new($false))
    
    Write-Host ""
    Write-Host "========================================"
    Write-Host "✅ 成功写入: $OutputFile"
    Write-Host "========================================"
    Write-Host ""
    Write-Host "预览前3行:"
    Get-Content $OutputFile -First 3
} else {
    Write-Host ""
    Write-Host "========================================"
    Write-Host "❌ 未找到CSV内容，请检查k6输出"
    Write-Host "========================================"
}
