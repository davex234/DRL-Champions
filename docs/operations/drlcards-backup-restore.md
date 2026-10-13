# DRLCards · Backup y restauración

> **Un backup no existe hasta que se restaura.** Simulacro completado el 2026-09-26: `DRILL_OK` en 28 s (ver `docs/product/qa/fase67-production/restore-drill.json`).

## 1. Qué se copia

| Pieza | Diario (`/opt/nexus/scripts/nexus-backup.sh`, cron 04:30) | Verificado F67 (`scripts/ops/backup-drlcards.sh`) |
|---|---|---|
| Postgres completo, incluidos `auth` y `storage` | `pg_dump -Fc` + `pg_restore -l` + `.sha256` | ídem + TOC + 25 recuentos exactos |
| Objetos de Storage (volumen `supabase_storage_DRLCards`) | `tar.gz` + `.sha256` | ídem + sha256 por fichero + inventario `storage.objects` |
| Configuración de servicios (`/opt/nexus/projects`, incluye env y claves JWT) | `config-*.tgz` 600 | — |
| Manifiesto / `SHA256SUMS` / marcador `COMPLETE` | — | sí |

- **Qué no hace falta copiar:** el código (repo), `public/` (dentro del repo) y `.next` (se reconstruye).
- **Tampoco se copia hoy, y hay que decidir si hacerlo:** `.env.local` del PC. Contiene las mismas claves que ya están en el `config-*.tgz` del VPS.
- **Consistencia:** el dump es una instantánea transaccional de Postgres; el tar de Storage se toma segundos después. **No es atómico entre BD y Storage**: un objeto subido en esa ventana puede faltar en uno de los dos. Hoy es irrelevante, porque Storage tiene 0 objetos.

## 2. Hacer un backup verificado (manual, antes de cada release o migración)

```bash
ssh -i ~/.ssh/id_ed25519 nexusadmin@212.95.40.144 'DEST=/opt/nexus/backups/supabase-drlcards/f67 bash -s' < scripts/ops/backup-drlcards.sh
# éxito = última línea «BACKUP_OK <dir>» y exit 0. Cualquier otra cosa NO es un backup.
```

- **Fallos probados** (todos con exit 1): destino sin permisos, contenedor inexistente, disco por debajo de `MIN_FREE_MB`.
- **Estado de los backups:** `npm run production:check -- --vps` informa de la edad del dump diario, la del tar de Storage, el último backup verificado con `SHA256SUMS`, los fallos en el log y el disco libre.

## 3. Simulacro de restauración (aislado, nunca sobre producción)

```bash
ssh -i ~/.ssh/id_ed25519 nexusadmin@212.95.40.144 'SRC=/opt/nexus/backups/supabase-drlcards/f67/<TS> bash -s' < scripts/ops/restore-drill.sh
# éxito = «DRILL_OK …»
```

Pasos del simulacro:
1. Verifica `SHA256SUMS` y el marcador `COMPLETE`.
2. Arranca un contenedor con la misma imagen (`supabase/postgres:17.6.1.165`), `--network none`, sin puertos publicados y con una contraseña efímera.
3. Espera al **final** del init de la imagen (3 conexiones seguidas).
4. Hace `drop schema auth, storage` (los que crea la imagen).
5. Ejecuta `pg_restore --no-owner` y compara los 25 recuentos.
6. Extrae el Storage y compara el sha256 de cada fichero.
7. Borra el contenedor.

**Mensajes esperados de `pg_restore`:** unos 21 «already exists» (objetos de la imagen) y 2 roles de servicios (`supabase_realtime_admin`, `supabase_functions_admin`) que el stack completo crea al arrancar.

## 4. Restaurar DE VERDAD sobre el stack (solo con incidente declarado)

1. Haz un backup verificado del estado actual, aunque esté roto: es tu vuelta atrás.
2. Para la app (PC) y el worker (en `env/esports-sync.env`, `ESPORTS_AUTO_SYNC_ENABLED=false`).
3. Para los servicios que escriben, dejando solo la base de datos:
   `docker stop supabase_auth_DRLCards supabase_rest_DRLCards supabase_storage_DRLCards supabase_realtime_DRLCards`
4. Restaura en una base de datos NUEVA del mismo contenedor. Es el procedimiento del simulacro, con el nombre real:
   `docker exec -i supabase_db_DRLCards psql -U supabase_admin -d postgres -c "create database drl_restore"`, luego `pg_restore -d drl_restore --no-owner < db.dump`. Valida los recuentos contra `table-counts.tsv`.
   Después intercambia las bases: `alter database postgres rename to postgres_old; alter database drl_restore rename to postgres`. Hazlo con todas las conexiones cerradas.
