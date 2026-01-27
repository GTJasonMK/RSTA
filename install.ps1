# RSTA 一键安装脚本 (Windows PowerShell)
# 使用 uv 进行快速包管理

$ErrorActionPreference = "Stop"

# 项目配置
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvName = ".venv-hymt-gguf"
$VenvDir = Join-Path $ScriptDir $VenvName
$WebUIDir = Join-Path $ScriptDir "web-ui"

function Log-Info { param($msg) Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Log-Success { param($msg) Write-Host "[SUCCESS] $msg" -ForegroundColor Green }
function Log-Warning { param($msg) Write-Host "[WARNING] $msg" -ForegroundColor Yellow }
function Log-Error { param($msg) Write-Host "[ERROR] $msg" -ForegroundColor Red }

Write-Host "==================================================" -ForegroundColor White
Write-Host "RSTA 一键安装脚本" -ForegroundColor White
Write-Host "==================================================" -ForegroundColor White
Write-Host ""

# 检查 Python 版本
try {
    $pythonVersion = python --version 2>&1
    Log-Success "Python 版本: $pythonVersion"
} catch {
    Log-Error "未检测到 Python，请先安装 Python 3.10+"
    exit 1
}

# 检查 Node.js
try {
    $nodeVersion = node --version 2>&1
    Log-Success "Node.js 版本: $nodeVersion"
} catch {
    Log-Error "未检测到 Node.js，请先安装: https://nodejs.org/"
    exit 1
}

# 检查并安装 uv
$uvPath = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uvPath) {
    Log-Warning "未检测到 uv，开始安装..."

    try {
        # 使用官方安装脚本
        Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression

        # 刷新环境变量
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

        # 重新检查
        $uvPath = Get-Command uv -ErrorAction SilentlyContinue
        if (-not $uvPath) {
            Log-Warning "uv 安装后需要重新打开 PowerShell"
            Log-Info "或运行: `$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')"
            exit 1
        }
    } catch {
        Log-Warning "官方安装失败，尝试使用 pip 安装..."
        try {
            python -m pip install uv
        } catch {
            Log-Error "uv 安装失败，请手动安装: pip install uv"
            exit 1
        }
    }
}
Log-Success "uv 已安装"

Write-Host ""

# 创建虚拟环境
Log-Info "创建虚拟环境: $VenvDir"
try {
    uv venv $VenvDir --python 3.10
} catch {
    Log-Warning "指定 Python 3.10 失败，使用默认版本..."
    uv venv $VenvDir
}

# 获取虚拟环境 Python 路径
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"

# 安装 Python 依赖
$RequirementsFile = Join-Path $ScriptDir "requirements.txt"
if (Test-Path $RequirementsFile) {
    Log-Info "安装 Python 依赖..."
    uv pip install -r $RequirementsFile --python $VenvPython
    Log-Success "Python 依赖安装成功"
} else {
    Log-Warning "未找到 requirements.txt"
}

Write-Host ""

# 安装 Node.js 依赖
$PackageJson = Join-Path $WebUIDir "package.json"
$NodeModules = Join-Path $WebUIDir "node_modules"

if ((Test-Path $WebUIDir) -and (Test-Path $PackageJson)) {
    if (-not (Test-Path $NodeModules)) {
        Log-Info "安装前端依赖..."
        Push-Location $WebUIDir
        npm install
        Pop-Location
        Log-Success "前端依赖安装成功"
    } else {
        Log-Info "node_modules 已存在，跳过安装"
    }
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor White
Log-Success "安装完成!"
Write-Host "==================================================" -ForegroundColor White
Write-Host ""
Write-Host "后续步骤:" -ForegroundColor White
Write-Host "--------------------------------------------------" -ForegroundColor Gray
Write-Host "1. 激活虚拟环境: $VenvName\Scripts\activate" -ForegroundColor White
Write-Host "2. 启动应用: python start.py" -ForegroundColor White
Write-Host "--------------------------------------------------" -ForegroundColor Gray
Write-Host ""
Write-Host "或者直接运行一键启动脚本:" -ForegroundColor White
Write-Host "  python start.py" -ForegroundColor Yellow
Write-Host ""

# 询问是否立即启动
$response = Read-Host "是否立即启动应用? (y/N)"
if ($response -eq "y" -or $response -eq "Y") {
    Log-Info "启动应用..."
    python (Join-Path $ScriptDir "start.py")
}
