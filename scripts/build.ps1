# 打包脚本 - Windows (仅前端)
# 用法: .\scripts\build.ps1

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$WebUIDir = Join-Path $ProjectRoot "web-ui"

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  RSTA Build Script (Frontend)" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Project root: $ProjectRoot"

# 检查 Node.js
$NodeVersion = & node --version 2>$null
if (-not $NodeVersion) {
    Write-Host "[ERROR] Node.js not found. Please install Node.js first." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Node.js: $NodeVersion" -ForegroundColor Green

Write-Host ""
Write-Host "Building Electron frontend..." -ForegroundColor Cyan
Write-Host "----------------------------------------"

# 安装前端依赖并打包
Write-Host "Changing to: $WebUIDir"
Set-Location $WebUIDir
Write-Host "Current directory: $(Get-Location)"

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing npm dependencies..."
    & npm install
    if ($LASTEXITCODE -ne 0) {
        throw "npm install failed"
    }
}

# 构建并打包 Electron 应用
Write-Host "Building and packaging Electron app..."
& npm run dist
if ($LASTEXITCODE -ne 0) {
    throw "Electron build failed"
}
Write-Host "[OK] Frontend built successfully" -ForegroundColor Green

Set-Location $ProjectRoot

Write-Host ""
Write-Host "================================" -ForegroundColor Green
Write-Host "  Build completed!" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host ""
Write-Host "Output directory: $ProjectRoot\release" -ForegroundColor Cyan
Write-Host ""
Write-Host "IMPORTANT: Before running the app, start the backend service:" -ForegroundColor Yellow
Write-Host "  python scripts/serve_unified.py" -ForegroundColor Yellow
Write-Host ""

# 显示输出文件
$ReleaseDir = Join-Path $ProjectRoot "release"
if (Test-Path $ReleaseDir) {
    Write-Host "Release files:"
    Get-ChildItem $ReleaseDir -Recurse -File | Where-Object { $_.Extension -in ".exe", ".msi", ".dmg", ".AppImage" } | ForEach-Object {
        Write-Host "  - $($_.FullName)" -ForegroundColor Yellow
    }
}
