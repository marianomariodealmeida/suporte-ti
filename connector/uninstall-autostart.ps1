$ErrorActionPreference = "SilentlyContinue"
$taskName = "SuporteTI-Connector"
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Host "Tarefa '$taskName' removida." -ForegroundColor Green
