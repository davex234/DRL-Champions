# =====================================================================================================================
# DRLCards · TÚNEL CLOUDFLARE de valorosters.com (Windows, usuario actual, sin administrador).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ops\windows\drlcards-tunnel.ps1 <acción>
#
#   install    registra la tarea «DRLCards-Tunnel» (al iniciar sesión + cada minuto con IgnoreNew: si cloudflared muere,
#              vuelve en ≤ 1 min) y la arranca
#   uninstall  la para y la elimina
#   start | stop | restart | status
#
# Túnel PROPIO «drlcards» con su config explícita (~/.cloudflared/drlcards.yml): valorosters.com y www → 127.0.0.1:3005.
# NO usa ~/.cloudflared/config.yml (es de clipflow) ni toca los demás túneles. Next sigue escuchando SOLO en 127.0.0.1.
# Las credenciales del túnel viven en ~/.cloudflared (nunca en el repo).
# =====================================================================================================================
param([Parameter(Mandatory = $true)][ValidateSet("install", "uninstall", "start", "stop", "restart", "status")][string]$Action)
$ErrorActionPreference = "Stop"
$Task = "DRLCards-Tunnel"
$Root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$LogDir = Join-Path $Root "logs\runtime"
$Config = Join-Path $env:USERPROFILE ".cloudflared\drlcards.yml"
$Exe = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $Exe) { $Exe = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter cloudflared.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName }
New-Item -ItemType Directory -Force $LogDir | Out-Null
function TunnelProcs { Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object { $_.CommandLine -like "*drlcards.yml*" } }

switch ($Action) {
  "install" {
    if (-not $Exe) { throw "cloudflared no encontrado" }
    if (-not (Test-Path $Config)) { throw "falta $Config" }
    $log = Join-Path $LogDir "cloudflared-drlcards.log"
    $act = New-ScheduledTaskAction -Execute $Exe -WorkingDirectory $Root -Argument "tunnel --config `"$Config`" --no-autoupdate --loglevel info --logfile `"$log`" run"
    $trg = @(
      (New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"),
      (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1))
    )
    $set = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
      -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    $pri = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $Task -Action $act -Trigger $trg -Settings $set -Principal $pri -Description "DRLCards: túnel Cloudflare drlcards (valorosters.com -> 127.0.0.1:3005). scripts/ops/windows/drlcards-tunnel.ps1" -Force | Out-Null
    Start-ScheduledTask -TaskName $Task
    Start-Sleep 5
    "tarea $Task instalada y arrancada; procesos cloudflared del túnel: $(@(TunnelProcs).Count)"
  }
  "uninstall" { & $PSCommandPath -Action stop; Unregister-ScheduledTask -TaskName $Task -Confirm:$false; "tarea $Task eliminada" }
  "start" { Start-ScheduledTask -TaskName $Task; Start-Sleep 5; "arrancado; procesos: $(@(TunnelProcs).Count)" }
  "stop" {
    Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
    TunnelProcs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    "parado; procesos: $(@(TunnelProcs).Count) (la repetición por minuto lo relanza: para dejarlo parado de verdad, uninstall)"
  }
  "restart" { & $PSCommandPath -Action stop; & $PSCommandPath -Action start }
  "status" {
    $t = Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
    "tarea: $(if ($t) { $t.State } else { 'no instalada' }) · procesos del túnel: $(@(TunnelProcs).Count) · config: $Config"
    "últimas líneas:"; Get-Content (Join-Path $LogDir "cloudflared-drlcards.log") -Tail 5 -ErrorAction SilentlyContinue
  }
}
