# F67 · genera los entregables JSON de docs/product/qa/fase67-production a partir de lo MEDIDO en la fase.
# Sin secretos. Los ficheros medidos directamente (startup, restart-recovery, restore-drill, load-test, memory-soak,
# production-check, smoke, f66-pve-regress) no se tocan.
import json, os
D = "docs/product/qa/fase67-production"
os.makedirs(D, exist_ok=True)
def w(name, obj):
    with open(os.path.join(D, name), "w", encoding="utf8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2); f.write("\n")

w("baseline.json", {
    "measuredAt": "2026-09-26 (antes de editar)",
    "git": {"branch": "arch/stabilization", "head": "48dac2a", "workingTree": "muy sucio (F17D…F66 sin commit)"},
    "tests": 5321, "cards": 331, "agents": 29, "migrationHead": "0057_admin_cms",
    "flags": {"GLOBAL_MARKET_ENABLED": False, "PAYMENTS_ENABLED": False},
    "runtime": {"app": ":3005 200 (next start sin -H: escuchaba en TODAS las interfaces, LAN 192.168.1.87)", "tunnel": "ssh 54521/54522"},
    "deps": {"next": "16.2.9", "sharp": "0.34.5 (solo transitiva)", "npmAudit": {"critical": 1, "high": 6, "moderate": 1, "low": 2}},
    "node": "v24.15.0 local; CI Node 22; sin engines ni .nvmrc",
})

w("architecture.json", {
    "diagram": [
        "navegador (sesión Supabase en localStorage, Bearer por petición)",
        "  → Next.js 16.3.6 `next start` (PC Windows, :3005, 127.0.0.1) — rutas /api/* con service_role en servidor",
        "      → túnel SSH 54521/54522 → VPS 212.95.40.144",
        "          → Kong (127.0.0.1:54521) → PostgREST · GoTrue(Auth) · Storage(file backend, volumen supabase_storage_DRLCards) · Realtime · edge_runtime",
        "          → Postgres 17.6 (supabase/postgres:17.6.1.165, 127.0.0.1:54522, volumen supabase_db_DRLCards)",
        "  VPS cron: nexus-backup.sh 04:30 (dump+tgz Storage+config, 14 días) · drlcards-sync */2 (worker esports, Node 22 aislado)",
    ],
    "facts": {
        "appHost": "NO hay app DRLCards en el VPS: la web corre en el PC del usuario (Windows) contra la BD del VPS por túnel",
        "realtime": "no se usa (HTTP + sondeo)",
        "workers": "drlcards-sync en el VPS por cron, flock + lease en BD, log con rotación por tamaño (5 MB, .1)",
        "externalServices": ["VLR (fuente esports, opcional)", "Anthropic (predicciones, opcional)", "Google Fonts (CSS/fuentes)", "flagcdn.com (banderas)"],
        "filesystemAssets": "public/ (cartas 331, agentes 29, sobres, mapas 13) dentro del build",
        "emails": "GoTrue → Inbucket (capturador local): NO se entregan correos reales",
    },
})

w("dependencies.json", {
    "CRITICAL": ["Node 22.12–24.x", "Postgres (supabase_db_DRLCards) vía PostgREST/Kong", "GoTrue (Auth) — sin él nadie inicia sesión", "env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY", "build .next (BUILD_ID = huella del código)", "public/ (arte de cartas/agentes/sobres)"],
    "DEGRADED": ["Storage (subidas del CMS; 0 objetos hoy)", "SYNC_SECRET (sync esports manual)", "worker esports (datos de torneos se quedan quietos)", "red a Google Fonts (tipografía de respaldo)"],
    "OPTIONAL": ["ANTHROPIC_API_KEY (heurística)", "NEXT_PUBLIC_VLR_API", "Realtime (no usado)", "analytics/vector/edge_runtime del stack"],
    "generatedAtBuild": ["src/data/catalog (manifiesto de cartas en código)", "agents snapshot (agents:snapshot)", "robots.txt (según NEXUS_PUBLIC_INDEXING)"],
})

w("config-audit.json", {
    "envVarsRead": ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SYNC_SECRET", "ESPORTS_SYNC_SECRET", "ESPORTS_AUTO_SYNC_*", "NEXUS_SANDBOX_CREDITS", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL(_BULK)", "NEXT_PUBLIC_ADMIN", "NEXT_PUBLIC_VLR_API", "NEXT_PUBLIC_TELEGRAM_WEBHOOK", "NEXT_DESKTOP", "NODE_ENV", "F67: NEXUS_QA_HARNESS, NEXUS_PUBLIC_INDEXING"],
    "findings": [
        {"id": "CFG-1", "severity": "HIGH", "what": "sin validación de env: sin Supabase la app arrancaba en «modo local» silencioso", "fix": "src/server/ops/env.ts + src/instrumentation.ts: en producción un CRÍTICO sale con exit 1 (medido: 486 ms, mensaje con el nombre de la variable)"},
        {"id": "CFG-2", "severity": "HIGH", "what": "`next start -p 3005` escuchaba en TODAS las interfaces (LAN)", "fix": "npm start = next start -H 127.0.0.1 -p 3005 (verificado: LocalAddress 127.0.0.1)"},
        {"id": "CFG-3", "severity": "MEDIUM", "what": "/design-system/* (≈30 arneses con fixtures) públicos en producción", "fix": "404 en producción salvo NEXUS_QA_HARNESS=1 (middleware)"},
        {"id": "CFG-4", "severity": "LOW", "what": "NEXT_PUBLIC_TELEGRAM_WEBHOOK viajaría al navegador", "status": "no definido hoy; la validación lo señala si aparece"},
        {"id": "CFG-5", "severity": "INFO", "what": "NEXUS_SANDBOX_CREDITS solo actúa fuera de producción (doble puerta)", "status": "ok"},
        {"id": "CFG-6", "severity": "INFO", "what": "localhost/127.0.0.1 solo en scripts de QA y allowedDevOrigins (dev)", "status": "ok"},
        {"id": "CFG-7", "severity": "BLOCKED", "what": "GoTrue: SITE_URL/URI_ALLOW_LIST = 127.0.0.1:3000, SMTP = Inbucket, MAILER_AUTOCONFIRM=true, PASSWORD_MIN_LENGTH=6", "status": "cambio de configuración del stack al tener dominio y SMTP (ver release checklist)"},
    ],
})

