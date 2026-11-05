# FASE 24.8 — VPS ESPORTS SYNC WORKER · Worker aislado, deploy reproducible y autosync real

**Estado:** completada con UNA desviación declarada (scheduler por cron en vez de systemd: el VPS no ofrece root) · **Fecha:** 2026-09-14
**Rama:** `arch/stabilization` · **HEAD:** `48dac2a` · **Sin commit/push** · **Sin Docker nuevo** · **Sin puertos abiertos** · **Marketplace intacto**

> Todo lo que sigue se ejecutó y midió en el VPS `212.95.40.144` contra la Supabase local del stack
> `supabase-drlcards`. El autosync está **ACTIVO** desde las 09:34Z por un worker oneshot que no
> depende del PC. Nada de lo que no se ejecutó se marca como hecho.

| Bloque | Estado |
|---|---|
| Worker aislado (bundle autocontenido, sin Next/React) | ✅ construido, probado, desplegado |
| Runtime Node en el VPS | ✅ Node 22.23.2 aislado bajo el proyecto (sin tocar el host) |
| Deploy reproducible (manifest + hashes + release atómica) | ✅ |
| Dry run desde el VPS con cero escrituras | ✅ |
| Kill switch OFF/ON probado en el VPS | ✅ |
| Scheduler | ✅ **cron de nexusadmin cada 2 min** (systemd: no viable sin root, ver §10) |
| Ciclos automáticos observados | ✅ 3 (1 con switch OFF, 2 con ON: noop por policy, sin fetch) |
| Single-flight real | ✅ lease en BD (2 instancias) + flock del wrapper |
| Scoring/champion/advance reales | ⏳ pendientes del primer resultado (Champions empieza el 24-09) |

---

## 1. Arquitectura final

```
cron nexusadmin (*/2)  →  bin/run-sync.sh (flock, env 600, log)
                        →  runtime/node (22.23.2)  current/dist/worker.cjs  [oneshot, exit 0/1/2]
                        →  runWorkerOnce() → runEsportsSync()  (el MISMO core de 24.6/24.7)
                        →  http://127.0.0.1:54521 (kong → PostgREST → supabase_db_DRLCards)
                        →  matches · estructura · Pick'ems · scoring · rewards · salud · notifications
```

## 2. Por qué no depende del PC

El worker y su runtime viven en `/opt/nexus/projects/drlcards-sync/`; el cron del VPS lo despierta
cada 2 minutos y el core decide, por policy, si toca la fuente. El PC solo sirve el frontend (que lee
la misma BD) y el trigger HTTP manual; apagado el PC, el pipeline sigue.

## 3. Precheck local y clasificación del working tree

576 ficheros sin commit (docs 107, components 101, app 65, domain 47, lib 41, server 29, migraciones
21…). No se limpió nada. El bundle lo decide **esbuild siguiendo los imports reales** del
entrypoint: 56 ficheros fuente (24 de ellos sin commit, declarados en el manifest), ninguno de
`src/app`, `src/components`, `src/store`, `src/design` (el build aborta si alguno entra). Áreas:
`src/lib/esports/{autosync,sync,supabase}` (16+1), `src/importer-vlr` (14), `src/importer` (13),
`src/server/services/{pickemLifecycle,pickems,rewards}` (3), `src/server/worker` (1),
`src/domain/{pickems,esports}` (5), `src/intel/identity` (1). Dependencias empaquetadas:
`@supabase/supabase-js@2.108.2` y sus submódulos, `iceberg-js@0.8.1`, `tslib@2.8.1` (todo JS puro).
Node objetivo: **22** (CI `node-version: 22`; el VPS usa `node:22` para sus otras apps).

## 4. Worker

- `src/server/worker/esportsAutosyncWorker.ts` — `runWorkerOnce()`: 1) kill switch antes que nada
  (scheduled sin dry run y `ESPORTS_AUTO_SYNC_ENABLED != true` → log y exit 0, sin cliente, sin
  red); 2) configuración server-only (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
  ausente → exit 2, solo nombres en el log; 3) el core con `origin`. Exit 0 = ok/noop
  (nada toca, lock ocupado, disabled), 1 = fallo real, 2 = configuración.
- `scripts/esports-autosync-worker.ts` — entrypoint: env solo por variables (no lee `.env.local`),
  rechaza URLs y `clave=valor` por argumento, una pasada y `process.exit`. Sin `--loop`.
- `scripts/build-esports-worker.mjs` (`npm run esports:worker:build`) — bundle cjs `deploy/drlcards-sync/dist/worker.cjs`
  (974 077 bytes), `MANIFEST.txt` (sha256 por fichero fuente), `SHA256SUMS`, `package.json` mínimo.
  `deploy/drlcards-sync/` está en `.gitignore`.
- Core: `RunDeps.origin` y `SyncRunSummary.origin` (metadato `worker-vps` en salud y log).

## 5. Bundle / manifest / build id

