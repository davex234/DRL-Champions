# FASE 67 · PRODUCTION READINESS 5.0 — Operaciones · Seguridad · Backups · Observabilidad · Recuperación

**Veredicto: GO para operar la beta cerrada en la topología actual.**
- La release pública queda **BLOCKED** solo por dependencias externas: copia externa de backups, dominio con TLS, SMTP y callbacks de Auth.
- **Sin deploy, sin DNS, sin commit, sin migraciones aplicadas.**
- Evidencia: `docs/product/qa/fase67-production/` (40 ficheros).
- Runbooks: `docs/operations/`.

## Matriz de preparación

| Área | Estado | Por qué |
|---|---|---|
| App | **READY WITH LIMITATION** | Build reproducible (BUILD_ID = huella), arranque en frío en 1,3 s, sale con exit 1 si falta configuración crítica. Limitación: corre en un PC con Windows y no tiene gestor de procesos. |
| DB | **READY** | Integridad con 0 anomalías, esquema en 0057 sin drift, la app no aplica migraciones. |
| Auth | **READY WITH LIMITATION** | Sesión Bearer por petición, logout que revoca el token (F66). Limitación: GoTrue tiene `SITE_URL` en localhost y autoconfirmación. |
| Storage | **READY** | Backend file, volumen copiado a diario, 0 objetos. Solo escribe service_role con validación completa. |
| Backups | **READY WITH LIMITATION** | Diarios + verificado F67 (manifiesto, checksums, fallo ruidoso). **Sin copia fuera del VPS.** |
| Restore | **READY** | Simulacro aislado `DRILL_OK` en 28 s: 25/25 recuentos, 18/18 usuarios, checksums de Storage. |
| Process | **READY WITH LIMITATION** | VPS: Docker enabled + contenedores `unless-stopped`. App: plantilla systemd preparada, no instalada. |
| Security | **READY WITH LIMITATION** | Next crítico parcheado, cabeceras, 404 uniforme, 0 secretos en el cliente, aislamiento entre usuarios probado. Limitación: propuesta 0058 (grants) no aplicada. |
| Observability | **READY** | `/api/health`, `/api/ready`, `/admin/system` alineados; logs JSON con errorId y x-request-id; `production:check` y `smoke:production`. |
| Load | **READY WITH LIMITATION** | 0 errores hasta 50 de concurrencia, sin fugas en 5 minutos. Limitación: techo de unas 60 RPS por el túnel. |
| Rollback | **READY WITH LIMITATION** | Procedimiento de código probado localmente (parada + arranque). Sin cero downtime. |
| Domain | **BLOCKED** | No hay dominio. Documentado qué cambiar. |
| HTTPS | **BLOCKED** | No hay TLS (hace falta dominio y proxy). HSTS y COOP ya se emiten. |
| Email/Auth callbacks | **BLOCKED** | SMTP = Inbucket (no entrega correo). `SITE_URL`/allowlist = 127.0.0.1:3000. |
| Workers | **READY** | Cron con flock + lease, log con rotación, aislado de la web (otro host). |

## Informe (1–109)

### Línea base y arquitectura

1. **Línea base** (`baseline.json`):
   - 5.321 tests, 331 cartas, 29 agentes, cabeza 0057, mercado y pagos OFF.
   - Next 16.2.9 con 1 vulnerabilidad crítica. `sharp` solo transitiva.
   - `next start` escuchaba en toda la LAN.
2. **Arquitectura** (`architecture.json`, diagrama en `drlcards-production.md`):
   - Navegador → Next en el PC → túnel SSH → Kong/PostgREST/GoTrue/Storage → Postgres 17.6 en el VPS.
   - El worker y los backups corren por cron en el VPS. No hay app en el VPS.
3. **Dependencias críticas:** Node 22.12–24, Postgres, GoTrue, 3 variables de Supabase, `.next` y `public/`. Degradadas y opcionales en `dependencies.json`.

### Configuración y secretos

4. **Configuración de producción** (`config-audit.json`):
   - CFG-1: sin validación de env. Corregido.
   - CFG-2: escucha en la LAN. Corregido con `-H 127.0.0.1`.
   - CFG-3: `/design-system` público. Corregido con 404 en producción.
   - CFG-7: GoTrue en localhost con Inbucket. BLOCKED.
