# Valorosters · Recuperación ante desastres (F78)

> **Estado:** implementado, probado de punta a punta contra un destino **simulado** (ensayo local, 2026-10-02) y **pendiente de activar** contra Backblaze B2.
> Hasta que exista la primera copia en B2 y el simulacro desde B2, `production:check` da `f78-offsite-dr FAIL`, y es lo correcto.
> Sustituye a `docs/operations/drlcards-disaster-recovery.md` (PRE-F70) para todo lo que sea off-site.

## 0. Qué existe y dónde

| Pieza | Dónde vive | Quién la necesita |
|---|---|---|
| Producción (app + stack Supabase + túnel) | VPS Leaseweb `212.95.40.144` (`/opt/nexus/projects/{valorosters,supabase-drlcards,drlcards-sync}`) | — |
| Backup local verificado (unidad F67/F78) | VPS `/opt/nexus/backups/supabase-drlcards/f78/<TS>/` (mismo disco: muere con el VPS) | restauraciones rápidas con el VPS vivo |
| **Copia off-site cifrada** | B2 `valorosters-dr-backups` (EU Central), prefijo `valorosters/` | cualquier recuperación sin el VPS |
| **Clave privada de recuperación** | PC `%USERPROFILE%\.nexus-recovery\valorosters\recovery-key.pem` (ACL solo `DAVID\david`) **+ copia offline** | descifrar CUALQUIER copia off-site |
| Certificado público de cifrado | PC (misma carpeta), VPS `supabase-drlcards/backup/backup-recipient.crt`, y dentro del paquete de secretos | cifrar (el VPS) |
| Credencial B2 del VPS (sin borrado) | VPS `supabase-drlcards/backup/rclone.conf` (600) | subir/verificar desde el VPS |
| Cuenta Backblaze (login + 2FA + Master Application Key) | gestor de contraseñas del propietario | crear claves nuevas, ver/recuperar versiones |
| Código fuente de la release activa | B2 `valorosters/releases/<build-id>/source.tar.cms` (+ el working tree del PC, sin commitear) | reconstruir la app |

### Disposición en B2

```
valorosters/units/<TS>/     cada 6 h · lifecycle: ocultar a 31 días, borrar 1 día después
valorosters/weekly/<TS>/    1.ª unidad de cada semana ISO · ocultar a 92 días
valorosters/monthly/<TS>/   1.ª unidad de cada mes · ocultar a 366 días
valorosters/releases/<id>/  fuente de cada release activa, una vez · ocultar a 366 días (se vuelve a subir si desaparece)
valorosters/probe/          sondas de la instalación · ocultar a 1 día, borrar 30 días después
```

- **Object Lock:** governance, **30 días** por defecto en todo el bucket. Ninguna regla de lifecycle borra una versión antes de que venza su bloqueo: todas suman más de 30 días, y además B2 no borra versiones bloqueadas.
- **La clave del VPS** solo tiene `listBuckets, listFiles, readFiles, writeFiles`, en ese bucket y bajo `valorosters/`. Sin `deleteFiles` ni `bypassGovernance`, **no puede borrar ninguna versión**. Lo peor que puede hacer es *ocultar* (crear una versión nueva encima), y la versión anterior sigue ahí.

### Cada unidad remota

| Objeto | Contenido | Cifrado |
|---|---|---|
| `db.dump.cms` | `pg_dump -Fc` completo de la BD `postgres` | CMS AuthEnvelopedData AES-256-GCM, clave de sesión RSA-OAEP (RSA-4096) |
| `storage.tgz.cms` | tar del volumen de Storage (bytes de los objetos) | igual |
| `meta.tar.cms` | `manifest.json`, `db.toc`, `table-counts.tsv`, `storage-files.sha256`, `storage-objects.tsv`, `SHA256SUMS`, `COMPLETE` | igual |
| `recovery.tar.cms` | **paquete de secretos, APARTE** (§6) | igual |
| `CHECKSUMS` | sha256 de cada `.cms` | — (no es secreto) |
| `offsite.json` | manifiesto **seguro** (sin secretos ni datos personales) | — |
| `REMOTE_VERIFIED` | el manifiesto con `state=COMPLETE`, escrito **el último**, tras descargar y comparar cada componente | — |

