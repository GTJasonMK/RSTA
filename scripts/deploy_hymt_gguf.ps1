param(
    [string]$Quant = "Q6_K",
    [int]$Port = 8092
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Resolve-Path (Join-Path $root "..")
$venv = Join-Path $repo ".venv-hymt-gguf"
$python = Join-Path $venv "Scripts\python.exe"
$requirements = Join-Path $root "requirements-hymt-gguf.txt"
$server = Join-Path $root "serve_hymt_gguf.py"

if (-not (Test-Path $venv)) {
    python -m venv $venv
}

& $python -m pip install --upgrade pip
& $python -m pip install -r $requirements

$env:MODEL_REPO = "tencent/HY-MT1.5-1.8B-GGUF"
$env:MODEL_DIR = (Join-Path $repo "models")
$env:QUANT = $Quant
$env:PORT = "$Port"
$env:N_THREADS = "$([Math]::Max([Environment]::ProcessorCount - 1, 1))"
$env:N_CTX = "4096"
$env:MAX_NEW_TOKENS = "256"

& $python $server