5. **Secretos:**
   - 0 valores de secretos del servidor en `.next/static`, `.next/server`, `public`, docs, scripts, src o logs.
   - `.env.local` está ignorado por git; `SECRETS.md` y `.env.example` solo tienen nombres.
6. **Bundle del cliente:** 0 secretos y 0 JWT service_role. `anon` y `NEXT_PUBLIC_ADMIN` son públicos por diseño. Sin source maps públicos.
7. **Validación de env:**
   - `src/server/ops/env.ts` + `src/instrumentation.ts`.
   - En producción, un problema CRÍTICO hace `exit 1` en 486 ms. El primer intento con `throw` dejaba el proceso vivo sin escuchar; se corrigió.
   - Rechaza una clave pública con rol service_role.
8. **Fallbacks peligrosos:**
   - Modo local silencioso: ahora falla ruidosamente.
   - Escucha en la LAN: cerrada.
   - Arneses QA: ocultos.
   - Sandbox de créditos: ya tenía doble puerta.
   - El resto de apariciones de localhost son de dev/QA.
9. **Flags:** `GLOBAL_MARKET_ENABLED` y `PAYMENTS_ENABLED` son constantes de código. El mercado responde 503 en servidor. No hay vía desde el cliente.

### Seguridad

10. **Admin:**
    - `verifyAdmin` = GoTrue + `profiles.is_admin`, y `is_admin` está protegido por grant y trigger.
    - 23 rutas cubiertas, 0 server actions.
    - En vivo: 401 para anónimo y usuario normal; las RPC admin devuelven 404 a un usuario.
11. **RLS** (`rls-audit.json`):
    - Todas las tablas tienen RLS.
    - Deny-all en duelos, CMS y sanciones; lectura propia en inventario, economía y progresión.
    - 4 hallazgos: RLS-1 columnas públicas de `profiles`, RLS-2 INSERT, RLS-3 TRUNCATE, RLS-4 SECURITY DEFINER.
    - Van a la propuesta **0058 (no aplicada)**.
12. **Aislamiento entre usuarios:** C contra B por PostgREST directo da 0 filas en 14 tablas privadas. Las escrituras cruzadas afectan 0 filas o devuelven 403. La única exposición es RLS-1.
13. **Auth/sesión:**
    - Bearer en localStorage, sin cookies, así que no hay superficie CSRF clásica. Rotación de refresh activada.
    - Logout: el token de la sesión cerrada da 401 y el otro dispositivo sigue (F66).
    - **Arreglado:** `signUp` sin `emailRedirectTo`, y recuperación de contraseña sin formulario. Ahora hay `PASSWORD_RECOVERY` → `PasswordRecoveryForm` → `updateUser`.
14. **Open redirect:** no hay parámetros de redirección; los `redirectTo` son el propio origen.
15. **Validación de entrada:** tipos, enums y UUID en las rutas; límite de tamaño en el borde (punto 22); 0 SQL crudo.
16. **Mass assignment:** ninguna ruta vuelca el cuerpo en la BD. `credits` rechaza campos del servidor. 12/12 escaladas rechazadas (smoke).
17. **XSS:** el nombre `<img src=x onerror=…>` se guarda y se muestra como TEXTO, sin ejecutarse; se restauró. Solo hay 1 `dangerouslySetInnerHTML`, estático.
18. **SQL injection:** no hay SQL crudo. Los `.or()`/`ilike` construidos con entrada limpiada son admin, salvo la búsqueda social, que se normaliza.
19. **Path traversal:** solo en admin, con `/ \ ..` rechazados y lista blanca por manifiesto.
20. **Subidas:**
    - CMS: firma, extensión, MIME, tamaño, decodificación con `sharp`, sha256, ruta UUID y `upsert:false`.
    - Assets legado: F67 añade validación del campo `url` y la cubeta `upload_write`.
21. **Límites de frecuencia:**
    - En BD, compartidos entre procesos, con fallo abierto.
    - Nuevos: `economy_write` 30/min (packs, store, credits, progression, prestige, mastery, economy) y `upload_write` 20/min.
    - Una partida normal ve 0×429.