w("secret-audit.json", {
    "method": "búsqueda por VALOR de cada secreto de .env.local (sin imprimirlos) + patrones genéricos (JWT service_role, claves privadas, URLs de BD con contraseña) en .next/static, .next/server, public, docs, scripts, src, logs; git ls-files de .env/claves",
    "scannedSecretVars": ["SUPABASE_SERVICE_ROLE_KEY", "SYNC_SECRET"],
    "hits": 0,
    "gitVisible": {".env.local": "ignorado (.gitignore .env.*)", ".github/SECRETS.md": "solo nombres, sin valores", ".env.example": "solo nombres"},
    "screenshots": "no escaneables por contenido; ninguna captura muestra formularios con claves (capturas de juego)",
    "logs": "sin tokens: el log estructurado nuevo redacta campos pass/token/secret/authorization/cookie/key/email/jwt",
    "timingSafety": "las 3 rutas con x-sync-secret comparaban con `!==`; F67: secretMatches() (sha256 + timingSafeEqual)",
})

w("client-bundle-secrets.json", {
    "bundle": ".next/static (build F67, Next 16.3.6)", "serverSecretsFound": 0, "serviceRoleJwtFound": 0,
    "publicByDesign": {"NEXT_PUBLIC_SUPABASE_URL": "URL pública del proyecto", "NEXT_PUBLIC_SUPABASE_ANON_KEY": "clave anon (rol anon; la protección es RLS)", "NEXT_PUBLIC_ADMIN": "interruptor de UI, no autoridad"},
    "guard": "validateEnv falla si la clave pública tiene rol service_role",
    "sourceMaps": "sin .map públicos en .next/static",
})