5. Storage:
   `docker run --rm -v supabase_storage_DRLCards:/dst -v <dir>:/b alpine sh -c 'cd /dst && tar xzf /b/storage.tgz'`
   Luego compara con `storage-files.sha256`.
6. Arranca los servicios parados, abre el túnel, arranca la app y ejecuta `npm run production:check -- --app --vps` y `npm run smoke:production`.
7. Conserva `postgres_old` hasta confirmar que todo está bien. Luego elimínala.

**RTO observado de la base de datos (41 MB):** 28 s en el simulacro. El servicio completo es este tiempo más el arranque de los servicios, más la app (1,3 s), más las validaciones.

## 5. Retención y espacio

| | Hoy | Propuesta |
|---|---|---|
| Diario | 14 días (`KEEP_DAYS`) | 14 diarios + 8 semanales (domingo) + 6 mensuales (día 1) |
| Tamaño | dump de unos 2,5 MB/día, 78 MB en total para DRLCards | unos 28 copias × 3 MB ≈ 90 MB, más el crecimiento de la BD |
| Disco del VPS | 463 GB libres (7 % usado, compartido con otros proyectos) | holgado. Alerta si baja de 20 GB (`production:check` avisa) |

- La retención semanal y mensual **no está implementada**. Se implementa copiando el dump del domingo o del día 1 a `weekly/` o `monthly/` con su propio `find -mtime`. No se borra nada existente.
- Los directorios de F67 marcados `INCOMPLETE` o `SUPERSEDED` se conservan como registro.

## 6. RPO

- **Hoy:** hasta **24 h** de pérdida, más los snapshots manuales antes de cada migración (`pre-00xx/`). No hay WAL archiving ni réplica, así que no hay «pérdida cero».
- **Riesgo abierto (BLOCKED): todas las copias están en el MISMO disco del VPS.** Si se pierde el VPS, se pierden los datos y los backups. El sistema off-site ya está preparado y probado (§7). Solo falta que el usuario elija el destino y ponga sus credenciales.
- El off-site **no mejora el RPO**: copia la unidad del día.

## 7. Copia off-site (PRE-F70 · preparada; ACTIVACIÓN PENDIENTE del destino)

Es la **misma unidad** de §2 enviada fuera del VPS. No es otro backup. El envío lo hace `scripts/ops/backup-offsite.sh`, que va dentro del mismo flujo que `backup-drlcards.sh`, con un solo cron y un candado compartido.

```
unidad local COMPLETE ─► tar (solo lo listado en SHA256SUMS) ─► cifrado CMS AES-256-GCM (tu certificado)
  ─► subida a <remoto>/<TS>/ SIN marcador ─► DESCARGA de vuelta y comparación de sha256 y tamaño
  ─► REMOTE_VERIFIED (el último fichero) ─► OFFSITE_VERIFIED en la unidad local + offsite-status
```

- **Transporte:** rclone v1.75.1 en un contenedor fijado por digest. Sirve para S3-compatibles, SFTP/SSH, B2, WebDAV… No se instala nada en el host.
- **Configuración:** `/opt/nexus/projects/supabase-drlcards/backup/offsite.env`, con permisos 600. Se parsea; nunca se ejecuta. Claves `DRL_OFFSITE_*`, descritas en la cabecera del script.
- **Credenciales:** en un `rclone.conf` 600, fuera del repositorio. El registro nunca las imprime, ni tampoco la ruta del destino.
- **Estados de una unidad:** `OFFSITE_IN_PROGRESS` → `OFFSITE_VERIFIED` | `OFFSITE_FAILED`.
- **Una copia remota solo vale con `REMOTE_VERIFIED`** y con el hash coincidente. Las parciales se purgan en el siguiente intento.
- **Reintentar es seguro:** si ya está verificada, se re-verifica y no se vuelve a subir.
- **Códigos de salida:**
  - `backup-drlcards.sh`: 0 ok · 1 fallo local · **3 local OK + off-site KO** · 75 candado ocupado.
  - `backup-offsite.sh`: 0 · 1 · 2 (configuración o unidad rechazada) · 75.
- **Retención remota:**
  - Por defecto, **la del proveedor**: el VPS nunca borra en el destino, así que la credencial puede no tener permiso de borrado.
  - Opcional, `DRL_OFFSITE_RETENTION=script`: 14 diarias, 8 semanales y 6 mensuales. Siempre conserva la última verificada, los últimos 7 días y las parciales de menos de 48 h.
- **Retención local:** `LOCAL_KEEP` (0 = no borra; 14 en la activación, solo en `verified/`).
- **Probado** en un arnés aislado del VPS (`scripts/ops/offsite-harness.sh`): 52/52. Cubre transferencia, parcial, corrupción, reintento, idempotencia, red caída, credenciales falsas, disco lleno, candado, retención y restauración desde el destino con `restore-drill.sh`. Evidencia en `docs/product/qa/pre-f70-offsite-backup/`.

