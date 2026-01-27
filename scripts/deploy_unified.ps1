<#
统一 OCR + 翻译服务部署脚本 (Windows)
启动 serve_unified.py 提供 OCR 和翻译的 HTTP API
#>

param(
    [string]$Host = "127.0.0.1",
    [int]$Port = 8092,
    [string]$PreloadOcr = "",
    [string]$OcrLang = "en",
    [string]$ModelRepo = "tencent/HY-MT1.5-1.8B-GGUF",
    [string]$Quant = "Q6_K",
    [string]$VenvName = ".venv-unified"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$VenvPath = Join-Path $ProjectRoot $VenvName
$PythonExe = Join-Path $VenvPath "Scripts\python.exe"
$PipExe = Join-Path $VenvPath "Scripts\pip.exe"
$ServeScript = Join-Path $ScriptDir "serve_unified.py"

Write-Host "[INFO] 项目根目录: $ProjectRoot"
Write-Host "[INFO] 虚拟环境路径: $VenvPath"

# 检查虚拟环境
if (-not (Test-Path $PythonExe)) {
    Write-Host "[INFO] 创建虚拟环境..."
    python -m venv $VenvPath
    if (-not $?) {
        Write-Error "虚拟环境创建失败"
        exit 1
    }
}

# 检查并安装依赖
Write-Host "[INFO] 检查依赖..."

$RequiredPackages = @(
    "fastapi",
    "uvicorn",
    "pydantic",
    "llama-cpp-python",
    "huggingface_hub",
    "paddlepaddle",
    "paddleocr",
    "paddlex",
    "pillow",
    "numpy"
)

foreach ($pkg in $RequiredPackages) {
    $CheckCmd = "& `"$PythonExe`" -c `"import $($pkg.Replace('-', '_').Split('[')[0])`" 2>&1"
    $result = Invoke-Expression $CheckCmd 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[INFO] 安装 $pkg..."
        & $PipExe install $pkg -q
    }
}

# 设置环境变量
$env:HOST = $Host
$env:PORT = $Port
$env:MODEL_REPO = $ModelRepo
$env:QUANT = $Quant
$env:OCR_LANG = $OcrLang

if ($PreloadOcr) {
    $env:PRELOAD_OCR = $PreloadOcr
}

Write-Host ""
Write-Host "=========================================="
Write-Host "  统一 OCR + 翻译服务"
Write-Host "=========================================="
Write-Host "  地址: http://${Host}:${Port}"
Write-Host "  OCR 预加载: $PreloadOcr"
Write-Host "  翻译模型: $ModelRepo ($Quant)"
Write-Host "=========================================="
Write-Host ""

# 启动服务
& $PythonExe $ServeScript