w("env-validation.json", {
    "module": "src/server/ops/env.ts (puro, probado) · src/instrumentation.ts (arranque)",
    "critical": ["NEXT_PUBLIC_SUPABASE_URL (URL http/https válida)", "NEXT_PUBLIC_SUPABASE_ANON_KEY (no service_role)", "SUPABASE_SERVICE_ROLE_KEY (rol service_role)"],
    "degraded": ["SYNC_SECRET (≥16)", "NEXT_PUBLIC_TELEGRAM_WEBHOOK definido", "NEXUS_SANDBOX_CREDITS=1 o NEXUS_QA_HARNESS=1 en producción", "http sin TLS a host no local"],
    "optional": ["ANTHROPIC_API_KEY", "NEXT_PUBLIC_VLR_API"],
    "test": {"missingServiceKeyInProduction": "exit 1 en 486 ms; log «[startup] Configuración crítica incompleta … CRITICAL SUPABASE_SERVICE_ROLE_KEY: falta»", "firstAttempt": "con `throw` el proceso quedaba VIVO sin escuchar (exit 124 por timeout): se cambió a process.exit(1)"},
    "startupLog": "{level:warn, scope:startup, ok:true, issues:[OPTIONAL:ANTHROPIC_API_KEY…, OPTIONAL:NEXT_PUBLIC_VLR_API…]} (solo nombres)",
})

w("admin-security.json", {
    "authority": "verifyAdmin: GoTrue getUser(Bearer) + profiles.is_admin con service_role. Sin emails fijos, sin flags de cliente, sin allowlist por env.",
    "columnProtection": "is_admin no editable: GRANT UPDATE solo (username, region, avatar) + disparador profiles_guard_protected_columns",
    "routes": "23 rutas /api/admin/*: todas con runAdmin o verifyAdmin; 0 server actions",
    "edge": "middleware: 401 a /api/admin/* sin Bearer; no-store + noindex en /admin",
    "live": {"anon /api/admin/system": 401, "anon /api/admin/users": 401, "QA normal /api/admin/system": 401, "QA normal ajustar créditos": 401, "RPC app_admin_adjust_credits como usuario": 404, "RPC app_grant_reward como usuario": 404},
    "uiGate": "NEXT_PUBLIC_ADMIN solo muestra/oculta el panel; los datos no dependen de él",
    "f58Tests": "adminControlCenter.test (16) verdes",
})

w("rls-audit.json", {
    "method": "pg_class/pg_policies/role_table_grants en la BD real, sesión read-only (db-audit.raw.txt, rls-policies.raw.txt)",
    "rlsEnabled": "todas las tablas public con RLS activo",
    "denyAllTables": "duel_matches, duel_match_actions, duel_pvp_*, duel_friendships, duel_challenges, duel_active_deck, content_* (CMS), user_sanctions, content_audit_log, campaign_*, draft_* … (0 políticas → solo service_role)",
    "ownRowPolicies": "user_cards, user_game, user_pass, user_packs, credit_transactions, economy_ops, duel_decks, user_achievements, payments, inventory, pickem_*: SELECT auth.uid() = user_id",
    "clientWritePolicies": ["profiles UPDATE propio (columnas username/region/avatar) + INSERT propio", "game_state ALL propio (estado local legado, el servidor no confía en él)", "pickems ALL propio (legado)", "user_strats / user_compositions / coach_match_strats propios"],
    "findings": [
        {"id": "RLS-1", "severity": "MEDIUM", "what": "profiles SELECT true para anon/authenticated con TODAS las columnas (credits, xp, is_admin, last_seen_at…)", "proposal": "0058 H1"},
        {"id": "RLS-2", "severity": "LOW", "what": "INSERT en profiles concedido (mitigado por handle_new_user: PK ya ocupada)", "proposal": "0058 H2"},
        {"id": "RLS-3", "severity": "LOW", "what": "TRUNCATE concedido a anon/authenticated (no pasa por RLS; no alcanzable vía PostgREST, Postgres en 127.0.0.1)", "proposal": "0058 H3"},
        {"id": "RLS-4", "severity": "LOW", "what": "SECURITY DEFINER ejecutables por anon sin auth.uid(): recompute_standings/team_stats/player_event_stats, expire_offers", "proposal": "0058 H4"},
    ],
    "proposalFile": "docs/operations/proposals/0058_hardening_grants.PROPOSAL.sql (NO aplicada, con rollback)",
})