`offsite.json` lleva lo siguiente:
- **identidad y versiones:** `backupId`, `createdAtUtc`, `release`, `migrationHead` (por estado real de la BD), `postgresVersion`;
- **tamaños:** `dbBytes`, `encryptedDbBytes`, `storageObjects`, `encryptedStorageBytes`;
- **integridad:** `components{bytes, sha256, plainSha256}`, `innerSumsSha256`, `encryption{format, formatVersion, recipientSha256}`, `deckIntegrity{deckDanglingRefs, ok}`, `schemaObjects`;
- **estado:** `recoveryBundle`, `remote{upload, verification}`, `state`.

**Estados** (`OFFSITE_STATE` en la unidad local): `CREATING → ENCRYPTED → UPLOADED → VERIFIED → COMPLETE | FAILED`.
Una unidad **solo es COMPLETE** cuando están subidos, descargados de vuelta y comparados TODOS sus componentes obligatorios, incluido el paquete de secretos (`DRL_OFFSITE_REQUIRE_RECOVERY=1`).

**Checksums**, en tres momentos:
- antes de subir (`sha256sum -c CHECKSUMS`);
- tras la subida, descargando del remoto (cada `.cms` = manifiesto = `CHECKSUMS`);
- antes de restaurar: el PC vuelve a comprobarlos, y tras descifrar comprueba `SHA256SUMS` de la unidad. GCM, además, autentica cada byte.

## 1. Prerrequisitos EXTERNOS (no dependen del VPS)

Tienen que existir **fuera de `212.95.40.144`** antes del incidente:

