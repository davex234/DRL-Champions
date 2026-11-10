# F83 — SEASONS, ACCOUNT PROGRESSION & SEASON TRACK · Informe final

Fecha: 2026-10-04 · Rama `arch/stabilization` · Sin commit ni push.

Evidencias: `docs/product/qa/f83-season-track/` (economía/simulación `economy.json`, QA del arnés a 1440/1024/390 normal y
reducido, capturas) y `docs/product/qa/f83-season-track/prod/` (ensayo y aplicación de 0064, frontera de la release, QA
en producción).

> **Decisión central (sobre el estado real).** En producción YA corre una temporada: la **Temporada 1 · Ascenso** del
> pase heredado (`SEASON_CALENDAR` `nexus-s1`, 2026-09-07 → 2026-11-30; XP de pase en `user_pass`; carril libre con
> créditos y sobres reales; misiones diarias/semanales). F83 **no la toca ni la duplica**: construye el sistema de
> temporadas canónico en BD que la **sucede**, y su primera temporada es la **Temporada 2 · Asalto**, creada en
> **BORRADOR** y programable desde el 2026-11-30 (cuando acaba la heredada; la BD y la validación impiden solaparlas).

---

## A. INITIAL STATE
Comprobado: release `drl-0.1.1-1-fd07721d`, cabeza `0063_profile_favorite_team`, health/ready OK, suite 5835. Coincide
con el prompt.

## B. ARCHITECTURE AUDIT
Existían: (1) el **pase heredado** (contenido en código `data/season.ts`, calendario `data/seasonCalendar.ts`, estado en
`user_pass.state` jsonb con guardado optimista; XP de pase 1.000/nivel que solo sube al reclamar misiones; carril libre
de 30 niveles: 15.900 créditos + 3 Bronce + 3 Plata; misiones diarias/semanales con rotación pura; `/temporada` = hub
F52; reclamo en `/progresion` y `/logros`); (2) el **motor de misiones de F73** (`content_missions`, `mission_events`
con PK (usuario, clave), evaluador puro de condiciones, ganchos en fin de partida PvE/PvP, apertura y crafteo, filtro
anti-AFK `matchCounts`); (3) `award()` / `app_grant_reward` (créditos, sobres como entitlement, cosméticos; idempotente
por `(user_id, ref)`); (4) insignias F82 en `user_cosmetics` destacables en el perfil F89; (5) `/admin/seasons` de solo
lectura del calendario.

## C. EXISTING EVENT SYSTEM
El punto canónico es el de F73: `settleMissionsForMatch` (PvE `commitDecision` y PvP liquidado, partida ya persistida) y
`settleMissionsForOp` (apertura y crafteo ya aplicados), con clave estable (`match:<id>`, ref de la operación). F83 se
engancha AHÍ (`ingestSeasonEvent`, nunca lanza) y en el reclamo de un Collection Set F82 (`collection:<setId>`): un solo
punto por evento, sin duplicar lógica en endpoints.

