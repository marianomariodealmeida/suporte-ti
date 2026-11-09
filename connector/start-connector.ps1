$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot
try {
  Write-Host "Iniciando conector Suporte TI (Ctrl+C para parar)…" -ForegroundColor Cyan
  node src/index.mjs
} finally {
  Pop-Location
}