w("cross-user.json", {
    "actor": "QA C 40a1e10d", "victim": "QA B 8c326e52", "channel": "PostgREST directo con clave anon + JWT de C (lo que podría hacer un cliente malicioso)",
    "reads": {t: "0 filas" for t in ["user_cards", "user_game", "user_pass", "user_packs", "credit_transactions", "economy_ops", "duel_decks", "duel_matches (403)", "user_achievements", "game_state", "duel_pvp_queue (403)", "duel_active_deck (403)", "user_sanctions (403)", "payments"]},
    "publicProfile": "visible por diseño; expone columnas de más (RLS-1)",
    "writes": {"renombrar a B": "0 filas", "borrar perfil de B": "0 filas", "ganar partida propia": "403", "insertar cartas": "403", "asiento de créditos": "403"},
    "f66": "IDOR de partidas: 404 idéntico para ajena/inexistente (vigente, e2e-f67-regress verde)",
    "result": "aislamiento correcto; única exposición = columnas públicas de profiles",
})

w("input-security.json", {
    "requestSize": {"before": "≈25 rutas con `await req.json()` sin límite", "after": "middleware: 413 por Content-Length (juego 256 KB, admin 1 MB, subidas 25 MB); verificado 300 KB → 413", "limitation": "un cuerpo sin Content-Length (chunked) lo acotan las propias rutas"},
    "massAssignment": "ninguna ruta vuelca el cuerpo en insert/update; /api/game/credits rechaza campos del servidor (400 «El cliente no decide credits»); escaladas por REST: todas rechazadas (smoke)",
    "xss": {"live": "nombre <img src=x onerror=…> guardado y renderizado como TEXTO en /jugador/<id>, no ejecutado; restaurado", "code": "solo 1 dangerouslySetInnerHTML (logo estático); sin HTML/markdown de usuario"},
    "sqlInjection": "sin SQL crudo; filtros .or()/ilike construidos con entrada limpiada (solo admin salvo búsqueda social con normalizeQuery)",
    "pathTraversal": "lecturas de fichero por entrada solo en admin (releases con rechazo de / \\ ..; cards por manifiesto)",
    "openRedirect": "no hay parámetros next/returnTo/redirect; los redirectTo de Auth son el propio origen",
    "uploads": {"cms": "firma+extensión+MIME+tamaño+dimensiones, decodificación completa con sharp (limitInputPixels), sha256 dedupe, ruta UUID, upsert:false", "legacyAssets": "F67: el campo url solo acepta http(s) o ruta propia; + cubeta upload_write", "cardArtwork": "png/webp por firma, 12 MB, sin decodificación (deuda menor)"},
    "errorLeakage": {"before": "≈20 rutas devolvían error.message de BD/excepción en 500", "after": "internalError(): «Algo ha fallado en el servidor. Código: XXXXXX» + log estructurado con el mismo código; social/matchmaking/sync/admin incluidos", "test": "ops.test + smoke (JSON roto, 401/404 sin detalles)"},
})

w("rate-limits.json", {
    "architecture": "contador en Postgres (RPC app_rate_take, tabla api_rate_limits) → compartido por todos los procesos Node; falla ABIERTO si la BD no responde. /api/telemetry tiene un limitador en memoria propio (por proceso).",
    "added": {"economy_write": "30/min — packs, store, credits, progression, prestige, mastery, economy (POST)", "upload_write": "20/min — /api/admin/assets"},
    "existing": ["pvp_sync 150", "pvp_action 40", "mm_status 90", "mm_write 20", "social_*", "deck_*", "campaign_*", "collection_*", "draft_*", "admin_read 240 / admin_write 20", "onboarding_*", "season/events/daily_loop/profile"],
    "stillWithout": ["game/competitive, state, meta, strats, match-strats, coach-matches, compositions (lecturas o con validación propia)", "pickems, content/*", "esports/* y market/sync-reference (protegidas por secreto)"],
    "underLoad": "429 solo en play-status (cubeta por usuario, un único usuario QA generando todo el tráfico) = INTENCIONAL; 0×5xx",
    "normalPlay": "e2e F66 regresión: 0×429 en una partida normal",
})