`build_id: 48dac2a+worker.996d06fd` (HEAD + sha8 del manifest; **no es un commit**). Bundle
`sha256 872f5449d8c2e918459a0cf8244dac1dd887db020c066ab3128d464fe13d0e34`. Manifest en
`docs/product/qa/fase24-8/manifest.txt`, sumas en `hashes.txt` (verificadas en el VPS con
`sha256sum -c`: `dist/worker.cjs: OK`, `MANIFEST.txt: OK`).

## 6. Runtime Node

`/opt/nexus/projects/drlcards-sync/runtime/node → node-v22.23.2-linux-x64` (tarball oficial de
nodejs.org verificado contra `SHASUMS256.txt`: `OK`). Sin apt, sin `curl | bash`, sin tocar `PATH`
del host: solo el wrapper lo usa. Debian 13, x86_64.

## 7. Directorio y release atómica

```
/opt/nexus/projects/drlcards-sync/
  runtime/node -> node-v22.23.2-linux-x64
  releases/rel-20260914T093113Z-996d06fd/{dist/worker.cjs, MANIFEST.txt, SHA256SUMS, package.json}
  current -> releases/rel-20260914T093113Z-996d06fd
  env/esports-sync.env   (700 el dir, 600 el fichero)
  bin/run-sync.sh        (flock + carga de env + log)
  logs/esports-sync.log  (rotación por tamaño, 5 MB)
```
Usuario de ejecución: `nexusadmin` (no root; es el dueño de todos los stacks del VPS).

## 8. Env

`env/esports-sync.env` (600): `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54521`,
`SUPABASE_SERVICE_ROLE_KEY=…`, `ESPORTS_AUTO_SYNC_ENABLED=true` (OFF hasta validar; ON desde 09:34Z),
`ESPORTS_SYNC_ORIGIN=worker-vps`. Sin `SYNC_SECRET` (el worker no llama a HTTP). Intervalos: los de
24.6 por defecto, sin tocar. Los valores se copiaron por stdin del `.env.local` del PC; nunca se
imprimieron.

## 9. Conexión Supabase local

Solo `127.0.0.1:54521` (kong → PostgREST). Sin IP pública, sin Postgres expuesto, sin firewall
tocado, sin puerto nuevo escuchando (`ss -tlnp` sin procesos node).

## 10. Service / timer (desviación declarada)

`sudo -n true` → «a password is required» y `loginctl enable-linger` → «Access denied»: sin root no
se pueden instalar unidades de sistema, y las unidades `--user` mueren con la sesión SSH. El
mecanismo que YA usa el VPS para tareas periódicas de `nexusadmin` es **cron** (backups 03:30/04:30).
Se instaló:

```
*/2 * * * * /opt/nexus/projects/drlcards-sync/bin/run-sync.sh >/dev/null 2>&1
```
preservando las dos entradas existentes (copia previa en `logs/crontab.backup-*.txt`). Es oneshot:
no hay loop paralelo; el wrapper serializa con `flock` y el core con el lease en BD. Migrar a
`nexus-drlcards-esports-sync.service/.timer` (Type=oneshot, `OnUnitActiveSec=2min`,
`EnvironmentFile=` el mismo fichero) es trivial en cuanto haya root; la unit propuesta queda en §20.

## 11. Policy

La misma de 24.6: live 2 min · active 10 · upcoming_soon 30 · recently_finished 60 · future 6 h ·
archived nunca. Champions 2026 = `future` → siguiente 15:12Z; EMEA Stage 2 = archivado (no se sondea).

## 12. Kill switch

- OFF (scheduled): exit 0, 0,1 s, sin fetch, sin escrituras (contadores idénticos).
- ON temporal (scheduled): 2 eventos comprobados, 0 tocan, 238 ms, lock adquirido/liberado, solo la
  salud escrita; devuelto a OFF; reactivado a ON para la activación definitiva (§13).

## 13. Primer ciclo automático (cron 09:34:01Z, switch OFF)

`kill switch OFF … exit 0`, 103 ms. Switch a ON a las 09:34:19Z.

## 14. Segundo y tercer ciclo (09:36:01Z y 09:38:01Z, switch ON)

Ambos: `events_checked=2 events_due=0`, 333 ms y 274 ms, `status=success`, `exit=0 reason="noop:
ningún evento toca"`, siguiente 15:12Z, **sin descarga de VLR** (duración de centenas de ms frente a
16 s cuando descarga). Ciclos posteriores (09:40…) idénticos. Contadores de datos sin cambio
(matches 101, preguntas 23, notifications 4).

## 15. Lock

Prueba real con dos instancias concurrentes (`--manual --force`, sin wrapper): A adquiere el lease y
sincroniza (16 s, `unchanged`); B a 1,5 s: `lock_busy … skipped=locked` en 63 ms, exit 0, sin
descarga. Dos wrappers a la vez: el segundo sale por `flock` («otra pasada en curso»). Lock `idle`
tras cada pasada. La caducidad del lease está cubierta por los tests de 24.6 (no se mató ningún
proceso en producción).

## 16. Health

