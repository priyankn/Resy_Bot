param(
	[string]$ConfigPath = (Join-Path $PSScriptRoot 'config.json'),
	[string]$TaskName
)
$ErrorActionPreference = 'Stop'
$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if (-not $config.authorizedPolling) { throw 'Polling disabled. Obtain authorization and set authorizedPolling to true first.' }
if (-not $TaskName) {
	$TaskName = if ($config.taskName) { [string]$config.taskName } else { 'ResyAvailabilityMonitor' }
}
$node = (Get-Command node.exe -ErrorAction Stop).Source
$arguments = '"{0}" --config "{1}"' -f (Join-Path $PSScriptRoot 'monitor.mjs'), $ConfigPath
$action = New-ScheduledTaskAction -Execute $node -Argument $arguments -WorkingDirectory $PSScriptRoot
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$nextHour = (Get-Date).AddHours(1)
$nextHour = $nextHour.Date.AddHours($nextHour.Hour)
$hourly = New-ScheduledTaskTrigger -Once -At $nextHour -RepetitionInterval (New-TimeSpan -Hours 1)
$task = New-ScheduledTask -Action $action -Trigger $hourly -Settings $settings -Principal $principal -Description 'Authorized Resy availability monitor.'
Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Select-Object TaskName, State
Write-Host "Hourly task installed; next run is $nextHour. This Windows user must remain logged in."