w("logging.json", {
    "before": "≈75 console.error/warn sin formato común ni código de error; sin request id",
    "after": {"module": "src/server/ops/log.ts", "format": "una línea JSON {t, level, scope, msg, …ctx} a stdout/stderr", "errorIds": "6 caracteres sin ambigüedad; viajan al cliente («Código: 7F3K9Q») y están en la línea de log", "redaction": "pass/token/secret/authorization/cookie/key/email/jwt → [redactado]", "requestId": "x-request-id en todas las /api (middleware), eco en la respuesta y disponible para la ruta"},
    "workers": "drlcards-sync: log propio con rotación 5 MB en el VPS",
    "rotation": "la app escribe a stdout: la rotación la hace el gestor (journald/systemd o redirección con logrotate) — plantilla en docs/operations/drlcards-production.md",
    "adminOps": "auditoría append-only en content_audit_log (F58)",
})

w("health.json", {
    "liveness": {"route": "/api/health", "body": "{status, uptimeS, version, node}", "deps": "ninguna"},
    "readiness": {"route": "/api/ready", "checks": ["config (validateEnv)", "database (HEAD profiles, 3 s)", "schema (app_admin_schema_probe: 6 claves 0055/0057)", "catalog (content_cards = 331)", "storage (listBuckets)"], "status": "ready | degraded (no crítico) | not_ready (503)", "cache": "15 s, un solo vuelo por proceso (10 lecturas simultáneas = 1 sonda, test)", "noSecrets": "sin hosts, valores ni mensajes de error"},
    "measured": {"cold": "ready en 1.262 ms tras arrancar", "checksMs": {"database": 102, "schema": 114, "catalog": 92, "storage": 98}},
    "alignment": "/admin/system sigue siendo la vista detallada (flags, economía, progresión, contenido, multijugador F66); /api/ready usa las MISMAS sondas y la MISMA cabeza (server/ops/release.ts): un sistema, dos niveles de detalle",
})

w("process-management.json", {
    "current": "npm start (next start -H 127.0.0.1 -p 3005) lanzado a mano en el PC Windows; NO hay gestor de procesos, NO arranca con el sistema",
    "vps": {"docker": "enabled + active", "containers": "12 contenedores supabase_*_DRLCards con restart=unless-stopped → vuelven solos tras reinicio", "cron": "backups 04:30 y worker */2 en crontab de nexusadmin → vuelven solos", "ports": "todos ligados a 127.0.0.1"},
    "vpsRebootModel": "tras reiniciar el VPS: Docker arranca, los contenedores vuelven (unless-stopped), cron sigue. Lo que NO vuelve: el túnel SSH del PC (hay que reabrirlo) y la app del PC.",
    "prepared": "plantilla systemd (Restart=on-failure, EnvironmentFile, ExecStartPre=production:check) en docs/operations/drlcards-production.md — NO instalada (no hay host Linux de app y no hay sudo en el VPS)",
    "gracefulShutdown": "next start gestiona SIGTERM/SIGINT (cierra el servidor HTTP). En Windows no hay SIGTERM real: Stop-Process es una parada dura; medido: la BD queda consistente porque cada escritura es atómica y condicionada (F66).",
    "crashTest": "restart-recovery.json: kill -9 con tráfico, 2,8 s sin servicio, estado QA idéntico",
    "maintenanceMode": "no existe (hay un ErrorKind 'maintenance' sin disparador). Para migraciones críticas: parar el proceso (no hay tráfico público) o cerrar el túnel; se propone un interruptor NEXUS_MAINTENANCE en el middleware para cuando haya tráfico real (no implementado: sin uso hoy).",
})

