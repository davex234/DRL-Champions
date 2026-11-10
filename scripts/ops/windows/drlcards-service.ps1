# =====================================================================================================================
# DRLCards · control del runtime persistente (Windows, usuario actual, sin administrador).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ops\windows\drlcards-service.ps1 <acción>
#
#   install    registra la tarea programada «DRLCards» (al iniciar sesión, reinicio si el supervisor cae) y la arranca
#   uninstall  la para y la elimina
#   start      arranca (retira STOP y lanza la tarea)
#   stop       parada ordenada: STOP → el supervisor mata SOLO su árbol → fin de la tarea
#   restart    stop + start
#   status     tarea, supervisor, proceso de :3005, túnel, /api/health, /api/ready, build servida, últimos logs
#
# La tarea corre como el usuario (Interactive, nivel Limited): no guarda contraseñas y no necesita elevación. Por eso
# arranca al INICIAR SESIÓN, no al encender el equipo (eso exigiría una contraseña almacenada o SYSTEM).
# =====================================================================================================================
param([Parameter(Mandatory = $true)][ValidateSet("install", "uninstall", "start", "stop", "restart", "status")][string]$Action)
$ErrorActionPreference = "Stop"
$Task = "DRLCards"
$Root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$Supervisor = Join-Path $PSScriptRoot "drlcards-supervisor.ps1"
$LogDir = Join-Path $Root "logs\runtime"
$StopFlag = Join-Path $LogDir "STOP"
New-Item -ItemType Directory -Force $LogDir | Out-Null

function SupervisorProcs { Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like "*drlcards-supervisor.ps1*" } }
function Health {
  foreach ($p in "/", "/api/health") {
    try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 "http://127.0.0.1:3005$p"; "  GET $p -> $($r.StatusCode)" } catch { "  GET $p -> ERROR $($_.Exception.Message)" }
  }
  try { $j = Invoke-RestMethod -TimeoutSec 15 "http://127.0.0.1:3005/api/ready"; "  /api/ready -> $($j.status) (head $($j.migrationHead))" } catch { "  /api/ready -> ERROR" }
  try { $h = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 "http://127.0.0.1:3005/").Content; $m = [regex]::Match($h, "drl-[0-9.]+-\d+-[0-9a-f]+"); "  build servida -> $($m.Value) (en disco: $((Get-Content (Join-Path $Root '.next\BUILD_ID') -Raw).Trim()))" } catch { }
}
function WaitUp([int]$sec = 90) { for ($i = 0; $i -lt $sec; $i++) { if (Get-NetTCPConnection -LocalPort 3005 -State Listen -ErrorAction SilentlyContinue) { return $true }; Start-Sleep 1 }; return $false }

switch ($Action) {
  "install" {
    $act = New-ScheduledTaskAction -Execute "powershell.exe" -WorkingDirectory $Root -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Supervisor`""
    # Al iniciar sesión + cada minuto: Task Scheduler NO relanza una tarea cuyo proceso muere (su «reiniciar si falla»
    # solo cubre fallos al ARRANCAR; medido). La repetición lo cubre: con IgnoreNew no duplica si el supervisor vive,
    # y si murió lo relanza en ≤ 1 min (el nuevo adopta la app, que sigue sirviendo mientras tanto).
    $trg = @(
      (New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"),
      (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1))
    )
    $set = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
      -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    $pri = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $Task -Action $act -Trigger $trg -Settings $set -Principal $pri -Description "DRLCards: next start en 127.0.0.1:3005 (supervisor con reinicio automático). scripts/ops/windows/drlcards-service.ps1" -Force | Out-Null
    Remove-Item $StopFlag -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName $Task
    "tarea $Task instalada y arrancada; escuchando: $(WaitUp)"
  }
  "uninstall" {
    & $PSCommandPath -Action stop
    Unregister-ScheduledTask -TaskName $Task -Confirm:$false
    "tarea $Task eliminada"
  }
  "start" {
    Remove-Item $StopFlag -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName $Task
    "arrancando… escuchando: $(WaitUp)"
  }
  "stop" {
    New-Item -ItemType File -Force $StopFlag | Out-Null
    for ($i = 0; $i -lt 30 -and (SupervisorProcs); $i++) { Start-Sleep 1 }
    Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 15 -and (Get-NetTCPConnection -LocalPort 3005 -State Listen -ErrorAction SilentlyContinue); $i++) { Start-Sleep 1 }
    "parado; :3005 escuchando: $([bool](Get-NetTCPConnection -LocalPort 3005 -State Listen -ErrorAction SilentlyContinue))"
  }
  "restart" { & $PSCommandPath -Action stop; & $PSCommandPath -Action start }
  "status" {
    $t = Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
    "tarea: $(if ($t) { $t.State } else { 'NO INSTALADA' })"
    "supervisor: $((SupervisorProcs | ForEach-Object { $_.ProcessId }) -join ',')"
    foreach ($p in 3005, 54521) {
      $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
      "puerto ${p}: $(if ($c) { "$($c.LocalAddress) pid=$($c.OwningProcess)" } else { 'LIBRE' })"
    }
    Health
    "últimas líneas del supervisor:"; Get-Content (Join-Path $LogDir "supervisor.log") -Tail 5 -ErrorAction SilentlyContinue
  }
}
