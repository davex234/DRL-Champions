# F75 — VPS Production Migration (sin dependencia del PC)

**Fecha:** 2026-10-01 · **Veredicto:** GO (ver AZ) · Evidencia: `docs/product/qa/f75-vps-migration/`
Infra versionada: `scripts/ops/vps/valorosters/` (compose, config del túnel, `bin/status.sh`, `bin/deploy.sh`).

## A. Arquitectura antes
Internet → Cloudflare → túnel `drlcards` → **cloudflared en el PC** (tarea «DRLCards-Tunnel») → **Next en el PC**
(127.0.0.1:3005, tarea «DRLCards» + supervisor PowerShell) → **túnel SSH PC→VPS** (`-L 54521 -L 54522`) → Kong/Postgres
del stack `supabase-drlcards` en el VPS.

## Arquitectura después
Internet → Cloudflare → túnel `drlcards` (mismo ID) → contenedor `valorosters-tunnel` (VPS) → red Docker
`valorosters_edge` → contenedor `valorosters-app` (Next, VPS) → red Docker `supabase-drlcards_interna` →
`supabase_kong_DRLCards:8000` → Postgres. El PC no aparece en el camino.

## B. Dependencias del PC encontradas
1. cloudflared del túnel `drlcards` (solo corría en el PC; 1033 al cerrarlo).
2. `next start` en el PC (:3005).
3. Túnel SSH PC→VPS 54521/54522 (la app del PC llegaba a Supabase por él).
4. Las tres cosas, ligadas a la sesión de Windows (tareas «al iniciar sesión»).
El worker esports ya vivía en el VPS (cron). Backups ya en el VPS.

## C. Inventario del VPS (no destructivo)
Debian 13, kernel 6.12, 16 vCPU, 62 GiB de RAM (54 GiB disponibles), sin swap, disco de 493 G con 459 G libres,
carga ~3. Docker y containerd `enabled`. `nexusadmin` está en el grupo docker; **sudo pide contraseña y no hay linger**,
así que no hay units de systemd posibles. UFW inactivo (`sudo` necesario para ver las reglas de iptables).

## D. Otros proyectos protegidos
Túneles existentes, todos en contenedores: `nexus-tunel-clipflow` y `nexus-tunel-hotel` (nexusedge),
`nexusschola-tunnel`. No se tocó ninguno, ni compose ni redes ajenas. Valorosters tiene compose, red, conector y
nombres propios. La única relación con otro stack es que se UNE a la red existente `supabase-drlcards_interna`
(su propia BD).

## E. Método de despliegue
El working tree es la fuente de verdad: `git ls-files -co --exclude-standard` (versionados + no versionados no ignorados,
es decir, todo el trabajo sin commitear), sin `docs/`, `.claude/`, `.env*`, `node_modules`, `.next` ni capturas fuera
de `public/` → tar de 80 MB, 3.479 ficheros, sha256 `2a3da8ff…dfac2` verificado en los dos extremos.
**Prueba de identidad:** el build id es una huella del CONTENIDO (`next.config.mjs`). La build del VPS salió
`drl-0.1.1-1-08943cb7`, idéntica a la que servía el PC → el código desplegado es exactamente el actual
(F73, F74, hosting, 0060).

## F. Ubicación en el VPS
`/opt/nexus/projects/valorosters/`: `compose.yml`, `releases/<build-id>/`, `current` → release activa,
`secrets/app.env` (700/600), `tunnel/` (700; config + credencial 600), `bin/`, `incoming/`, `logs/`.

## G. Node / npm / Next
Node v24.15.0 (`node:24.15.0-bookworm-slim`, imagen que ya había en el VPS, la misma versión que el PC), npm 11.12.1,
Next 16.3.6 (Turbopack). sharp con los binarios nativos `@img/sharp-linux-x64` + libvips.

## H. Build
Build real en el VPS, en un contenedor desechable (uid 1000, 8 GB / 6 CPU como tope; pico medido ~3 GB):
`npm ci` (391 paquetes) + `next build`, 160 páginas estáticas, sin source maps públicos. Un único aviso, que ya
existía (`process.exit` en el arranque, Edge). Log: `logs/build-drl-0.1.1-1-08943cb7.log`.

## I–J. Servicio de la app y arranque automático
No hay systemd viable (sin sudo ni linger), así que se usa el **supervisor canónico del VPS**: Docker Compose con
`restart: unless-stopped` (el mismo patrón que Schola, ClipFlow y Hotel). dockerd está `enabled` al arranque.
Contenedor `valorosters-app`: `init`, uid 1000, `no-new-privileges`, `cap_drop: ALL`, 2 GB / 4 CPU,
healthcheck sobre `/api/health`.

## K. Bind de la app
`ports: 127.0.0.1:3005:3005`: solo el loopback del VPS. Desde Internet, `212.95.40.144:3005` está cerrado.