w("backup-audit.json", {
    "existing": {"script": "/opt/nexus/scripts/nexus-backup.sh (cron 30 4 * * *)", "db": "pg_dump -Fc de supabase_db_DRLCards, validado con pg_restore -l, .sha256, retención KEEP_DAYS=14 (16 ficheros hoy)", "storage": "tar.gz del volumen supabase_storage_DRLCards + .sha256, 14 días", "config": "tar de /opt/nexus/projects (incluye env de servicios) 600", "lastRun": "2026-09-26 04:30 ok (fallos=0)", "location": "/opt/nexus/backups en el MISMO disco del VPS", "encryption": "no (permisos 600/700, usuario nexusadmin)", "offsite": "NO — el propio script lo declara el riesgo abierto más importante"},
    "f60Debt": "«Storage fuera de la copia diaria» YA NO es cierto: nexus-backup.sh incluye el volumen desde 2026-09-12. Pero el volumen está VACÍO (0 ficheros; storage.objects = 0; bucket «assets» público).",
    "f67Added": {"script": "scripts/ops/backup-drlcards.sh (por ssh, sin copiar nada al VPS)", "adds": ["manifest.json", "table-counts.tsv (25 recuentos exactos)", "storage-files.sha256 (por fichero)", "storage-objects.tsv (inventario BD)", "SHA256SUMS verificado", "marcador COMPLETE", "exit≠0 ante destino/permisos/disco/contenedor"], "run": "/opt/nexus/backups/supabase-drlcards/f67/20260926T204632Z (7 s)"},
    "failureTests": {"destino sin permisos": "exit 1", "contenedor inexistente": "exit 1", "disco insuficiente": "exit 1"},
    "defectsFoundInOwnScript": ["`docker exec -i` se tragaba el resto del script por stdin → exit 0 sin backup (corregido: </dev/null y marcador BACKUP_OK/COMPLETE)", "psql imprimía SET y corrompía el JSON (corregido: PGOPTIONS)"],
    "leftovers": "f67/20260926T204528Z (INCOMPLETE) y f67/20260926T204554Z (SUPERSEDED): marcados, no borrados",
})

w("backup-manifest.json", {
    "path": "/opt/nexus/backups/supabase-drlcards/f67/20260926T204632Z",
    "createdAt": "20260926T204632Z", "postgres": {"image": "public.ecr.aws/supabase/postgres:17.6.1.165", "serverVersion": "17.6", "databaseBytes": 43486355, "schemaProbe": "12/12 true"},
    "db": {"bytes": 2863728, "sha256": "90f44e73408098a337357a72156a8d131e3c1d73e82d681e5426cf6a220a1061", "tocEntries": 1970, "authUsers": 18},
    "storage": {"bytes": 87, "sha256": "380fc998ad257890510d25e3b751d84ed62b7d65bd5a070f008fbfd894ab2b64", "files": 0, "objectsInDb": 0, "buckets": "assets:public"},
    "tableCounts": {"profiles": 18, "user_cards": 497, "user_game": 18, "user_pass": 8, "user_packs": 45, "credit_transactions": 162, "economy_ops": 195, "duel_decks": 8, "duel_matches": 176, "duel_match_actions": 2315, "duel_pvp_queue": 78, "duel_pvp_ratings": 9, "duel_pvp_rating_events": 60, "duel_friendships": 2, "duel_challenges": 101, "content_cards": 331, "content_card_versions": 331, "content_packs": 0, "content_pools": 51, "content_pool_entries": 5027, "agents": 29, "user_achievements": 9, "user_sanctions": 1, "content_audit_log": 477, "auth.users": 18},
    "consistency": "no atómico BD↔Storage (segundos de diferencia); hoy irrelevante con 0 objetos",
})

w("storage-backup.json", {
    "backend": "Supabase Storage con STORAGE_BACKEND=file, FILE_STORAGE_BACKEND_PATH=/mnt = volumen supabase_storage_DRLCards",
    "content": "0 ficheros, 4 KB; storage.objects = 0; 1 bucket «assets» (público, sin límite de tamaño ni MIME a nivel de bucket)",
    "backup": "diario (nexus-backup.sh) + F67 con lista sha256 por fichero e inventario de storage.objects",
    "restore": "drill: extracción y comparación fichero a fichero OK (0/0)",
    "risk": "el día que haya subidas del CMS, el mismo procedimiento las cubre; ventana no atómica BD↔Storage documentada",
})

w("rpo-rto.json", {
    "RPO": {"current": "≤ 24 h (dump diario 04:30) — más los snapshots manuales pre-migración", "vpsLoss": "TOTAL: las copias están en el mismo disco (sin copia externa) → BLOCKED hasta tener destino externo", "zeroLoss": "NO: no hay replicación ni WAL archiving"},
    "RTO": {"dbRestoreObserved": "28 s (Postgres listo 16 s + restore 6 s + validación 5 s + Storage 1 s) para 41 MB", "appColdStart": "1,3 s hasta ready", "appCrashRecovery": "2,8 s sin servicio", "vpsLostEstimate": "2–4 h con el runbook de DR (host nuevo + Docker + stack Supabase + restore + env + túnel/proxy) si existe copia externa; sin copia externa: no recuperable"},
})