22. **Tamaño de petición:** middleware con 413 por Content-Length (juego 256 KB, admin 1 MB, subidas 25 MB). Verificado: 300 KB → 413.
23. **Fugas de error:**
    - Unas 20 rutas devolvían `error.message` de la BD o de excepciones en 500.
    - Ahora `internalError()` responde «Algo ha fallado en el servidor. Código: XXXXXX».
    - Cubre juego, social, matchmaking, pickems, sync y admin.

### Observabilidad y proceso

24. **Logging:** `src/server/ops/log.ts`, JSON por línea, redacción de campos sensibles.
25. **Correlation IDs:** `x-request-id` en toda `/api` (eco en la respuesta y en la ruta). `errorId` en el cliente y en el log.
26. **Salud:** `/api/health` (liveness, sin dependencias).
27. **Readiness:**
    - `/api/ready`: config, database, schema 0057, catalog 331, storage.
    - Caché de 15 s con un solo vuelo; 503 si `not_ready`.
    - Alineado con `/admin/system`, con la misma cabeza en `server/ops/release.ts`.
28. **Arranque en frío:** health en 826 ms, ready en 1.262 ms, home en 1.271 ms (`startup.json`).
29. **Recuperación tras reinicio:**
    - Kill -9 del proceso real con tráfico: 2,8 s sin servicio, luego `ready` otra vez.
    - Rating, créditos, XP, cola y equipos QA idénticos; login correcto (`restart-recovery.json`).
30. **Modelo de reinicio del VPS:**
    - Docker enabled + 12 contenedores `unless-stopped` + cron: vuelven solos.
    - No vuelven: el túnel del PC y la app del PC.
    - El VPS no se reinició (es compartido).
31. **Gestión de procesos:** hoy es manual. Plantilla systemd en `drlcards-production.md` §6 (`Restart=on-failure`, `ExecStartPre=production:check`). No instalada: no hay host Linux de app ni sudo.
32. **Auto-restart:** lo cubre la plantilla anterior. No se activó nada global.
33. **Graceful shutdown:** `next start` gestiona SIGTERM en Linux. En Windows `Stop-Process` es una parada dura; la BD queda consistente porque cada escritura es atómica y condicionada. No se pudo probar SIGTERM real en Windows.

### Backups y recuperación

34. **Backup de BD actual:**
    - `nexus-backup.sh` a las 04:30: `pg_dump -Fc` validado con `pg_restore -l`, sha256, 14 días.
    - Último: hoy a las 04:30, sin fallos.
    - Mismo disco del VPS, sin cifrado (permisos 600/700).
35. **Backup de Storage actual:** la deuda de F60 **ya estaba resuelta** en el script diario (tar del volumen desde el 12-09). El volumen está vacío: 0 ficheros y 0 filas en `storage.objects`.
36. **Mejora de backup:**
    - `scripts/ops/backup-drlcards.sh`: manifiesto, recuentos, sha256 por fichero de Storage, inventario BD, `SHA256SUMS`, `COMPLETE`.
    - Se ejecuta por ssh sin instalar nada. 7 s.
37. **Tamaño:** BD de 41 MB, dump de 2,86 MB, Storage de 87 B. Backups de DRLCards: 78 MB en total.
38. **Disco:** 463 GB libres de 493 GB (el disco es compartido con otros proyectos).
39. **Retención:** hoy 14 días. Propuesta: 14 diarios + 8 semanales + 6 mensuales, unos 90 MB. No se borró nada.
40. **Prueba de fallo de backup:**
    - Destino sin permisos, contenedor inexistente y disco insuficiente dan exit 1.
    - Se encontraron y corrigieron 2 defectos del propio script: stdin tragado daba un **exit 0 falso**, y `SET` corrompía el JSON.
41. **Simulacro de restauración:**
    - Contenedor desechable con la misma imagen, `--network none`.
    - Tres intentos corregidos: arranque durante el init, `--clean` frente a los event triggers, y `auth.users` antiguo en la imagen.
    - Resultado: **DRILL_OK**.
42. **Validación del restore:**
    - 25/25 recuentos, incluido `auth.users` 18/18.
    - 331 cartas, 29 agentes, 1 admin, sonda de esquema 12/12, checksums de Storage 0/0.