### Activación (una sola vez, cuando exista el destino)

```bash
# 0 · En TU máquina, no en el VPS: certificado de cifrado. La clave privada se queda contigo.
openssl req -x509 -newkey rsa:4096 -nodes -keyout drlcards-backup.key -out drlcards-backup.crt -days 3650 -subj "/CN=drlcards-backup"
# 1 · En el VPS:
install -d -m 700 /opt/nexus/projects/supabase-drlcards/backup/bin
#     copiar scripts/ops/{backup-drlcards,backup-offsite,backup-status,restore-drill}.sh → …/backup/bin/ (700)
#     copiar drlcards-backup.crt → …/backup/backup-recipient.crt
#     crear …/backup/rclone.conf (600) con el remoto «drloffsite» del proveedor (+ known_hosts si es sftp)
#     crear …/backup/offsite.env (600):
#       DRL_OFFSITE_ENABLED=1
#       DRL_OFFSITE_REMOTE=drloffsite:<bucket>/drlcards
#       DRL_OFFSITE_RCLONE_CONFIG=/opt/nexus/projects/supabase-drlcards/backup/rclone.conf
#       DRL_OFFSITE_RECIPIENT_CRT=/opt/nexus/projects/supabase-drlcards/backup/backup-recipient.crt
#       DRL_OFFSITE_RECOVERY_DIR=/opt/nexus/projects/supabase-drlcards        (F70 · decisión B)
#       DRL_OFFSITE_RECOVERY_PATHS="compose.yml kong snippets"
# 2 · Validar sin red:   bash …/backup/bin/backup-offsite.sh check-config        → OFFSITE_CONFIG_OK … recoveryConfig=on
# 3 · Primera copia REAL:
DEST=/opt/nexus/backups/supabase-drlcards/verified bash …/backup/bin/backup-drlcards.sh   # → BACKUP_OK + OFFSITE_OK
bash …/backup/bin/backup-offsite.sh verify <TS>                                         # → OFFSITE_VERIFY_OK
# 4 · Cron (UNO, después del compartido de las 04:30):
#   10 5 * * * DEST=/opt/nexus/backups/supabase-drlcards/verified LOCAL_KEEP=14 /opt/nexus/projects/supabase-drlcards/backup/bin/backup-drlcards.sh >> /opt/nexus/logs/drlcards-backup.log 2>&1
# 5 · En el PC:  npm run production:check -- --vps   → backup-offsite PASS (copia verificada de ≤ 26 h)
```

- **Cuándo pasa a PASS `backup-offsite`:** con configuración activada, una copia `REMOTE_VERIFIED` de hace 26 h o menos, y el último envío sin fallo (si falló, WARN).
- **Hasta entonces:** `FAIL NOT_CONFIGURED`, a propósito.
- **`/api/ready` no depende de nada de esto.** Una caída del proveedor no tumba el juego.

### Configuración de recuperación del stack (F70 · decisión B)

El stack Supabase del VPS se define fuera del repo: `compose.yml` (con el JWT secret y las claves), `kong/` (`kong.yml`, `localhost.crt`, `localhost.key`) y `snippets/` (vacío). Unos 84 KB. Sin ellos, un stack nuevo nacería con otro JWT secret y habría que regenerar las claves.

- Con `DRL_OFFSITE_RECOVERY_DIR` definido, `push` mete esas rutas en un `recovery-config.tar` (+ su sha256) **dentro del mismo tar que se cifra**. Se construye en el directorio de trabajo 700 y se borra; nunca aparece en claro en el destino, el log, stdout ni `offsite.json`. Este último solo lleva `"recoveryConfigPresent": true|false`.
- Rechaza (exit 2): una ruta absoluta, `..`, enlaces simbólicos o ficheros especiales, y más de 10 MB.
- `fetch <TS> <dir>` con la clave privada comprueba el sha256 y rechaza enlaces y rutas no seguras. Restaura en `<dir>/recovery-config/` con directorios 700 y ficheros 600, y saca el tar de la unidad, así que `restore-drill.sh` la ve igual que siempre.
- **Recuperación tras perder el VPS:** en un servidor nuevo, `fetch` → copiar `recovery-config/*` a `/opt/nexus/projects/supabase-drlcards/` → `docker compose up -d` → restaurar la unidad (§4). Las claves anon y service de `.env.local` siguen valiendo.
- Probado con un stack FALSO (secreto sintético) en `offsite-harness.sh` §13. Evidencia en `docs/product/qa/fase70-rc/offsite-recovery-config.json`.
- La clave privada NO vive en el VPS, ni en el repo, ni en la evidencia. Genérala en tu PC (paso 0) y guárdala en tu gestor de contraseñas y en un segundo medio offline.