## D. SEASON MODEL
`game_seasons` (0064; la tabla `seasons` de 0012 es de Pick'ems): id, número, nombre, descripción, `status`
(DRAFT/PUBLISHED/CANCELLED), `starts_at`, `ends_at`, `claim_until`, `max_level`, `config` (curva + umbrales `levels`, XP
por fuente con topes, recompensas por nivel, pools de retos), `config_version`, `checksum` (sha256 canónico), autoría y
fechas.

## E. SEASON LIFECYCLE
DRAFT (editable) → PUBLISHED (congelada por disparador) → CANCELLED (solo antes de empezar). La FASE se deriva de la hora
del servidor/BD: SCHEDULED → ACTIVE → GRACE (terminada, reclamos abiertos) → ARCHIVED. Sin cron. **Una sola temporada
viva**: restricción de exclusión en BD (dos PUBLISHED no se solapan), y la validación además impide solapar el calendario
heredado.

## F. MIGRATION
`0064_season_track.sql` (cabeza real previa = 0063). Aplicada **una vez** el **2026-10-03T22:20:18Z** como `postgres`,
una transacción, 240 ms, sha256 `76dcf2d5…bd17a`, recuentos/huellas idénticos antes y después, 0 privilegios de cliente
para escribir o ejecutar (`prod/apply-0064.log`). Aditiva: 6 tablas, 2 RPC, 2 disparadores. Rollback:
`docs/operations/rollback/0064_season_track.ROLLBACK.sql`.

## G. XP MODEL
«XP de temporada»: unidad propia (no es XP de cuenta, ni XP del pase heredado, ni rating, ni créditos). El nivel se deriva
de ella. La UI la nombra siempre «XP de temporada».

## H. XP LEDGER
`season_xp_ledger` (usuario, temporada, fuente, `event_key`, cantidad > 0, meta mínima, fecha) con UNIQUE
(usuario, temporada, event_key). `season_progress.xp` se mantiene en la MISMA transacción. Lectura propia por RLS.

## I. IDEMPOTENCY
`season_events` PK (usuario, temporada, event_key) + UNIQUE del libro + XP de reto con clave `ch:<periodo>:<reto>`. Postgres
real (ensayo): 20 aplicaciones simultáneas del mismo evento → 1 APPLIED, 19 REPEATED, 1 asiento. El cliente no puede
enviar XP: no existe endpoint para ello (acción inexistente → 400).

## J. MATCH XP
Solo partidas que **cuentan** (regla F73: terminadas por reglas, no privadas, ≥ 5 decisiones humanas): Contra la IA 40,
Draft 50, Ranked 60. Tope diario por partidas: 600 XP (≈ 11 partidas).

## K. WIN XP
+30 por victoria. Perder también suma la base (se incentiva jugar).

## L. RANKED XP
Ranked da su base (60) como cualquier partida; **el rating no se toca** ni se mezcla con la XP.

## M. AFK/ABANDON
Reutiliza las señales de F72.8/F73: partidas jugadas por el reloj (< 5 decisiones humanas), abandonadas (no se liquidan
como terminadas), privadas o sin terminar → ni XP ni progreso de retos (ni se registra el evento).

## N. CRAFT XP
50 XP por crafteo real (sobre o carta), tope 100/día. Desguace: no es un evento (0 XP). El bucle craft↔desguace queda
acotado a 100 XP/día.

## O. COLLECTION XP
300 XP por Collection Set F82 completado **durante** la temporada (evento en el reclamo `COMPLETED`, clave por set). Las
compleciones anteriores no se recompensan (no hay retroactividad). Insignias F82 intactas.

## P. MISSION INTEGRATION
Los retos usan la MISMA condición tipada y el MISMO evaluador del motor de F73 (adaptador `asMission`); no hay segundo
motor. Las misiones de F73 (únicas, con su propia recompensa) no dan XP de temporada para no pagar dos veces.

## Q. DAILY CHALLENGES
3 por día de un pool de 7 (familias: partidas, victorias, rondas, IA Normal+), 120–220 XP, todos realizables jugando con
normalidad (nada de ranked —población baja—, Draft —tiene entrada—, colecciones ni sobres).

## R. WEEKLY CHALLENGES
5 por semana de un pool de 7 (partidas, victorias, rondas, IA Difícil, racha), 450–700 XP.

## S. ROTATION
Global (mismos retos para todos), determinista: semilla (temporada, periodo) con FNV-1a; una familia por reto (sin «juega
3» + «juega 5» a la vez); sin `Math.random`.

## T. RESET TIME
UTC (la arquitectura ya usa UTC): diario 00:00; semanal lunes 00:00. La UI muestra el tiempo restante; la BD recalcula el
periodo con su hora y descarta un periodo viejo o futuro.

## U. CHALLENGE PROGRESS
Solo desde eventos del servidor (`app_season_apply`), topado en el objetivo; el cliente no tiene forma de incrementarlo.

## V. CHALLENGE COMPLETION
XP automática al completar (sin fricción), una vez por (periodo, reto) por clave única; 10 partidas simultáneas que lo
completan → 1 asiento (ensayo). Feedback pequeño (✓ en la lista y en el post-partida), sin modal.

## W. XP CURVE
Progresiva por escalones: del nivel n−1 al n cuesta 1.500 + 50·(n−1). 40 niveles = 99.000 XP. Versionada (umbrales
congelados en `config.levels`).

## X. LEVEL DERIVATION
Nivel = umbrales alcanzados por la XP total (`levelFor`); nunca se guarda un nivel aparte. La BD usa los mismos umbrales
para validar reclamos.

## Y. MAX LEVEL
En el máximo la XP se sigue registrando (libro intacto), sin más niveles; barra llena, «Nivel máximo alcanzado». Sin
prestigio infinito.

## Z. SEASON TRACK
`/temporada` muestra la ruta F83 cuando hay temporada ACTIVA o en GRACIA: héroe (nombre, medalla de nivel, XP, cuenta
atrás), carril de 40 niveles recorrible (estados reclamada / disponible / bloqueada / plazo cerrado / siguiente), retos
diarios y semanales, reglas de XP, última XP e historial. Sin temporada F83 activa (hoy) sigue el hub del pase heredado
y, si la siguiente está programada, un aviso «Próxima temporada».

## AA. REWARD MODEL
Por nivel: créditos, sobre (entitlement) y/o insignia de temporada. Topes de cordura por recompensa (≤ 5.000 créditos,
≤ 3 sobres) en la validación.

## AB. CREDIT REWARDS
Por `award()` (libro canónico `credit_transactions`, ref `season:<temporada>:<nivel>`), nunca UPDATE directo.

## AC. PACK REWARDS
`award()` con `packId/packCount` → +N en `user_packs` (entitlement real); se abre luego con la apertura F81.

## AD. BADGE/COSMETIC REWARDS
`insignia:temporada:temporada-2-plata` (nivel 20) y `-oro` (nivel 40) por `award()` → `user_cosmetics`; integradas en el
sistema de insignias F82/F89 (`badgeFact` → «Temporada 2 · Oro», tipo SEASON, sin logo inventado), destacables en el
perfil. No hay segundo sistema.

## AE. CLAIM
Manual («RECLAMAR» por nivel). `app_season_claim`: temporada publicada y empezada, nivel ≤ máximo, recompensa definida,
XP ≥ umbral congelado, dentro de `claim_until`, una fila por (usuario, temporada, nivel). Después `award()` con ref estable.

## AF. CLAIM IDEMPOTENCY
Doble clic: el botón se bloquea («Reclamando…»). Postgres real: 10 reclamos del mismo nivel → 1 CLAIMED, 9 ALREADY, 1 fila.
Servicio: 8 reclamos concurrentes → 1 pago (ref única), 1 sobre. Un reintento tras un fallo a medias completa el pago
(misma ref) y nunca lo duplica.

## AG. MULTI-LEVEL
Una sola celebración «Subes de nivel · 20 · +3 niveles» (prueba 17 → 20).

## AH. LEVEL-UP UX
Diálogo corto propio (no copia de otros juegos), foco, Escape, sin animación obligatoria (compatible con movimiento
reducido), con «Ver la ruta» si hay recompensas.

## AI. POST-MATCH UX
Resultado PvE/Draft y ranked: «+XP» de la partida y de los retos que completó, barra de nivel, retos tocados; leído del
servidor (asientos `match:<id>` y `ch:` con `meta.by`), nunca calculado en el cliente. Sin temporada activa o sin XP
(privada/AFK/abandono) no pinta nada.

## AJ. SEASON END
En `ends_at`: la BD rechaza más XP y retos (INACTIVE); la fase pasa a GRACE sola.

## AK. GRACE CLAIM
Política explícita: lo alcanzado se puede reclamar hasta `claim_until` (Temporada 2: 14 días tras el fin); después CLOSED
(probado en BD).

## AL. NEXT SEASON
Otra fila de `game_seasons`: la XP es por (usuario, temporada), empieza en 0 para la nueva sin tocar la anterior.

## AM. SEASON HISTORY
`season_progress` + `season_reward_claims` por temporada se conservan; la vista enseña «Temporadas anteriores» (nivel
final, XP, recompensas reclamadas). Nunca `UPDATE … xp = 0`.

## AN. ADMIN
`/admin/seasons` (página existente) añade «Ruta de temporada (F83)»: crear borrador, editar datos/fechas/curva, XP por
fuente, recompensas por nivel (filas) y retos diarios/semanales (pools), previsualizar, publicar (escribiendo PUBLICAR),
cancelar antes de empezar, borrar borrador. `runAdmin`, cuerpo cerrado, versión de fila, auditoría.

## AO. ADMIN VALIDATION
Fechas (≥ 14 días, ≤ 26 semanas, gracia ≤ 60 días, inicio futuro al publicar), solape con temporadas publicadas y con el
calendario heredado, curva estrictamente creciente con tantos umbrales como niveles, XP en rangos, recompensas (nivel
válido y único, sobre existente, cantidad 1–3, créditos ≤ 5.000, insignia `insignia:temporada:*`), retos (condición
soportada, ids únicos, familias suficientes). La BD vuelve a imponer forma, solape e inmutabilidad.

## AP. ECONOMY PREVIEW
El panel calcula sobre la DEFINICIÓN (sin consultar usuarios): total por jugador (créditos, sobres por tipo con su valor,
insignias, valor total) y la simulación de perfiles.

## AQ. SEASON 1
La primera temporada F83 es la **Temporada 2 · Asalto** (la «Temporada 1» ya existe como pase heredado): 2026-11-30 →
2027-02-22 (12 semanas, lunes UTC), reclamo hasta 2027-03-08, 40 niveles. Validada para publicar (0 incidencias).

## AR. SEASON 1 STATUS
**DRAFT en producción** (creada como operación de operador auditada; `content_audit_log` `f83_season_create`). **No se ha
publicado ni activado.** Para activarla falta: (1) **decidir qué pasa con el pase heredado** después del 30-nov — hoy su
contenido (misiones con créditos, niveles) no se apaga con el calendario, así que convivirían dos progresiones con
recompensas; (2) revisar y aprobar las recompensas/curva; (3) publicarla desde `/admin/seasons` antes del 30-nov.

## AS. ECONOMY SIMULATION
`scripts/_f83-economy.ts` → `economy.json`. Máximo por jugador: 6.400 créditos + 2 Bronce + 2 Plata + 2 insignias =
**23.400 créditos-equivalentes** en 84 días (279/día), **57 %** del carril libre heredado (41.400). XP media de retos:
489/día y 2.750/semana.

## AT. CASUAL SIMULATION
3 días/semana, 2 partidas/día: ~330 XP/día → nivel **14** al final; 1.900 créditos + 1 Bronce.

## AU. REGULAR SIMULATION
6 días/semana, 5 partidas/día, todos los diarios, 80 % semanales: ~969 XP/día → nivel **34**; 5.100 créditos + 3 sobres.

## AV. HIGH-ACTIVITY SIMULATION
Diario, 12 partidas, 2 crafteos: ~1.581 XP/día → nivel **40** el día ~63; todo el carril.

## AW. MAX-ACTIVITY SIMULATION
40 partidas/día ranked + 10 crafteos + 6 colecciones: **mismo** XP/día que el muy activo (los topes mandan) → no se
puede «grindear» más economía.

## AX. EXPLOIT AUDIT
Reintentos / doble envío / pestañas → 1 (UNIQUE). AFK, abandono, privadas, sin terminar → 0. Bots/farming → tope diario
600 + crafteo 100. Craft/desguace → tope 100, desguace 0. Reclamo repetido → 1. Reloj manipulado / eventos viejos o
futuros → la BD decide con `now()` (temporada y periodo). Nivel futuro → LOCKED/BAD_LEVEL. XP del cliente → no existe.

## AY. SERVER TIME
Autoridad: `now()` de Postgres en las RPC; fase y retos en el servidor; la UI solo cuenta hacia atrás desde `serverNow`.

## AZ. CLOCK BOUNDARIES
Tests de fase ±1 ms en inicio, fin y fin de reclamo; periodo diario 23:59:59.999 vs 00:00; semana lunes; reset diario con
reto de ayer que no sigue progresando; en BD: temporada terminada → INACTIVE, gracia → CLAIMED, tras plazo → CLOSED.

## BA. CONCURRENCY
Postgres real (ensayo, psql en paralelo): mismo evento ×20 → 1; 15 partidas simultáneas con tope 600 → 600 exactos y
progreso = libro; reto completado por 10 partidas a la vez → 1 asiento; 10 reclamos del mismo nivel → 1.

## BB. RLS
Todas las tablas con RLS; el jugador solo puede LEER lo suyo (4 políticas `auth.uid() = user_id`) y las temporadas
publicadas; anon nada; ningún cliente puede insertar/actualizar XP, progreso, reclamos ni temporadas, ni ejecutar las RPC
(verificado en producción tras aplicar).

## BC. SECURITY
Producción: anónimo 401; parámetros extra 400; acción «xp» inexistente 400; campos extra (`userId`, `amount`) 400;
reclamar en la T2 (borrador) 404; nivel/temporada inválidos 400; panel y publicar como usuario normal 401.

## BD. CROSS-ACCOUNT
El usuario sale del token; A no puede reclamar con el nivel de B (LOCKED) ni ve sus asientos (tests y ensayo).

## BE. AUTH HYDRATION
`useSeasonTrack` ata la foto a la cuenta que la pidió; mientras carga se ve el esqueleto neutro; sin sesión no se pide nada.
La portada y el perfil no pintan ningún nivel hasta tener la respuesta del servidor. F81.2 intacto.

## BF. ACCOUNT SWITCH
Cambiar de cuenta descarta la foto anterior y cualquier respuesta tardía de otra cuenta (clave de usuario). La pestaña
vuelve a leer al recuperar el foco (rotación nueva tras el reinicio).

## BG. SEASON HUB
Ver §Z. Capturas en `shots/` (active, claim, fresh, max, grace, scheduled, none, postmatch, levelup, multilevel).

## BH. HOME INTEGRATION
`SeasonDock` en la portada (nivel, barra, próximo reto, «N por reclamar») solo con temporada activa o en gracia; hoy no se
pinta (verificado en producción).

## BI. PROFILE F89 INTEGRATION
Chip «Temporada 2 · nivel N» en el héroe del perfil (público) con temporada activa/en gracia; solo nombre y nivel, nada del
libro. Hoy `seasonTrack: null` (verificado en producción).

## BJ. 1440 · BK. 1024 · BL. 390
Arnés `/design-system/fase83`: **252/252** (3 anchos × normal/reducido): sin desbordamiento de página (el carril se
desplaza por dentro, enfocable), consola limpia, h1 único, botones de reclamo = niveles disponibles, táctiles ≥ 44 px,
nivel actual visible en el carril, diálogo con foco/Escape. Producción: `/temporada` a 1440/390 sin desbordamiento.

## BM. REDUCED MOTION
Sin animaciones obligatorias; diálogo y carril idénticos con movimiento reducido (pasada «reduced» en verde).

## BN. ACCESSIBILITY
Secciones con títulos enlazados, carril como región con etiqueta y `tabindex`, barras con etiqueta textual, estados con
texto (Reclamada/Bloqueada/Siguiente/Completado), diálogo modal con foco, contraste del sistema.

## BO. PERFORMANCE
Una lectura agregada (`GET /api/game/season-track`): 6 consultas en una tanda paralela + temporadas en caché 10 s por
cliente. Ingesta: 1 RPC por evento. Sin N+1.

## BP. API REQUEST COUNT
`/temporada`: 1 petición (ruta) + la del hub heredado solo si no hay temporada F83 activa. Portada: +1 (dock). Post-partida:
1 (con un reintento si el gancho aún escribía). Reclamo: 1 (devuelve la vista nueva).

## BQ. OBSERVABILITY
Logs estructurados `{"scope":"season","event":…}`: `season_event_failed`, `season_event_duplicate`,
`season_challenges_completed`, `season_reward_claimed`, `season_reward_duplicate`, `season_event_hook_failed`; sin PII.

## BR. EXISTING USERS
Sin migración por usuario: la fila de progreso nace con el primer evento (lazy). Cuentas sin actividad no se tocan.

## BS. NEW USERS · BT. FTUE
Inicial intacto (6.000 créditos, Inicial ×3, Bronce ×1); onboarding y vestíbulo sin cambios (tests en verde).

## BU. F79 REGRESSION
Forja, carta protegida, última copia, mazos, favoritos/vitrina: sin cambios (el gancho de crafteo solo añade la ingesta).

## BV. F80 ECONOMY
Precios 2.500/6.000/12.000/20.000/35.000/60.000, probabilidades y cantidades intactos; la economía nueva solo existe al
publicar una temporada (hoy: ninguna).

## BW. F81 REGRESSION
Apertura, héroe, integridad, hidratación: intactos (la apertura no da XP de temporada).

## BX. F82 REGRESSION
Sets, reclamos e insignias intactos; el reclamo `COMPLETED` añade la ingesta (que no lanza); `collectionBadges` excluye las
de temporada.

## BY. F89 REGRESSION
Perfil intacto salvo el chip de temporada; tests F89 en verde.

## BZ. F78 EXCLUDED
Los ficheros F78 de la release son byte a byte los de producción; el backup pre-0064 se hizo con el script de la release de
producción y off-site forzado a «no configurado». F78 sigue abierto.

## CA. MARKETPLACE · CB. PAYMENTS
`GLOBAL_MARKET_ENABLED=false`, `PAYMENTS_ENABLED=false`. Sin pase de pago, sin compra de XP, sin saltos de nivel.

## CC. RELEASE BOUNDARY
Base `drl-0.1.1-1-fd07721d` (3.584 ficheros) + overlay (52) = 3.606: **añadidos (22) + modificados (30) = overlay exacto**
(sha256); 0 borrados; cada modificado comparado con producción (diffs solo F83). Fuera: instrumentos `_f83-*`.

## CD. BACKUP
`/opt/nexus/backups/supabase-drlcards/pre-0064/20261003T220123Z` (COMPLETE + SHA256SUMS). No cierra F78.

## CE. MIGRATION REHEARSAL
Postgres desechable restaurado del backup pre-0064: **DRYRUN_OK 39/39** (`prod/dryrun-0064.log`): aplicación, huellas de 17
tablas idénticas, privilegios y RLS, ciclo de vida (nace DRAFT, solape rechazado, inmutable, sin cancelar empezada, sin
borrar publicada, forma de publicación), carreras A–E, temporada terminada/gracia/cerrada, historial, rollback,
re-aplicación e idempotencia.

## CF. FULL TEST SUITE
`npm test`: **5871/5871** (5835 + 36 nuevas).

## CG. F83 TESTS
19 de dominio/render (`f83.seasonTrack.test.tsx`), 16 de servicio/panel/ganchos sobre MemorySupabase con las RPC emuladas
(`f83.seasonTrack.service.test.ts`), 1 de cabeza (ops). Pins de fases anteriores reescritos a su intención (cabeza 0064,
«qué sigue» en el resultado PvP, calendario leído vía `loadSeasonCalendar`).

## CH. TYPES · CI. LINT · CJ. BUILD
`typecheck` 0 errores; `eslint src` 0 errores (9 avisos de base); build local y build de la release en el VPS OK.

## CK. HEALTH · CL. READY
`/api/health` 200; `/api/ready` `ready`, cabeza `0064_season_track`, checks en verde (nuevo `seasons`).

## CM. PRODUCTION SMOKE
`_f83-prod-qa.mts`: **40/40** (ruta sin temporada activa, borrador invisible, seguridad, panel, perfil, portada, BD con 0
eventos/0 XP/0 reclamos, páginas y APIs de tienda, colección, Sala de Trofeos, forja, crafteo, misiones, competitivo,
progresión, vestíbulo). `production:check --app --vps`: 27 PASS · 1 WARN (auth-email F77) · 4 FAIL (F78 off-site). La
apertura de sobres y una partida ranked real no se ejecutaron (cuentas QA sin saldo/población; sin cambios en esas áreas
salvo el gancho, que no actúa sin temporada activa).

## CN. LOGS
0 errores en `valorosters-app` desde el despliegue; Postgres solo con el aviso antiguo de `profiles`.

## CO. RELEASE
**`drl-0.1.1-1-22c509c6`**, activa desde 2026-10-03 ~22:23Z.

## CP. ROLLBACK
Código: `bin/deploy.sh --activate drl-0.1.1-1-fd07721d` (compatible con 0064). BD (tras el código):
`0064_season_track.ROLLBACK.sql`.

## CQ. COMMIT/PUSH
Ninguno.

## CR. REMAINING RISKS
1. **Convivencia con el pase heredado**: sus misiones y niveles siguen pagando aunque el calendario termine. Publicar la T2
   sin decidir su cierre duplicaría progresiones y recompensas (bloqueo de activación, §AR).
2. Recompensas y curva de la T2 son una propuesta conservadora: requieren tu visto bueno antes de publicar.
3. Los retos excluyen ranked por población baja; si crece, se pueden añadir en la siguiente temporada.
4. La QA real de XP/reclamos en producción no es posible sin activar una temporada (no autorizado); se cubrió con el
   ensayo en Postgres real y los tests de servicio.
5. Analítica de temporada: el contrato de flujos sigue cerrado (no se inventaron eventos).

## CS. FINAL VERDICT
Definición de hecho: 1–21 ✔ · 22 ✔ (T2 en DRAFT, no activada) · 23–38 ✔.

**F83 PRODUCTION = GO**

(GO = sistema completo desplegado y seguro. La Temporada 2 queda en BORRADOR hasta tu decisión sobre el pase heredado y las
recompensas.)