## L. Ruta interna a Supabase
`SUPABASE_INTERNAL_URL=http://supabase_kong_DRLCards:8000` (por la red Docker). Las reescrituras same-origin
(`/auth|rest|storage/v1`) y `serverSupabaseFetch` van por ahí. Navegador: `NEXT_PUBLIC_SUPABASE_URL=https://valorosters.com`
(sin cambios). Es el mismo comportamiento que en el PC (308/200/200 en las sondas de rewrite).

## M. Exposición de la BD
Postgres y Kong siguen en `127.0.0.1` del VPS y cerrados desde Internet (54521/54522/54523/54524/54527 comprobados).
Sin cambios de RLS, sin migraciones.

## N–Q. cloudflared en el VPS
Contenedor `valorosters-tunnel` con `cloudflare/cloudflared:2026.9.0`, fijado por digest (el mismo que Schola), uid 1000,
256 MB, `restart: unless-stopped`. **Mismo túnel `801a8447-a323-4df1-b777-7c7b3b7d7114`**: no se creó ninguno nuevo.
Ingress: `valorosters.com` y `www` → `http://valorosters-app:3005` (la app responde 308 de www al apex), y el resto
→ 404. La API de Cloudflare muestra **un único conector: origen 212.95.40.144, linux_amd64, fra08/10/17/21**.

## R. Cambios de DNS
Ninguno.

## S–U. Windows
Las tareas «DRLCards-Tunnel» y «DRLCards» están **deshabilitadas** (reversible: `Enable-ScheduledTask`; no se borró
ningún fichero ni config). cloudflared: 0 procesos. Next: parado (`drlcards-service.ps1 -Action stop`).
Túnel SSH 54521/54522: matado. 0 puertos escuchando y 0 conexiones establecidas con el VPS.

## V. Prueba de independencia del PC
Con todo lo anterior apagado: 20/20 rutas en 200 (12:57), E2E público 29/29, smoke 74/74 y production:check
desde Internet; nueva comprobación a las 13:10, con `/api/ready` 15/15 en 200. Ningún 1033, 502 ni 1014 con el PC
fuera. Los únicos 502/530 sueltos se vieron durante los reinicios provocados (AM).

## W–Y. Público, www y TLS
`https://valorosters.com` → 200. `https://www` y `http://` (apex y www) → 308 a `https://valorosters.com`.
Certificado Let's Encrypt (YE2), CN valorosters.com, caduca el 29-dic-2026; verificación OK y HSTS con preload.

## Z–AB. Health, ready y cabeza de migraciones
`/api/health` 200 (local y público). `/api/ready` → `ready`, todos los checks ok,
**`migrationHead: 0060_salvage_last_copy_atomic`**. BD: 47 ms desde el VPS (105 ms desde el PC).

## AC–AE. Login, sesión y logout
E2E público con una cuenta QA **nueva** registrada por el formulario (`qaf68v105901_d8da`, nunca la del usuario):
registro, sesión `sb-valorosters-auth-token`, F5 conserva la sesión, logout real y login de nuevo. is_admin=false y
APIs de admin → 401. GoTrue: SITE_URL ya era https://valorosters.com (sin cambios). Admins = 1.

## AF. Storage
Bucket `assets` (público para lectura), 0 objetos (igual que antes: los assets de runtime viven en `public/`).
Subida anónima → `403 new row violates row-level security policy`, y 0 objetos creados. Listado anónimo → `[]`.

## AG. F74 Forge presente
`/misiones`, `/misiones/crafting`, `/sobres` y `/cartas` → 200. Los chunks servidos contienen el código de `Forge.tsx`
(«Guardado en tus sobres sin abrir», el CSS `forge`), y el HTML lleva el build id `drl-0.1.1-1-08943cb7`.

## AH. Assets
E2E: 12 páginas × 3 anchos con 0 imágenes rotas, 0 peticiones a localhost y 0 contenido mixto.
production:check: 331/331 artes de carta, 29 agentes, 32 sobres con 0 rotos, 13 mapas.

## AI. Seguridad de admin y del cliente
Anónimo → 401 en `/api/admin/*`; `/api/esports/sync` sin secreto → 401. 404 en `.env`, `.env.local`, `.git/*`,
`package.json`, `next.config.mjs`, `*.map` y `/design-system/*`. Ni `service_role` ni `SYNC_SECRET` en los chunks.
`anon` → profiles 401. RLS activa en las 105 tablas públicas.

## AJ–AK. Puertos públicos y firewall
Abiertos desde Internet: 22, 80, 443 (Caddy de NEXUS) y 8080, todos de antes y ajenos a Valorosters.
Cerrados: 3005, 3101, 2000 y todos los de Supabase. UFW inactivo; Docker publica de Valorosters solo
`127.0.0.1:3005`. No se abrió ningún puerto.

## AL. Rotación de logs
json-file `max-size 10m × max-file 5` en los dos contenedores (≤ 50 MB cada uno), el mismo estándar que el resto del VPS.

