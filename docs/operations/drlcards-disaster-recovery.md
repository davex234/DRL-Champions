# DRLCards · Recuperación ante desastre: «el VPS ha muerto»

> **F78 (2026-10-02): SUPERADO** por [`docs/ops/valorosters-disaster-recovery.md`](../ops/valorosters-disaster-recovery.md) (B2 + Object Lock, componentes cifrados por separado, paquete de secretos, `restore-unit.sh` guardado, simulacro remoto). Lo de abajo es el diseño PRE-F70 y se conserva como historia.

> Runbook **no ejecutado**. Probado solo el tramo de base de datos, mediante el simulacro aislado (`scripts/ops/restore-drill.sh`, 28 s).
> **Requisito previo:** una copia off-site VERIFICADA (`drlcards-backup-restore.md §7`). El sistema está listo y probado, pero **sin activar hasta que exista el destino** (production:check: `backup-offsite FAIL NOT_CONFIGURED`). Mientras no se active, este runbook no tiene de dónde partir si el VPS desaparece: el backup local se pierde con él.

## 0. Antes del incidente (hacer ya)

- [ ] **Activar el off-site** (`drlcards-backup-restore.md §7 · Activación`). Resultado esperado: `backup-offsite PASS` en production:check.
- [ ] **Guardar FUERA del VPS**, en tu gestor de contraseñas o almacenamiento propio, NUNCA en el VPS ni en el repo:
  - la **clave privada de descifrado** (`drlcards-backup.key`). Sin ella las copias off-site no se pueden leer: están cifradas a propósito.
  - el `rclone.conf` del destino, o las credenciales del proveedor y su 2FA.
  - `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SYNC_SECRET` y el **JWT secret** del stack.
- [ ] **Configuración del stack** (`/opt/nexus/projects/supabase-drlcards`: `compose.yml`, `kong/`). NO está en el repo ni en la unidad off-site: incluirla cifrada se propuso y quedó pendiente de tu decisión (`docs/product/qa/pre-f70-offsite-backup/scope.json → stackConfigGap`).
  - **Hoy:** guarda tú una copia fuera del VPS.
  - **Si no la tienes:** el stack nuevo nace con otro JWT secret. Habrá claves anon/service nuevas en `.env.local` y caducarán todas las sesiones; las contraseñas siguen valiendo, porque los hashes van en la unidad.

## 0.5 Recuperar la copia off-site (SIN acceso al VPS original)

En la máquina nueva, o en cualquier máquina con Docker, `openssl` y `bash`, y con el repo clonado:

```bash
install -d -m 700 /restore/cfg
#   /restore/cfg/rclone.conf (600)  ← del gestor de contraseñas
#   /restore/cfg/drlcards-backup.crt, /restore/cfg/drlcards-backup.key (600)  ← idem
cat > /restore/cfg/offsite.env <<'EOF'
DRL_OFFSITE_ENABLED=1
DRL_OFFSITE_REMOTE=drloffsite:<bucket>/drlcards
DRL_OFFSITE_RCLONE_CONFIG=/restore/cfg/rclone.conf
DRL_OFFSITE_RECIPIENT_CRT=/restore/cfg/drlcards-backup.crt
DRL_OFFSITE_DECRYPT_KEY=/restore/cfg/drlcards-backup.key
EOF
chmod 600 /restore/cfg/offsite.env
export DRL_OFFSITE_CONFIG=/restore/cfg/offsite.env DRL_BACKUP_ROOT=/restore/root DRL_OFFSITE_LOG=/restore/offsite.log
# 1 · elegir la unidad: la más reciente con REMOTE_VERIFIED (listar con rclone lsf, o el TS del último offsite-status conocido)
# 2 · descargar + verificar hash y marcador + descifrar + comprobar SHA256SUMS y COMPLETE:
bash scripts/ops/backup-offsite.sh fetch <TS> /restore/offsite-<TS>      # → OFFSITE_FETCH_OK … /restore/offsite-<TS>/unit
# 3 · probar ANTES de tocar nada (Postgres desechable, sin red):
SRC=/restore/offsite-<TS>/unit bash scripts/ops/restore-drill.sh         # → DRILL_OK
```

- La carpeta `…/unit` es la **unidad canónica** de siempre: el mismo `db.dump`, `storage.tgz`, `SHA256SUMS` y `COMPLETE`. Los pasos 3 y 4 la usan como `B`.
- Esta cadena se probó en el arnés sobre datos reales: `fetch` + descifrado + `restore-drill.sh` → `DRILL_OK` en 25 s, también con Storage no vacío.

## 1. Host nuevo