1. **Cuenta Backblaze** del propietario: email, contraseña, **2FA** y la posibilidad de generar una Master Application Key. Va en el gestor de contraseñas.
2. **Clave privada de recuperación** `recovery-key.pem`:
   - en el PC (`%USERPROFILE%\.nexus-recovery\valorosters\`);
   - **y una segunda copia offline** (gestor de contraseñas como adjunto seguro, o USB cifrado guardado aparte).
   - **Sin esta copia, perder el PC y el VPS a la vez = backups ilegibles.**
   - Huella del certificado: `SHA256 13:6F:B2:BA:5D:C4:CE:3A:4D:5F:A9:56:B1:58:00:1E:EE:BA:02:01:7F:45:52:E6:DE:0F:40:CD:92:9C:BD:29` (caduca el 2036-09-29).
3. **Cuenta Cloudflare** con la zona `valorosters.com` y el túnel `drlcards` (`801a8447-…`). Las credenciales del túnel ya van en el paquete de secretos. Si se perdieran, se crea un túnel nuevo desde el panel.
4. **Proveedor de VPS** (Leaseweb u otro) para contratar un host nuevo, y una clave SSH del PC.
5. **Registrador del dominio** (solo si hubiera que tocar los NS; con el túnel no hace falta).
6. **Resend** (SMTP de Auth): su secreto va en el paquete (`supabase-drlcards/secrets/auth-smtp.env`). La cuenta no se toca en F78.
7. **Registros públicos de imágenes**: `public.ecr.aws/supabase/*`, `node:24.15.0-bookworm-slim`, `cloudflare/cloudflared:2026.9.0` y `rclone/rclone@sha256:45401ad7…`. Si un tag desapareciera, se usa el más cercano; el dump es portable dentro de Postgres 17.
8. **El repo** (este working tree en el PC) para los scripts de ops. Si el PC también se pierde, las herramientas de backup **vigentes** van dentro del paquete de secretos (`supabase-drlcards/backup/bin/`), y el resto del repo en el fuente de la release (`releases/<id>/source.tar.cms`).

**Nada esencial existe solo en el VPS.** Comprobado 2026-10-02:

| Elemento | De dónde se recupera |
|---|---|
| BD y Storage | unidades B2 |
| Configuración del stack, secretos de la app, credenciales del túnel, worker esports (bin, env y release) | `recovery.tar.cms` |
| Código de la app | `releases/<id>` |
| Crontab | §3.8 de este runbook |

## 2. Escenarios

### A · Contenedor de la app perdido o roto (`valorosters-app`)

```bash
ssh nexusadmin@VPS 'cd /opt/nexus/projects/valorosters && docker compose up -d --force-recreate --no-deps valorosters-app && bin/status.sh'
```

- **Si la release activa está dañada:** `bin/deploy.sh --activate <release anterior>` (la lista está en `releases/`).
- **Si `releases/` también se perdió:** §3.6, con el fuente que hay en B2.
- La BD no se toca. Corte esperado: 1–3 s de 502.

### B · Contenedor de la BD perdido (`supabase_db_DRLCards`)

- **Volumen intacto:** `docker compose -f /opt/nexus/projects/supabase-drlcards/compose.yml up -d db`. No se pierde nada.
- **Volumen perdido o corrupto:**
  1. **Parar la app:** `cd /opt/nexus/projects/valorosters && docker compose stop valorosters-app`. `restore-unit.sh` se niega a restaurar mientras la app esté en marcha.
  2. Recrear el contenedor `db` con un volumen **vacío** y esperar a «init process complete».
  3. Parar `auth`, `storage`, `rest` y `realtime` (que no escriban durante la restauración).
  4. Restaurar desde la última unidad LOCAL si el disco está sano (`/opt/nexus/backups/supabase-drlcards/f78/<TS>/`). Si no, desde B2 (§3.3).

     ```bash
     bash /opt/nexus/projects/supabase-drlcards/backup/bin/restore-unit.sh into --src <unidad> \
       --target-container supabase_db_DRLCards --confirm RESTORE-INTO-EMPTY:supabase_db_DRLCards
     ```

     Rechaza: sin la confirmación exacta, con `valorosters-app` en marcha, o si la BD tiene tablas en `public` o usuarios en `auth`.
     Valida: recuentos, cabeza 0061, mazos, inventario, RLS y políticas, Storage.
  5. Levantar el resto del stack y luego la app. Comprobar `production:check -- --app --vps`.
- **Pérdida:** desde la última unidad, como máximo 6 h (13 h si falló una ejecución).

### C · VPS entero perdido → §3

### D · Storage perdido (volumen `supabase_storage_DRLCards`)

```bash
docker stop supabase_storage_DRLCards
docker run --rm -v supabase_storage_DRLCards:/dst -v <unidad>:/b:ro alpine sh -c 'cd /dst && tar xzf /b/storage.tgz'
docker run --rm -v supabase_storage_DRLCards:/src:ro alpine sh -c 'cd /src && find . -type f -exec sha256sum {} + | sort' | diff - <(sort <unidad>/storage-files.sha256)
docker start supabase_storage_DRLCards
```

Los metadatos (`storage.objects`) viven en la BD: si la BD está bien, solo faltan los bytes. Hoy el bucket `assets` tiene **0 objetos**.

### E · La última copia está corrupta

- `backup-offsite.sh verify <TS>` y `fetch` la rechazan solas (`HASH_MISMATCH`, `MISSING_OBJECT`, `MARKER_MISMATCH`). GCM rechaza además cualquier byte alterado al descifrar.
- Elegir la anterior: `backup-offsite.sh list` → las `COMPLETE` de `units/`, luego `weekly/` y `monthly/` (`fetch <TS> <dir> --tier weekly`).
- Si alguien **ocultó** o sobrescribió objetos: en el panel de B2, *Browse Files → Show hidden / all versions*. La versión original sigue ahí (Object Lock + clave sin borrado).

### F · Credencial de backup comprometida (la clave B2 del VPS)

1. B2 → *Application Keys* → borrar `valorosters-vps-uploader`. Lo hace el propietario desde la web; el VPS no puede.
2. Qué puede haber hecho quien la tenía:
   - **leer** copias: están cifradas y no sirven sin la clave privada;
   - **subir u ocultar** ficheros: las versiones anteriores siguen bloqueadas;
   - **no puede borrar** versiones.
3. Revisar en *Browse Files* los objetos con fecha posterior a la filtración. Las copias válidas son las que tienen `REMOTE_VERIFIED` cuyo `manifestSha256` cuadra; `verify` lo comprueba.
4. Crear la clave nueva desde el PC con `node scripts/ops/b2-provision.mjs`, que la instala directamente en el VPS. Después, `backup-cron.sh` a mano y `offsite-drill.sh`.
5. **Si se filtró el VPS entero** (y no solo la clave), rotar también todo lo que contiene el paquete de secretos: JWT y claves de Supabase (ver F77-S1), túnel, SMTP y `app.env`.

### G · Claves de cifrado: rotación o pérdida

- **Rotación** (planificada, o porque la clave privada pudo verse expuesta):
  1. Mover la clave vieja a `.nexus-recovery/valorosters/archive/<fecha>/`. **No borrarla**: descifra las copias anteriores hasta que venzan (monthly: 366 días).
  2. `bash scripts/ops/offsite-recovery-key.sh generate`, luego `upload-cert`, y actualizar la copia offline.
  3. Ejecutar `backup-cron.sh` a mano y `offsite-drill.sh` con la clave nueva. Cada `offsite.json` dice con qué certificado se cifró (`encryption.recipientSha256`).
- **Clave privada perdida, VPS vivo:** rotar YA (punto anterior). Las copias remotas anteriores quedan ilegibles: se aceptan como perdidas y se rehace la historia desde hoy.
- **Clave privada perdida Y VPS perdido:** **no hay recuperación desde B2.** Por eso la copia offline del §1.2 es obligatoria.
- El VPS solo tiene el certificado **público**. Con lo que tiene no puede descifrar ninguna copia, ni siquiera las suyas.

### H · Cloudflare sano pero origen perdido (530/1033 en valorosters.com)

- El túnel `drlcards` sigue existiendo en Cloudflare: el DNS (CNAME al túnel) **no se toca**.
- Basta con que **cualquier** host nuevo arranque `cloudflared` con las mismas credenciales (`valorosters/tunnel/*.json` + `config.yml`, del paquete de secretos) y un origen `valorosters-app:3005` → §3.
- Mientras tanto, opcional: una *Custom Error Page* o una regla en Cloudflare con un aviso de mantenimiento.

## 3. Reconstrucción completa en un VPS NUEVO (sin nada del VPS muerto)

Lo que hace falta, todo externo (§1): la cuenta B2, la clave privada (PC u offline), Cloudflare, el host nuevo y este runbook. La IP antigua `212.95.40.144` aparece en varios scripts:
- `offsite-drill.sh` y `offsite-recovery-key.sh` aceptan `DRL_VPS=nexusadmin@<IP nueva>`;
- `production-check.ts` y `b2-provision.mjs` la llevan escrita y hay que cambiarla (una línea en cada uno).

### 3.1 Host

1. Ubuntu LTS, 4 vCPU, 8 GB de RAM, más de 60 GB de disco.
2. Usuario `nexusadmin` con la clave SSH del PC; `ufw` solo con el 22. No hace falta abrir el 80/443: el tráfico entra por el túnel.
3. Docker Engine + compose plugin, `systemctl enable --now docker`; `nexusadmin` en el grupo `docker`.
4. `sudo install -d -o nexusadmin -g nexusadmin /opt/nexus/{projects,backups,logs}`

### 3.2 Credencial B2 en el host nuevo

1. En el PC: `node scripts/ops/b2-provision.mjs`, tras cambiar en el script `VPS` a la IP nueva. Pide la Master Application Key (sin eco), comprueba el bucket, crea una clave nueva sin borrado y la instala en el host nuevo.
2. Antes, en el host nuevo:
   - copiar los scripts de `scripts/ops/` a `/opt/nexus/projects/supabase-drlcards/backup/bin/` (`backup-*.sh`, `restore-unit.sh`, `offsite-install-credentials.sh`). Sin el PC: los mismos van en `scripts/ops/` del fuente de la release y, en su versión vigente, en el paquete de secretos;
   - subir el certificado con `DRL_VPS=… bash scripts/ops/offsite-recovery-key.sh upload-cert`.

### 3.3 Traer la última copia y el paquete de secretos (descifrado en el PC)

```bash
# host nuevo: lista y descarga CIFRADA (verifica hashes + marcador)
B=/opt/nexus/projects/supabase-drlcards/backup/bin
bash $B/backup-offsite.sh list | head
bash $B/backup-offsite.sh fetch <TS> /opt/nexus/restore/enc --with-secrets
# PC (Git Bash): traer, verificar, descifrar
K=~/.nexus-recovery/valorosters; mkdir -p /tmp/rec && cd /tmp/rec
ssh nexusadmin@<IP> 'tar -C /opt/nexus/restore/enc -cf - .' | tar -xf -
for c in db.dump.cms storage.tgz.cms meta.tar.cms recovery.tar.cms; do grep " $c$" CHECKSUMS | sha256sum -c -; done
mkdir unit
for f in db.dump storage.tgz; do openssl cms -decrypt -binary -inform DER -in $f.cms -out unit/$f -inkey $K/recovery-key.pem -recip $K/backup-recipient.crt; done
openssl cms -decrypt -binary -inform DER -in meta.tar.cms -out meta.tar -inkey $K/recovery-key.pem -recip $K/backup-recipient.crt && tar -C unit -xf meta.tar
(cd unit && sha256sum -c SHA256SUMS)
openssl cms -decrypt -binary -inform DER -in recovery.tar.cms -out recovery.tar -inkey $K/recovery-key.pem -recip $K/backup-recipient.crt
# al host nuevo: unidad y configuración (700/600), y BORRAR la copia en claro del PC
ssh nexusadmin@<IP> 'install -d -m 700 /opt/nexus/restore/unit' && tar -C unit -cf - . | ssh nexusadmin@<IP> 'tar -xf - -C /opt/nexus/restore/unit'
ssh nexusadmin@<IP> 'cd /opt/nexus/projects && tar -xf - --no-same-owner' < recovery.tar
cd / && rm -rf /tmp/rec
```

**Sin ninguna herramienta** (PC y repo perdidos):
1. En la web de B2, *Browse Files* → `valorosters/units/<TS>/` → descargar los `.cms`, `CHECKSUMS` y `offsite.json`.
2. En cualquier máquina con `openssl` ≥ 3 y la clave offline, los mismos `sha256sum -c` y `openssl cms -decrypt` de arriba.
3. `recovery.tar` trae las herramientas vigentes (`supabase-drlcards/backup/bin/`) y el fuente sale de `valorosters/releases/<id>/`.

El paquete restaura:

| Proyecto | Qué trae |
|---|---|
| `supabase-drlcards/` | `compose.yml`, `kong/`, `snippets/`, `secrets/`, `backup/bin/` (las herramientas F78; **no** `rclone.conf`) |
| `valorosters/` | `compose.yml`, `secrets/app.env`, `tunnel/`, `bin/` |
| `drlcards-sync/` | `bin/`, `env/`, `releases/` |

Después hay que dejar los permisos a 700/600: `chmod 700 */secrets */tunnel drlcards-sync/env` y `chmod 600` sus ficheros.

### 3.4 Stack Supabase + BD

```bash
cd /opt/nexus/projects/supabase-drlcards
docker compose up -d db          # volumen NUEVO; esperar «init process complete» + 3 × select 1
bash backup/bin/restore-unit.sh into --src /opt/nexus/restore/unit \
  --target-container supabase_db_DRLCards --confirm RESTORE-INTO-EMPTY:supabase_db_DRLCards
# → RESTORE_OK: recuentos = manifiesto, cabeza 0061 por estado, 0 refs rotas de mazos, RLS/políticas = manifiesto
```

Si `into` responde **NO está vacía** porque el init del stack ya creó tablas en `public`, es que se arrancó el stack completo antes de tiempo. Recrear `db` con un volumen vacío y repetir (solo `db` arrancado).

### 3.5 Storage

Seguir §2.D con `<unidad>=/opt/nexus/restore/unit`. Después, `docker compose up -d` para el resto del stack: auth, rest, kong, storage, realtime…

### 3.6 App

```bash
# PC: fuente de la release (cifrado) → descifrar → incoming/
ssh nexusadmin@<IP> "bash $B/backup-offsite.sh fetch-release <build-id> /opt/nexus/restore/rel"
ssh nexusadmin@<IP> 'cat /opt/nexus/restore/rel/source.tar.cms' > /tmp/s.cms
openssl cms -decrypt -binary -inform DER -in /tmp/s.cms -out /tmp/<build-id>.tar -inkey $K/recovery-key.pem -recip $K/backup-recipient.crt
ssh nexusadmin@<IP> 'mkdir -p /opt/nexus/projects/valorosters/incoming && cat > /opt/nexus/projects/valorosters/incoming/<build-id>.tar' < /tmp/<build-id>.tar; rm -f /tmp/s.cms /tmp/<build-id>.tar
# host nuevo
cd /opt/nexus/projects/valorosters && mkdir -p releases logs && bin/deploy.sh <build-id>
```

- El `<build-id>` sale de `offsite.json → release`, y el fuente lo reproduce exactamente: `buildIdReproducible=true`, comprobado en F78.
- `deploy.sh` compila con `secrets/app.env` y se niega a activar si el BUILD_ID no coincide.

### 3.7 Túnel (Cloudflare)

```bash
cd /opt/nexus/projects/valorosters && docker compose up -d valorosters-tunnel
```

Usa el mismo túnel y las mismas credenciales, así que en minutos `valorosters.com` vuelve a responder sin tocar el DNS. Si las credenciales no sirven, crear un túnel nuevo en el panel y apuntar el CNAME.

### 3.8 Worker esports y programación

```bash
cd /opt/nexus/projects/drlcards-sync
# runtime: Node v22.23.2 linux-x64 de nodejs.org (verificar SHASUMS256), en runtime/ + enlace runtime/node
ln -sfn releases/rel-20260914T093113Z-996d06fd current
crontab -e   # añadir:
# */2 * * * * /opt/nexus/projects/drlcards-sync/bin/run-sync.sh >/dev/null 2>&1
```

La línea del backup **no se copia a mano**: la instala `backup-schedule.sh install` (§3.9), que se niega si aún no hay copia y simulacro desde B2.

### 3.9 Backup off-site en el host nuevo

1. `offsite.env`: lo escribe `offsite-install-credentials.sh`, que es lo que hace `b2-provision.mjs`.
2. `bash $B/backup-cron.sh`: primera copia del host nuevo.
3. PC: `DRL_VPS=nexusadmin@<IP> bash scripts/ops/offsite-drill.sh`, simulacro desde B2.
4. `bash $B/backup-schedule.sh install`: cron cada 6 h.

### 3.10 Validación final

- [ ] `npm run production:check -- --app --vps` con `BASE_URL=https://valorosters.com`, sin FAIL salvo los conocidos (auth-email F77).
- [ ] `npm run smoke:production` (BASE_URL pública, `.env.local` público en una carpeta temporal: ver F79.2).
- [ ] `/api/ready` devuelve `ready` y `migrationHead=0061_forge_progression`.
- [ ] Login QA, colección, sobres, Forja, Ranked.
- [ ] `backup-status.sh`: `OFFSITE_REMOTE_TYPE b2`, `OFFSITE_DRILL OK … b2`, `SCHEDULE_F78 1`.

**Objetivos:**

| | Valor |
|---|---|
| RPO | ≤ 6 h (política: alarma a las 13 h) |
| RTO de la BD | medido: 7 s de `pg_restore`, 29 s con Postgres listo y validación; 46 s de punta a punta en el simulacro con descarga y descifrado |
| RTO del sitio completo en VPS nuevo | estimado 2–4 h (lo que más tarda: host, Docker, imágenes y `npm ci` + build) |

## 4. Operación diaria

| Qué | Cómo |
|---|---|
| Programación | crontab `17 */6 * * *` → `backup-cron.sh` (00:17, 06:17, 12:17, 18:17 hora del VPS). Sin solapes: `flock -n` compartido (ocupado = exit 75, no se encola). |
| Registro | `/opt/nexus/logs/drlcards-backup.log`, `/opt/nexus/logs/drlcards-offsite.log`, journald (`journalctl -t drlcards-backup -t drlcards-offsite`) |
| Estado | `bash $B/backup-status.sh`, o `/opt/nexus/backups/supabase-drlcards/backup-health.json` (última COMPLETE local y off-site, edad, verificación, último simulacro remoto, cron) |
| Veredicto | `npm run production:check -- --vps`: `backup-offsite`, `backup-offsite-drill`, `backup-schedule` y `f78-offsite-dr`. Solo **PASS** con copia B2 de ≤ 13 h, simulacro desde B2 OK de ≤ 35 días y cron instalado. |
| Simulacro | **Mensual**, desde el PC: `bash scripts/ops/offsite-drill.sh`, o `--tier monthly` para probar una copia antigua. |
| Retención local | `LOCAL_KEEP=28` (7 días de unidades en el disco del VPS). Nunca borra la última copia off-site verificada ni una con envío en curso. |
| Alerta externa | **No existe** (deuda F78). El aviso es el log, journald y `production:check`. Un correo, Telegram o webhook se añade fuera de F78 (no se toca SMTP/Resend). |

**Qué NO se respalda, y por qué:**

| Elemento | Motivo |
|---|---|
| BD `_supabase` (Logflare, 15 MB) y `storage_vectors` (vacía) | el stack las recrea |
| Imágenes Docker | registros públicos, fijadas por tag o digest |
| `node_modules` y `.next` | se regeneran con `npm ci` + build |
| `compose.yml.bak-*` | secretos anteriores a la rotación F77-S1; no deben revivir |
| El backup compartido `nexus-backup.sh` | infraestructura de otros proyectos; no se toca |

## 5. Herramientas (todas en `scripts/ops/`)

| Script | Dónde corre | Para qué |
|---|---|---|
| `backup-drlcards.sh` | VPS | unidad local verificada (dump, Storage, manifiesto con cabeza, release, integridad y esquema) |
| `backup-offsite.sh` | VPS | `push`, `verify`, `fetch [--tier] [--with-secrets]`, `fetch-release`, `list`, `record-drill`, `check-config`, `status` |
| `backup-cron.sh` / `backup-schedule.sh` | VPS | ejecución de cron, y su instalación con guarda |
| `backup-status.sh` | VPS (solo lectura) | estado y `HEALTH_JSON` |
| `restore-unit.sh` | VPS | `drill` (desechable, `--network none`) / `into` (solo BD vacía, nunca con la app en marcha) |
| `restore-guard-tests.sh` | PC o VPS | pruebas de las guardas con un `docker` falso |
| `offsite-drill.sh` | PC | simulacro desde el remoto: descarga → verificación en el PC → descifrado → restauración aislada → registro |
| `offsite-recovery-key.sh` | PC | `generate` / `upload-cert` / `fingerprint` |
| `b2-provision.mjs` | PC (PowerShell) | crea la clave B2 sin borrado y la instala en el VPS sin mostrarla |
| `offsite-install-credentials.sh` | VPS | escribe `rclone.conf` 600 y `offsite.env`; prueba list, write, read y que el borrado se rechace |
| `offsite-harness.sh` | VPS (fuera de CI) | arnés con destino simulado: 69 casos |
| `_f78-rehearsal.sh` | VPS (instrumento) | ensayo local de la arquitectura exacta |