43. **RTO observado:** 28 s para la BD (listo en 16 + restore 6 + validación 5 + Storage 1). App: 1,3 s.
44. **RPO:** hasta 24 h. **Pérdida del VPS = pérdida total: BLOCKED** hasta tener copia externa.
45. **Recuperación ante desastre:** `drlcards-disaster-recovery.md`: host nuevo, stack, BD, Storage, worker, app, red y validación. Estimación de 2–4 h si hay copia externa.

### Release, dependencias y migraciones

46. **Artefacto de release:** `release-manifest.json` con head, BUILD_ID (sha256 de las entradas), Node, Next, `sharp`, sha256 del lockfile y de `package.json`, cabeza de migración y env requerido.
47. **Riesgo del árbol sucio:** 290 ficheros modificados y 1.083 sin seguimiento. La release pública exige commits y una etiqueta (checklist A). No se hizo commit.
48. **Reproducibilidad del build:**
    - Build de 17–60 s.
    - `production:check` compara el BUILD_ID con la huella recalculada del árbol, de forma exacta y sin fiarse de las fechas.
    - Un falso positivo por mtime, provocado por `buildid.test`, llevó a cambiar a la huella.
49. **Lockfile:** v3 coherente. Solo cambian `next`, `sharp` y `postcss`. `npm ci` es viable; no se ejecutó para no destruir `node_modules`.
50. **Auditoría de dependencias:**
    - Antes: 1 crítica, 6 altas. Ahora: **0 críticas**, 3 altas y 1 moderada, todas dev o build-time.
    - `next` 16.2.9 → **16.3.6**: RCE no autenticado en servidores Windows (este host), RCE en la optimización de imágenes AVIF y bypass de middleware.
51. **sharp:** dependencia **directa** `^0.35.4`. Cierra la deuda de F60 y los CVE de libvips/libheif.
52. **Node:** `engines >=22.12.0 <25`, `.nvmrc` en 24.15.0 (CI usa 22).
53. **Estado de migraciones:** 57 ficheros contiguos; la última es 0057; la app no auto-aplica. `schema_migrations` registra solo 0001–0025 (histórico): la sonda es la fuente de verdad.
54. **Schema drift:** ninguno (sonda 12/12, tablas presentes).
55. **Integridad de datos:** 13 comprobaciones de solo lectura, todas a 0: créditos negativos, huérfanos, series duplicadas, dos PvP vivos, colgadas, autopartidas, sin resultado, doble liquidación, libro duplicado, cola huérfana.
56. **Datos QA:** 18 usuarios en auth, 17 QA (`@example.invalid`/`qa`) y 1 real (el del usuario). Se conservan; `qa-data.json` explica cómo excluirlos de las métricas.

### Assets, cabeceras y exposición

57. **Seguridad de Storage:** 1 bucket `assets` público y vacío, sin límite de tamaño ni MIME a nivel de bucket (recomendación). 0 políticas: solo escribe service_role.
58. **Assets estáticos:** 331/331 cartas, 29/29 agentes, 19 sobres con arte sin roturas, 13 mapas. 0×404 en 24 pantallas.
59. **Caché:**
    - `/_next/static` inmutable; API `no-store`.
    - El HTML estático lleva `s-maxage=1 año`: purgar la CDN al publicar.
    - `/cards` usa `max-age=0`.
60. **Cabeceras de seguridad:** CSP, XFO DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS y **COOP (nuevo)**. **Sin X-Powered-By (nuevo).**
61. **CORS:** ninguno (solo mismo origen).
62. **CSP:** `'unsafe-inline'` en script y style justificado (hidratación de Next sin nonce, estilos inline). 0 violaciones en consola.
63. **Preparación HTTPS:** HSTS y COOP ya se emiten. La sesión va en localStorage y no depende de cookies `Secure`. `NEXT_PUBLIC_SUPABASE_URL` debe ser https en la release (la validación avisa). **BLOCKED:** TLS.
64. **Preparación de dominio:** qué cambiar en la checklist F (proxy, `SUPABASE_URL` pública, `GOTRUE_SITE_URL`/`URI_ALLOW_LIST`, indexación, HSTS preload).
65. **Callbacks de Auth:** los redirects del cliente usan el origen, lo que es correcto. **BLOCKED:** GoTrue tiene `SITE_URL`/allowlist en 127.0.0.1:3000 y SMTP = Inbucket.
66. **Endpoints de depuración:** no hay APIs de debug, seed o test. `/design-system` da 404 en producción. `sandboxPurchase` está cerrado en producción.
67. **Helpers de QA/E2E:** los instrumentos `scripts/_*`, `scripts/multiplayer/*` y `scripts/ops/_*` son offline y no se importan en la app (el contrato de F65 lo vigila).
68. **Worker/cron:** `drlcards-sync` cada 2 min con flock + lease, exit 0 reciente, log de 3,8 MB con rotación a 5 MB, secretos en env 600. Está en otro host que la web, así que su caída no tira la web.