1. Ubuntu LTS con 4 vCPU, 8 GB de RAM y más de 40 GB de disco (hoy DRLCards usa 41 MB de BD y unos 3 GB de imágenes del stack).
2. Usuario sin privilegios, clave SSH, `ufw` con solo 22 (y 443 si aloja el proxy).
3. Docker Engine con `systemctl enable --now docker`.

## 2. Stack Supabase

1. Poner `projects/supabase-drlcards/` (compose y kong con el JWT secret) en `/opt/nexus/projects/`. Viene de tu copia fuera del VPS (§0). El `config-<TS>.tgz` del backup diario vive en el VPS y **se pierde con él**.
2. Arrancar **solo** la base de datos:
   `docker compose -f /opt/nexus/projects/supabase-drlcards/compose.yml up -d db`
   La imagen tiene que ser la misma: `public.ecr.aws/supabase/postgres:17.6.1.165`.
3. Esperar a que termine el init (en los logs: «init process complete», y luego 3 conexiones `select 1` seguidas).

## 3. Restaurar la base de datos

```bash
B=/restore/offsite-<TS>/unit                 # la unidad off-site descifrada (§0.5); con el VPS vivo: …/verified/<TS> o f67/<TS>
cd $B && sha256sum -c SHA256SUMS              # si es un daily: sha256sum -c <fichero>.sha256
docker exec supabase_db_DRLCards psql -U supabase_admin -d postgres -c "drop schema if exists auth cascade; drop schema if exists storage cascade;"
docker exec -i supabase_db_DRLCards pg_restore -U supabase_admin -d postgres --no-owner < $B/db.dump
# validar: recuentos de table-counts.tsv (el simulacro lo hace en bucle) y la sonda de esquema
docker exec supabase_db_DRLCards psql -U supabase_admin -d postgres -Atc "select app_admin_schema_probe()"
```

- **Mensajes aceptables:** «already exists» de objetos de la imagen, y los roles `supabase_realtime_admin` y `supabase_functions_admin` (los crean sus servicios).
- **Cualquier otro error es un bloqueo:** para y revisa.

## 4. Restaurar Storage

```bash
docker compose -f /opt/nexus/projects/supabase-drlcards/compose.yml up -d storage   # crea el volumen
docker stop supabase_storage_DRLCards
docker run --rm -v supabase_storage_DRLCards:/dst -v $B:/b:ro alpine sh -c 'cd /dst && tar xzf /b/storage.tgz'
docker run --rm -v supabase_storage_DRLCards:/src:ro alpine sh -c 'cd /src && find . -type f -exec sha256sum {} + | sort' | diff - <(sort $B/storage-files.sha256)
```

## 5. Resto del stack y worker

1. Ejecutar `docker compose … up -d`: auth, rest, kong, storage, realtime y el resto.
2. Comprobar que todos tienen `restart=unless-stopped`.
3. Worker: restaurar `projects/drlcards-sync` (release y `env/esports-sync.env` con permisos 600) y el crontab (`*/2 … run-sync.sh`). Primero `ESPORTS_AUTO_SYNC_ENABLED=false`; se activa al final.
4. Backups: restaurar `/opt/nexus/scripts/nexus-backup.sh` y su cron `30 4 * * *`. Lanzarlo una vez a mano.

## 6. App y red

1. **Local (como hoy):**
   - Actualizar el host del túnel en la línea `ssh -L 54521:… -L 54522:… nexusadmin@<IP nueva>`.
   - Ejecutar `npm run build` y `npm start`.
   - Comprobar con `npm run production:check -- --app --vps` y `npm run smoke:production`.
2. **Release pública:**
   - App en el host de producción con la unidad systemd de `drlcards-production.md`.
   - Proxy TLS con el dominio.
   - Actualizar `NEXT_PUBLIC_SUPABASE_URL` (URL pública de Kong detrás de TLS).
   - En GoTrue: `GOTRUE_SITE_URL`, `GOTRUE_URI_ALLOW_LIST` y SMTP real.
3. **DNS:** apuntar el registro A o AAAA a la IP nueva. Con TTL bajo (300 s) antes de cualquier migración planificada.

## 7. Validación final

- [ ] `/api/ready` devuelve `ready` (database, schema 0058, privacy, catalog 331, storage).
- [ ] `npm run smoke:production` sin fallos.
- [ ] Recuentos iguales al manifiesto: `auth.users`, `user_cards`, `credit_transactions`, `duel_matches`.
- [ ] Un login QA y una partida PvE QA completa.
- [ ] El backup diario corre y `production:check -- --vps` está en verde.

**Tiempo estimado:** 2–4 h si hay copia externa (la BD en sí, unos 30 s). **Pérdida esperada:** desde el último backup copiado fuera, hasta 24 h.
