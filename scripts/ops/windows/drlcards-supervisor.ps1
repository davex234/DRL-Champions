# =====================================================================================================================
# DRLCards · SUPERVISOR DE RUNTIME (Windows). Lo lanza la tarea programada «DRLCards» (drlcards-service.ps1 install).
#
#   · UNA sola instancia (mutex con nombre): una segunda copia del supervisor sale sin hacer nada.
#   · Mantiene vivo `next start -H 127.0.0.1 -p 3005` (la build de .next, sin reconstruir). Si muere, lo relanza
#     con espera creciente (2 s → 60 s) para no entrar en bucle si falla al arrancar.
#   · NUNCA arranca un segundo DRLCards: si :3005 ya está ocupado por otro proceso, espera y lo registra.
#   · Mantiene el túnel SSH 54521/54522 hacia la BD del VPS SOLO si el puerto está libre (no duplica uno existente).
#     Clave de ~/.ssh (sin contraseñas en argumentos).
#   · Logs: logs/runtime/app.log (salida de Next, rotada por drlcards-logpipe.mjs: 10 MB × 5) y
#     logs/runtime/supervisor.log (1 MB × 3). No escribe variables de entorno.
#   · Parada ordenada: el fichero logs/runtime/STOP (lo crea `drlcards-service.ps1 stop`) → mata SOLO su árbol y sale.
# =====================================================================================================================
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$LogDir = Join-Path $Root "logs\runtime"
New-Item -ItemType Directory -Force $LogDir | Out-Null
$SupLog = Join-Path $LogDir "supervisor.log"
$StopFlag = Join-Path $LogDir "STOP"
$Port = 3005

function Log([string]$msg) {
  try {
    if ((Test-Path $SupLog) -and (Get-Item $SupLog).Length -gt 1MB) {
      if (Test-Path "$SupLog.3") { Remove-Item "$SupLog.3" -Force }
      foreach ($i in 2, 1) { if (Test-Path "$SupLog.$i") { Move-Item "$SupLog.$i" "$SupLog.$($i + 1)" -Force } }
      Move-Item $SupLog "$SupLog.1" -Force
    }
    Add-Content -Path $SupLog -Value ("{0} {1}" -f (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"), $msg) -Encoding utf8
  } catch { }
}
function Listener([int]$p) { Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 }
function KillTree([int]$procId) { if ($procId) { & taskkill.exe /T /F /PID $procId 2>$null | Out-Null } }

$created = $false
$mutex = New-Object System.Threading.Mutex($true, "Local\DRLCards-Supervisor-3005", [ref]$created)
if (-not $created) { Log "otra instancia del supervisor ya está activa: salgo"; exit 0 }
Log "supervisor arrancado pid=$PID root=$Root"

$app = $null; $tunnel = $null; $delay = 2; $lastStart = [DateTime]::MinValue; $warnedBusy = $false
try {
  while ($true) {
    if (Test-Path $StopFlag) { Log "STOP recibido: paro la app (árbol pid=$($app.Id))"; KillTree $app.Id; break }

    # Túnel a la BD del VPS: solo si nadie escucha ya en 54521.
    if (-not (Listener 54521) -and ($null -eq $tunnel -or $tunnel.HasExited)) {
      $key = Join-Path $env:USERPROFILE ".ssh\id_ed25519"
      $tunnel = Start-Process -FilePath "$env:WINDIR\System32\OpenSSH\ssh.exe" -WindowStyle Hidden -PassThru -ArgumentList @(
        "-N", "-o", "BatchMode=yes", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=8", "-o", "ExitOnForwardFailure=yes",
        "-L", "54521:127.0.0.1:54521", "-L", "54522:127.0.0.1:54522", "-i", $key, "nexusadmin@212.95.40.144")
      Log "túnel SSH lanzado pid=$($tunnel.Id)"
    }

    # App: una sola instancia en :3005.
    if ($null -eq $app -or $app.HasExited) {
      if ($app -and $app.HasExited) {
        $alive = ((Get-Date) - $lastStart).TotalSeconds
        Log "la app terminó (exit=$($app.ExitCode), vivió $([int]$alive) s)"
        $delay = if ($alive -lt 30) { [Math]::Min($delay * 2, 60) } else { 2 }
        $app = $null
        Start-Sleep -Seconds $delay
        continue
      }
      $busy = Listener $Port
      if ($busy) {
        # Si quien escucha es el propio DRLCards (p. ej. el supervisor anterior cayó y dejó huérfana la app), se ADOPTA:
        # se vigila ese proceso en vez de esperar para siempre o arrancar un segundo.
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($busy.OwningProcess)" -ErrorAction SilentlyContinue
        if ($owner -and $owner.CommandLine -like "*next*start -H 127.0.0.1 -p $Port*") {
          $app = Get-Process -Id $busy.OwningProcess -ErrorAction SilentlyContinue
          if ($app) { $lastStart = Get-Date; Log "adoptada la instancia DRLCards ya activa pid=$($app.Id)"; $warnedBusy = $false; continue }
        }
        if (-not $warnedBusy) { Log "puerto $Port ocupado por pid=$($busy.OwningProcess): NO arranco otra instancia"; $warnedBusy = $true }
        Start-Sleep -Seconds 5; continue
      }
      $warnedBusy = $false
      $next = Join-Path $Root "node_modules\next\dist\bin\next"
      $pipe = Join-Path $PSScriptRoot "drlcards-logpipe.mjs"
      $appLog = Join-Path $LogDir "app.log"
      $cmd = "node `"$next`" start -H 127.0.0.1 -p $Port 2>&1 | node `"$pipe`" `"$appLog`" 10 5"
      $app = Start-Process -FilePath "$env:ComSpec" -ArgumentList "/d", "/s", "/c", "`"$cmd`"" -WorkingDirectory $Root -WindowStyle Hidden -PassThru
      $lastStart = Get-Date
      Log "app lanzada (árbol pid=$($app.Id)) → 127.0.0.1:$Port"
    }
    Start-Sleep -Seconds 2
  }
} finally {
  Log "supervisor termina"
  $mutex.ReleaseMutex() | Out-Null
}