### Carga y recursos

69. **Uso de recursos:**
    - App: RSS 112–145 MB en reposo, unos 285 MB bajo carga.
    - VPS: los contenedores de DRLCards suman unos 2,3 GB de RAM; la BD usa 284 MB y 1,3 % de CPU.
70. **Prueba de carga:** solo lecturas (anónimas + QA C), concurrencia 1/5/10/25/50 × 15 s, 0 escrituras.
71. **Resultados por concurrencia:**

    | Concurrencia | RPS | p50 (ms) | p95 (ms) | p99 (ms) | 5xx |
    |---:|---:|---:|---:|---:|---:|
    | 1 | 5 | 234 | 534 | 668 | 0 |
    | 10 | 49 | 221 | 631 | 671 | 0 |
    | 25 | 64 | 362 | 1.235 | 1.452 | 0 |
    | 50 | 59 | 349 | 3.005 | 4.181 | 0 |

    Los 429 son solo de `play-status` (cubeta por usuario, intencional).
72. **Capacidad:**
    - Meseta de unas 60 RPS a partir de concurrencia 25.
    - El cuello de botella es el RTT del túnel por consulta; `/competitive` hace unas 5 consultas seguidas.
    - No es una cifra de jugadores. Con la app junto a la BD, las latencias caen varios órdenes de magnitud.
73. **Memory soak:** 5 min con concurrencia 10, 14.109 peticiones, 0 errores. RSS 285 → 287 MB. Handles 301 → 233 en reposo. Sin fugas.
74. **Presión de conexiones a la BD:** la app no abre conexiones Postgres: habla HTTP con PostgREST, cuyo pool es fijo. El cliente de servicio es único por proceso. Los handles vuelven a su nivel en reposo.
75. **Consultas lentas:** `/api/game/competitive` (unos 530 ms con concurrencia 1) y `daily-loop`/`season` (unos 500–650 ms), dominadas por el RTT del túnel. No se optimizaron (no hay regresión).
76. **Presupuesto de peticiones de la home:** 9,5 por pantalla en el mismo conjunto que F64 (9,5); home 6 (igual).
77. **Presupuesto de red multijugador:** F66 intacto (39–47 peticiones por partida y cliente). Regresión e2e sin 429 ni 404.
78. **Monitorización de backups:** `production:check --vps` da la edad del dump y del tar (16 h hoy), el último backup verificado con `SHA256SUMS`, las líneas FALLO del log y el disco. La copia externa sale en FAIL, como debe.

### Comandos y runbooks

79. **`npm run production:check -- --app --vps`** (build final `drl-0.1.1-1-abdcaffc`): **24 PASS, 0 WARN, 1 FAIL**. El FAIL es la copia externa, que es el bloqueo real.
80. **`npm run smoke:production`:** 67/67, y 69/69 con `--xss`.
81. **Checklist de release:** `docs/operations/drlcards-release-checklist.md`.
82. **Rollback:** `docs/operations/drlcards-rollback.md` (código, esquema, contenido). La parada y el arranque se probaron localmente.
83. **Modo mantenimiento:** no existe. Se documenta el interruptor mínimo `NEXUS_MAINTENANCE` para cuando haya tráfico público. No se activó nada.

### Regresiones

84. **Regresión de seguridad:** F58 admin (16 tests), subidas F60, IDOR/404 de F66, autoridad y pago único: verdes.
85. **F61:** huella dorada verde; partida caos de F66 en Next 16.3.6 correcta.
86. **F62:** PvE paga exactamente una vez (+120 = premio).
87. **F63:** onboarding 200; primera partida por el mismo `playTurn`.
88. **F64:** 0 errores de consola, 0 desbordes, mismo presupuesto de peticiones.
89. **F65:** huella del motor intacta, `lab.test` verde, propuestas sin aplicar.
90. **F66:** e2e de dos clientes con caos verde.
    - **Bug nuevo encontrado y arreglado:** en PvE, una jugada tardía con otra carta y la versión vieja se aplicaba al turno siguiente (2×200 de 10 en la BD real).
    - Ahora la vista lleva `stateVersion`, el cliente la devuelve y el servidor responde 409 + estado. En la BD real: 1×200 + 9×409.

