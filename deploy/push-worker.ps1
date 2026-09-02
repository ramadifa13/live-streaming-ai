# Sync deploy/ ke RunPod worker via SCP (tanpa git pull di pod).
# Usage:
#   $env:RUNPOD_HOST = "root@62849fd9ee65-XXXXX-8000.proxy.runpod.net"
#   .\push-worker.ps1
# Atau:
#   .\push-worker.ps1 -Host "root@IP" -Port 22

param(
    [string]$Host = $env:RUNPOD_HOST,
    [int]$Port = [int]($env:RUNPOD_SSH_PORT ?? "22"),
    [string]$RemoteRepo = "/workspace/live-streaming-ai",
    [switch]$Restart
)

$ErrorActionPreference = "Stop"
$DeployDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $Host) {
    Write-Error "Set RUNPOD_HOST atau -Host (contoh: root@IP atau root@xxx.proxy.runpod.net)"
}

$files = @(
    "ai_worker.py", "api_server.py", "rtmp_utils.py", "speech_bridge.py",
    "start.sh", "sync-restart.sh", "sync-worker.sh", "verify_rtmp.py",
    "verify-worker.sh", "redeploy-worker.sh", ".env.example"
)

Write-Host "============================================================"
Write-Host " Push deploy -> $Host`:$RemoteRepo/deploy"
Write-Host "============================================================"

ssh -p $Port $Host "mkdir -p $RemoteRepo/deploy"

foreach ($f in $files) {
    $local = Join-Path $DeployDir $f
    if (-not (Test-Path $local)) {
        Write-Warning "Skip (tidak ada): $f"
        continue
    }
    Write-Host "[SCP] $f"
    scp -P $Port $local "${Host}:${RemoteRepo}/deploy/$f"
}

if ($Restart) {
    Write-Host "[SSH] sync-restart.sh ..."
    ssh -p $Port $Host "bash $RemoteRepo/deploy/sync-restart.sh"
    Write-Host "[SSH] verify_rtmp.py ..."
    ssh -p $Port $Host "cd /workspace/ai_live_worker && python3 verify_rtmp.py"
    Write-Host "[SSH] verify-worker.sh ..."
    ssh -p $Port $Host "bash $RemoteRepo/deploy/verify-worker.sh"
}

Write-Host ""
Write-Host "[OK] Push selesai."
if (-not $Restart) {
    Write-Host "     Restart pod: ssh $Host 'bash $RemoteRepo/deploy/sync-restart.sh'"
}
