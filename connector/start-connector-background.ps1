$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$logDir = Join-Path $root "logs"
$dataDir = Join-Path $root "data"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

$pidFile = Join-Path $dataDir "connector.pid"
if (Test-Path $pidFile) {
  $existing = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($existing -and (Get-Process -Id $existing -ErrorAction SilentlyContinue)) {
    Write-Host "O conector já está rodando (PID $existing)." -ForegroundColor Yellow
    exit 0
  }
}

$node = (Get-Command node).Source
$process = Start-Process `
  -FilePath $node `
  -ArgumentList "src/index.mjs" `
  -WorkingDirectory $root `
  -RedirectStandardOutput (Join-Path $logDir "connector.out.log") `
  -RedirectStandardError (Join-Path $logDir "connector.err.log") `
  -PassThru `
  -WindowStyle Hidden

$process.Id | Set-Content $pidFile
Write-Host "Conector iniciado em segundo plano (PID $($process.Id))." -ForegroundColor Green
Write-Host "Logs: $logDir"