### Qué cambió y qué no

91. Motor cambiado: **NO**.
92. Balance cambiado: **NO**.
93. Economía cambiada: **NO** (solo se añadió un límite de frecuencia a sus escrituras).
94. Cartas cambiadas: **NO**.
95. Agentes cambiados: **NO**.
96. Migración de BD: **NO**. La propuesta 0058 está documentada, con rollback, y no se aplicó.
97. Esquema de producción modificado: **NO**. Solo lecturas en sesiones read-only; los backups van a directorios nuevos.
98. Datos de juego de tu cuenta modificados: **NO** (ningún instrumento la usa y todos abortan con `2f86cbe8`).

### Gates y estado final

99. **Tests:** 5.321 → **5.334**, todos verdes.
100. **tsc web:** 0 errores.
101. **tsc scripts:** 0 errores.
102. **lint:** 0 errores (27 avisos, los mismos de antes).
103. **build:** verde (Next 16.3.6). Aviso heredado: `middleware` → `proxy` está deprecado, se deja como deuda.
104. **HTTP :3005:** 200, escuchando solo en 127.0.0.1 (`npm start`).
105. **Túnel:** abierto (54521/54522). Se cerró durante los gates.
106. **Ficheros:**
    - **Modificados:**
      - `package.json`/`package-lock.json` (next, sharp, postcss, engines, start, scripts).
      - `next.config.mjs` (poweredByHeader, COOP).
      - `src/middleware.ts` (tamaño, x-request-id, arneses, matcher).
      - `src/app/layout.tsx` (noindex).
      - `src/lib/supabase/auth.tsx`, `src/app/cuenta/page.tsx` (recuperación de contraseña, emailRedirectTo).
      - `src/server/services/rateLimit.ts`.
      - Rutas de juego: packs, store, credits, progression, prestige, mastery, economy, events, loop, market, state, strats, social, `duel/matchmaking`, duel.
      - `src/app/api/pickems`, `esports/{sync,predict}`, `market/sync-reference`.
      - Admin: `assets`, `cards`, `releases`, `tournaments`, `operations`.
      - `src/server/admin/overview.ts`, `src/server/services/duels.ts`, `src/lib/duel/{client,types}.ts`, `src/app/duelos/jugar/page.tsx`.
      - Pins: `adminControlCenter.test`, `gameplay.contract.test`, `f61.match.test`, `duels.concurrency.service.test`.
    - **Nuevos:**
      - `src/server/ops/{env,log,health,release,secret}.ts` + `ops.test.ts`.
      - `src/domain/ops/edge.ts`, `src/instrumentation.ts`, `src/app/api/{health,ready}/route.ts`, `src/app/robots.ts`, `src/components/auth/PasswordRecoveryForm.tsx`.
      - `.nvmrc`.
      - `scripts/ops/*` (backup, restore drill, estado de backups, production-check, smoke, carga, arranque, caída, evidencia).
      - `docs/operations/*` (5 runbooks + propuesta 0058).
107. **Limitaciones:**
     - Sin copia externa de backups.
     - Sin dominio, TLS ni SMTP.
     - App en Windows sin gestor de procesos.
     - SIGTERM no probado en Windows.
     - Carga limitada por el túnel (un solo proceso, un solo usuario QA).
     - 0058 sin aplicar.
     - `middleware.ts` deprecado.
     - El artwork de cartas legado se valida por firma sin decodificar.
     - La retención semanal y mensual no está implementada.
108. **Matriz:** ver la tabla al principio.
109. **GO / NO-GO:** **GO** para la beta cerrada y la operación actual, con todo lo preparable preparado. **La release pública está BLOCKED** únicamente por:
     - (a) destino externo para los backups;
     - (b) dominio con TLS;
     - (c) SMTP y callbacks de GoTrue;
     - (d) decisión sobre la migración 0058;
     - (e) consolidar el trabajo en commits.
