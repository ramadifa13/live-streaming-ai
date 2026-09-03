# Start Piper CPU di http://127.0.0.1:8090
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Split-Path -Parent $ScriptDir
$PiperDir = if ($env:PIPER_DIR) { $env:PIPER_DIR } else { Join-Path $BackendDir "piper_data" }
$PythonExe = Join-Path $PiperDir "env\Scripts\python.exe"
$Server = Join-Path $PiperDir "server.py"
if (-not (Test-Path $PythonExe) -or -not (Test-Path $Server)) {
    throw "Piper belum di-setup. Jalankan: npm run piper:setup"
}

$Port = if ($env:PIPER_PORT) { $env:PIPER_PORT } else { "8090" }
$env:PIPER_DIR = $PiperDir
$env:PIPER_MODELS_DIR = Join-Path $PiperDir "models"
if (-not $env:PIPER_VOICE) { $env:PIPER_VOICE = "id_ID-news_tts-medium" }
if (-not $env:PIPER_DEFAULT_HOST) { $env:PIPER_DEFAULT_HOST = "namira" }
$env:PIPER_PORT = $Port

Write-Host "[INFO] Piper CPU $PiperDir port $Port"
Write-Host "[INFO] Custom voice: taruh namira.onnx di $($env:PIPER_MODELS_DIR)"
Set-Location $PiperDir
& $PythonExe -u $Server