w("dependency-audit.json", {
    "before": {"critical": 1, "high": 6, "moderate": 1, "low": 2},
    "after": {"critical": 0, "high": 3, "moderate": 1, "low": 2},
    "fixed": [
        {"pkg": "next 16.2.9 → 16.3.6 (dentro de ^16)", "why": "CRÍTICO: RCE no autenticado en servidores Windows (este host) y en Image Optimization con AVIF; bypass de middleware/proxy (<16.2.11)", "verified": "5334 tests, build, smoke 67/67, e2e F66 caos, F64 9,5 pet/pantalla"},
        {"pkg": "sharp → dependencia DIRECTA ^0.35.4 (antes transitiva 0.34.5)", "why": "deuda F60 + CVE libvips/libheif <0.35.4; la usa la subida del CMS", "verified": "tests de subida F60 verdes"},
        {"pkg": "postcss ^8.5.28 (dev)", "why": "path traversal / lectura por sourceMappingURL (build)"},
    ],
    "remaining": [
        {"pkg": "eslint / @eslint/plugin-kit", "severity": "low", "class": "dev-only (ReDoS en comentarios de config)"},
        {"pkg": "brace-expansion", "severity": "high", "class": "dev/build transitiva (glob de herramientas)"},
        {"pkg": "browserslist", "severity": "high", "class": "build-time (consultas de navegadores)"},
        {"pkg": "js-yaml", "severity": "high", "class": "dev transitiva (eslint)"},
        {"pkg": "baseline-browser-mapping", "severity": "moderate", "class": "build-time"},
    ],
    "policy": "sin npm audit fix --force; sin actualización masiva; lockfile v3 actualizado solo en los paquetes citados",
    "reproducibility": {"lockfile": "package-lock.json v3 en sincronía (npm ls sin errores; @emnapi/runtime extraneous heredado)", "npmCi": "viable (lockfile coherente); no ejecutado para no destruir node_modules", "node": "engines >=22.12.0 <25, .nvmrc 24.15.0 (CI usa 22)"},
})

w("schema-drift.json", {
    "expected": "0057_admin_cms (código, server/ops/release.ts)",
    "production": "sonda app_admin_schema_probe: 12/12 claves en verde (0040…0057); tablas presentes; 122 tablas públicas",
    "registry": "supabase_migrations.schema_migrations solo registra 0001–0025 (0026–0057 aplicadas a mano, documentado desde F24.7) → no sirve como verdad; la sonda sí",
    "notes": ["draft_gauntlet_runs/user_favorites no existen con esos nombres: las migraciones usan draft_runs y user_card_favorites (sonda en verde)", "content_packs existe con 0 filas (CMS de sobres sin uso)"],
    "drift": "ninguno detectado",
    "autoApply": "la app NO aplica migraciones al arrancar (production:check lo verifica)",
})

w("data-integrity.json", {
    "method": "consultas de solo lectura en la BD real (db-audit.raw.txt)",
    "checks": {"negative_credits": 0, "user_cards_unknown_card": 0, "duplicate_serials": 0, "users_in_two_live_pvp": 0, "live_pvp_overdue_5min": 0, "self_matches": 0, "finished_without_result": 0, "pvp_settled_twice": 0, "ledger_dup_ref": 0, "queue_matched_orphan": 0, "queue_active_per_user_gt1": 0, "active_deck_missing": 0, "pve_in_progress_older_7d": 0},
    "admins": 1, "anomalies": "ninguna",
})

w("qa-data.json", {
    "authUsers": 18, "qaLike": 17, "real": 1,
    "identification": "cuentas QA con email @example.invalid o prefijo qa (17/18); la única cuenta no QA es la del usuario (2f86cbe8)",
    "residue": "partidas ranked/privadas/PvE de F63–F67, amistades D–E y F–G, ratings QA, entradas de cola históricas; se conservan (borrarlas rompería libro mayor/series)",
    "policy": "métricas de beta: excluir user_id de cuentas @example.invalid; propuesta futura: columna/flag is_qa en profiles escrita solo por service_role (requiere migración, no aplicada)",
})