`sync_state['esports:autosync']`: `ok`, `last_synced_at` = último ciclo, `lastDurationMs`,
`consecutiveFailures: 0`, `lastResult.origin: "worker-vps"`, memoria de `vlr-2766`. `/admin/operations`
lee esta fila (no se abrió la pantalla: exige sesión admin).

## 17. Security

Env 600 en dir 700; sin secretos en cron, args, `ps` ni logs (`grep` de la clave sobre la evidencia:
0); sin servidor HTTP; sin puerto; BD por loopback; allowlist `www.vlr.gg` en el fetcher; usuario
no root; bundle verificado por hash; runtime verificado por SHASUMS oficial.

## 18. Recursos

Pasada con descarga: wall 16,2 s, CPU 0,9 s, RSS máx. 159 MB. Pasada noop: ≈0,4 s. Host: RAM
7/64 GB, `supabase_db` 1 % CPU, kong ≈17 % solo durante la descarga. Sin degradación.

## 19. Rollback

1. `sed -i 's/^ESPORTS_AUTO_SYNC_ENABLED=.*/ESPORTS_AUTO_SYNC_ENABLED=false/' /opt/nexus/projects/drlcards-sync/env/esports-sync.env`
   (efecto en el siguiente minuto par: exit 0 sin sync). 2. Si hace falta parar el cron: `crontab -e`
   y comentar la línea del worker (o restaurar `logs/crontab.backup-*.txt`). 3. Código: `ln -sfn
   releases/<anterior> current`. NO revertir 0045. NO borrar datos.

## 20. Procedimiento de actualización

1. PC: gates verdes → `npm run esports:worker:build` → anotar `build_id` de `deploy/drlcards-sync/MANIFEST.txt`.
2. `scp` de `dist/worker.cjs`, `MANIFEST.txt`, `SHA256SUMS`, `package.json` a
   `releases/rel-<ts>-<sha8>/` (nunca el working tree, `.env.local` ni `node_modules`).
3. VPS: `sha256sum -c SHA256SUMS` → `chmod 755 dist/worker.cjs` → `bin/run-sync.sh --dry-run --manual`
   apuntando a la nueva release (probar con `current` aún en la anterior: `node releases/<nueva>/dist/worker.cjs --dry-run --manual`).
4. `ln -sfn releases/<nueva> current` (atómico; el cron toma la nueva en el siguiente ciclo). Rollback: symlink a la anterior.
5. Con root, unit systemd sugerida: `[Service] Type=oneshot User=nexusadmin WorkingDirectory=/opt/nexus/projects/drlcards-sync
   EnvironmentFile=/opt/nexus/projects/drlcards-sync/env/esports-sync.env ExecStart=/opt/nexus/projects/drlcards-sync/runtime/node/bin/node current/dist/worker.cjs
   TimeoutStartSec=300 NoNewPrivileges=true PrivateTmp=true ProtectSystem=strict ReadWritePaths=/opt/nexus/projects/drlcards-sync/logs`
   + `[Timer] OnBootSec=2min OnUnitActiveSec=2min Persistent=true`, y retirar la línea de cron.

## 21. Tests / gates

`npm test` **1243/1243** (8 nuevos del worker) · typecheck web y scripts ✅ · build ✅ · security,
pack, content, distribution, importer-vlr, competitive ✅ · eslint sobre worker/autosync/scripts ✅.
Sin modificar tests existentes.

## 22. P2

Los de 24.6/24.7 (standings `qualified`, scoreboard sin cambio de marcador, índices no diferibles,
`schema_migrations` desincronizada, `vector`/`edge_runtime` en Restarting, mapas «TBD»), más:
scheduler en cron por falta de root (migrar a systemd cuando lo haya); logs en fichero con rotación
simple (sin journald); el `origin` no distingue aún trigger HTTP (`pc-manual` si se declara).

## 23. Pendiente del primer partido real

Con el primer partido terminado de Champions 2026 (a partir del 24-09): transición
upcoming→live→finished por el worker, resolución de preguntas, `app_score_pickem_event`, recompensas
por escalón, avance de la estructura y, al final, campeón. Vigilar `notifications` (`SYNC_FAILED`,
`SOURCE_*`, `SCORING_FAILED`) y `sync_state['esports:autosync']` en `/admin/operations`.

## Archivos

PC: `src/server/worker/esportsAutosyncWorker.ts` (+ `.test.ts`), `scripts/esports-autosync-worker.ts`,
`scripts/build-esports-worker.mjs`, `src/lib/esports/autosync/{runner,health}.ts` (`origin`),
`package.json` (`esports:worker:build`), `.gitignore` (`/deploy/drlcards-sync/`),
`docs/product/qa/fase24-8/*` (precheck, manifest, hashes, node-runtime, env-keys, dryrun-vps,
service-test, timer-status, first-cycle, second-cycle, single-flight, health, resource-usage,
worker-log), este informe. VPS: `/opt/nexus/projects/drlcards-sync/**` y una línea en el crontab de
`nexusadmin`. Nada más en el VPS.

**FASE 24.8 — CERRADA** (autosync activo por worker en el VPS; systemd pendiente de root).
