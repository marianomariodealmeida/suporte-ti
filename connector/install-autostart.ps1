$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "start-connector-background.ps1"
$taskName = "SuporteTI-Connector"

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -File `"$script`""

$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Conector do Suporte TI (WhatsApp → Supabase)" `
  -Force | Out-Null

Write-Host "Tarefa '$taskName' registrada para iniciar no logon." -ForegroundColor Green