w("storage-security.json", {
    "buckets": [{"id": "assets", "public": True, "fileSizeLimit": None, "allowedMimeTypes": None, "objects": 0}],
    "policies": "storage: 0 políticas → solo service_role escribe (la subida pasa por /api/admin/* con verifyAdmin y validación completa)",
    "exposure": "bucket público pensado para arte del CMS; hoy vacío. Recomendación: límite de tamaño y MIME a nivel de bucket al empezar a usarlo",
})

w("security-headers.json", {
    "present": {"Content-Security-Policy": "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' fonts.googleapis.com; img-src 'self' data: blob: https: <supabase>; connect-src 'self' <supabase> wss <supabase> flagcdn.com", "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()", "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload (ignorado en http local)", "Cross-Origin-Opener-Policy": "same-origin (F67)"},
    "removed": {"X-Powered-By": "poweredByHeader: false (F67)"},
    "cache": {"/_next/static": "public, max-age=31536000, immutable", "html estático": "s-maxage=31536000 (purgar CDN al publicar)", "api": "no-store en rutas con datos", "public/cards": "max-age=0 (revalida)"},
    "hstsNote": "preload + includeSubDomains es irreversible en la práctica una vez enviado a la lista: confirmar el dominio definitivo antes de enviarlo",
})

w("cors-csp.json", {
    "cors": "ninguna ruta, middleware ni config emite Access-Control-Allow-*: solo mismo origen (correcto; la app y la API son el mismo origen)",
    "csp": {"scriptUnsafeInline": "necesario: Next App Router inyecta scripts inline de hidratación sin nonce; con nonce habría que renderizar dinámicamente todo (sin beneficio con 0 HTML de usuario)", "styleUnsafeInline": "necesario: estilos inline de React/framer-motion y variables CSS por atributo", "unsafeEval": "solo en dev", "violations": "0 errores de consola en 26 pantallas × 2 anchos (F64 regress)"},
})

w("resource-usage.json", {
    "app(PC)": {"idleRssMb": "112–145", "underLoadRssMb": "≈285 estable (soak 5 min)", "handles": "≈230 en reposo, ≈300 bajo carga, vuelve a 233"},
    "vps": {"host": "16 vCPU, 62,8 GiB RAM, disco 493 GB (463 GB libres)", "drlcardsContainers": {"db": "284 MiB · 1,3 % CPU", "kong": "314 MiB", "realtime": "273 MiB", "analytics": "766 MiB", "studio": "203 MiB", "rest": "147 MiB", "storage": "125 MiB", "pg_meta": "104 MiB", "auth": "34 MiB", "inbucket": "17 MiB"}, "note": "el VPS aloja otros proyectos (hotel, sportcoach, schola…): no se confunden (solo contenedores *_DRLCards)"},
    "db": {"sizeMb": 41, "backupsMb": 78},
})

w("regressions.json", {
    "F61": "huella dorada F61 MOTOR 01 verde; e2e F66 caos en Next 16.3.6: 10 turnos, final/desempate/recarga correctos",
    "F62": "PvE paga una vez (+120 = premio, f66-pve-regress); progresión sin cambios",
    "F63": "/api/game/onboarding 200; primera partida PvE = mismo playTurn",
    "F64": "0 errores de consola, 0 desbordes, 9,5 peticiones API por pantalla (igual que F64 en el mismo conjunto), JS algo más ligero",
    "F65": "lab.test verde, huella de buildOpponentDeck intacta, ninguna propuesta aplicada",
    "F66": "e2e dos clientes caos verde; PvE 1×200/9×409 en BD real (tras el arreglo de versión de F67); IDOR/404 uniforme vigente",
    "F58/F60": "adminControlCenter (16) y tests de subida verdes; admin 401 para usuario normal (smoke)",
    "engineChanged": False, "balanceChanged": False, "economyChanged": False, "cardsChanged": False, "agentsChanged": False, "migration": False,
})
print("ok")
