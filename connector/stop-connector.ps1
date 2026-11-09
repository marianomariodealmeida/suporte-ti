$ErrorActionPreference = "SilentlyContinue"
$root = $PSScriptRoot
$pidFile = Join-Path $root "data\connector.pid"

if (Test-Path $pidFile) {
  $processId = Get-Content $pidFile
  if ($processId) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) {
      Stop-Process -Id $processId -Force
      Write-Host "Conector parado (PID $processId)." -ForegroundColor Green
    } else {
      Write-Host "O processo $processId não estava rodando." -ForegroundColor Yellow
    }
  }
  Remove-Item $pidFile -Force
} else {
  Write-Host "Nenhum PID encontrado em $pidFile." -ForegroundColor Yellow
}