## AM. Prueba de reinicio
Con una sonda pública cada segundo:
- `docker compose restart valorosters-app` → un 502 y en 1–2 s otra vez 200.
- `docker compose restart valorosters-tunnel` → 502 y 530, y en ~2 s otra vez 200.
- **Crash real** (`kill -9` del proceso node) → Docker lo relanzó solo (RestartCount 0→1): un 502 y después 200.

## AN. Reboot del VPS: NO hecho
1. `nexusadmin` no tiene sudo sin contraseña, así que no puede reiniciar.
2. No se puede demostrar que sea seguro para los demás: hay 20+ proyectos, y vector/edge_runtime de los dos Supabase
   están en bucle de reinicio desde hace semanas.
El arranque automático se basa en `docker.service enabled` + `unless-stopped` (el mismo mecanismo que mantiene Schola,
ClipFlow y Hotel). **Pendiente:** reboot de mantenimiento planificado por el dueño del VPS.

## AO. Otros servicios NEXUS
clipflow 200, hotel demo 200, quotes 404 JSON del propio Launcher, API de Schola 404 de NestJS en `/` (respuestas de
sus apps, sin errores de Cloudflare). Sus contenedores están healthy y con la hora de arranque anterior a F75.
Los contenedores no «Up» ya estaban así (bucles de vector/edge_runtime y contenedores parados hace 2 semanas).

## AP. production:check (`--app --vps`, BASE_URL público)
24 PASS · 1 WARN · 1 FAIL. El FAIL es `backup-offsite` (NOT_CONFIGURED, bloqueo externo conocido desde PRE-F70) y el
WARN es `auth-email` (SMTP Inbucket, bloqueo de release pública conocido). Ninguno tiene que ver con F75.
Salida: `qa/f75-vps-migration/production-check.{log,json}`. El JSON de F67 se restauró.

## AQ. Smoke
74/74 OK (`scripts/_f75-smoke-public.ts` = smoke oficial con Supabase por el camino público `https://valorosters.com`
en vez del túnel SSH; solo usa la clave anon).

## AR–AU. Producto
331 cartas · 29 agentes (29 publicados) · `GLOBAL_MARKET_ENABLED=false` · `PAYMENTS_ENABLED=false`.

## AV–AX. Cambios
- Código de producto: **ninguno**. La huella `drl-0.1.1-1-08943cb7` es la misma antes y después.
- Migraciones: ninguna; la cabeza sigue en 0060.
- Commit/push: ninguno.
- Ficheros nuevos: `scripts/ops/vps/valorosters/**`, `scripts/_f75-*.ts`, `scripts/multiplayer/_f75-qa.ts`
  (instrumentos fuera de CI), este informe y `qa/f75-vps-migration/`.
- Config de VPS: solo ficheros NUEVOS en `/opt/nexus/projects/valorosters/`; no se modificó ningún fichero existente,
  así que no hubo nada que respaldar. Se descargó la imagen `curlimages/curl` para una sonda.

## AY. Deuda de infraestructura
1. Reboot completo del VPS sin probar (AN).
2. Backups fuera del VPS sin activar (bloqueo externo previo).
3. SMTP real para Auth (bloqueo externo previo).
4. Un solo conector: cada reinicio del túnel o de la app deja 1–3 s de 502/530. Para cero cortes en los deploys haría
   falta una segunda réplica o un despliegue azul/verde.
5. `.env.local` del PC sigue con `SUPABASE_INTERNAL_URL=http://127.0.0.1:54521`, y los scripts locales necesitan el
   túnel SSH a mano (está bien: así ya no escriben en producción por accidente).
6. Las tareas de Windows están deshabilitadas, no borradas: hay que retirarlas cuando el usuario lo decida.
7. Conviven en el VPS 8080 público y cloudflared `:latest` en nexusedge (de otros proyectos, sin tocar).
8. El bug de ranked (`duel_pvp_status` → MATCHED antiguo) sigue como deuda de producto separada.

## Operación
```
ssh nexusadmin@212.95.40.144 /opt/nexus/projects/valorosters/bin/status.sh [--logs]
cd /opt/nexus/projects/valorosters && docker compose restart valorosters-app | valorosters-tunnel
docker logs --tail 100 -f valorosters-app
bin/deploy.sh <build-id>              # compila incoming/<build-id>.tar, exige BUILD_ID == <build-id>, activa
bin/deploy.sh --activate <release>    # rollback a una release anterior
```

## AZ. F75 GO / NO-GO
**GO.** CLOUDFLARED WINDOWS = OFF · SSH FORWARDS WINDOWS = OFF · TAREAS WINDOWS = DISABLED · PRODUCCIÓN = ONLINE
(con la confirmación de Cloudflare de un único conector, desde 212.95.40.144). Única reserva: el reboot completo del VPS
queda pendiente (AN); el arranque automático depende del mismo mecanismo que ya sostiene el resto de producción NEXUS.
