                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    # Setup Piper CPU di mesin backend (Windows).
# Voice custom nanti: taruh namira.onnx + namira.onnx.json di backend\piper_data\models\
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Split-Path -Parent $ScriptDir
$PiperDir = if ($env:PIPER_DIR) { $env:PIPER_DIR } else { Join-Path $BackendDir "piper_data" }
$VenvDir = Join-Path $PiperDir "env"
$ModelsDir = Join-Path $PiperDir "models"
$VoiceId = if ($env:PIPER_VOICE) { $env:PIPER_VOICE } else { "id_ID-news_tts-medium" }
$HostId = if ($env:PIPER_DEFAULT_HOST) { $env:PIPER_DEFAULT_HOST } else { "namira" }
$HfBase = "https://huggingface.co/rhasspy/piper-voices/resolve/main/id/id_ID/news_tts/medium"

Write-Host "============================================================"
Write-Host " Piper TTS setup (CPU, backend)"
Write-Host " Dir: $PiperDir"
Write-Host "============================================================"

New-Item -ItemType Directory -Force -Path $PiperDir, $ModelsDir, (Join-Path $PiperDir "logs") | Out-Null
Copy-Item -Force (Join-Path $ScriptDir "requirements.txt") (Join-Path $PiperDir "requirements.txt")

$Py = Get-Command python -ErrorAction SilentlyContinue
if (-not $Py) { $Py = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $Py) { throw "Python tidak ditemukan. Install Python 3.10+ lalu ulangi." }

$PythonExe = Join-Path $VenvDir "Scripts\python.exe"
if (-not (Test-Path $PythonExe)) {
    Write-Host "[*] Membuat venv..."
    & $Py.Source -m venv $VenvDir
}

& $PythonExe -m pip install --upgrade pip wheel
& $PythonExe -m pip install --no-cache-dir -r (Join-Path $PiperDir "requirements.txt")

$Onnx = Join-Path $ModelsDir "$VoiceId.onnx"
$Json = Join-Path $ModelsDir "$VoiceId.onnx.json"
if (-not (Test-Path $Onnx) -or -not (Test-Path $Json)) {
    Write-Host "[*] Download voice $VoiceId ..."
    Invoke-WebRequest -Uri "$HfBase/$VoiceId.onnx" -OutFile $Onnx -UseBasicParsing
    Invoke-WebRequest -Uri "$HfBase/$VoiceId.onnx.json" -OutFile $Json -UseBasicParsing
}

$HostOnnx = Join-Path $ModelsDir "$HostId.onnx"
$HostJson = Join-Path $ModelsDir "$HostId.onnx.json"
if (-not (Test-Path $HostOnnx)) {
    Copy-Item -Force $Onnx $HostOnnx
}
if (-not (Test-Path $HostJson)) {
    Copy-Item -Force $Json $HostJson
}

Get-Date -Format o | Set-Content -Encoding utf8 (Join-Path $PiperDir ".setup_complete")
Write-Host "[OK] Setup selesai. Backend yang menjalankan Piper (tanpa port 8090)."
Write-Host "     Custom voice: $ModelsDir\$HostId.onnx (+ .onnx.json)"
Write-Host "============================================================"
