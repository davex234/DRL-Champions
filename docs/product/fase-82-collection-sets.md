# F82 — COLLECTION SETS, TEAM BADGES & TROPHY ROOM · Informe final

Fecha: 2026-10-03 · Rama `arch/stabilization` · Sin commit ni push.

> **Nota de trazabilidad.** F82 se construyó, migró y desplegó en una sesión anterior de hoy (12:01–12:45 UTC) que se cortó
> sin dejar informe. Esta sesión **no ha rehecho nada a ciegas**: ha re-verificado cada afirmación contra el estado real
> (BD, release en el VPS, hashes de ficheros, tests, dry-run repetido), ha completado la QA en producción que faltaba y
> redacta este informe. Por eso la base de producción **ya no es** `drl-0.1.1-1-dbe08499` (la que cita el encargo): es
> `drl-0.1.1-1-d3973448` = `dbe08499` + F82, desplegada a las 12:42Z. Ver §BJ.

Evidencias: `docs/product/qa/f82-collection-sets/` (QA del arnés, 1440/1024/390 normal+reducido) y
`docs/product/qa/f82-collection-sets/prod/` (QA en producción, BD antes/después, dry-run, capturas reales).

---

## A. DATABASE AUDIT

Medido hoy sobre la BD viva (VPS, `supabase_db_DRLCards`) y el catálogo del código (idéntico a `content_cards`):

| Fuente | Filas | Para colecciones |
|---|---|---|
| `content_players` (jugadores del catálogo) | 379 | identidad canónica de jugador (id estable) |
| `content_cards` | 331 (331 PUBLISHED) | **fuente de verdad**: cada carta lleva `player_id` y un **equipo impreso** |
| `user_cards` | 1.025 filas · 24 usuarios · 331 cartas distintas | propiedad por instancia (duplicados = filas) |
| `teams` (espejo esports VLR) | 37 (incluye duplicados `demo-*`/`vlr-t-*`, «TBD») | **0 logos** en BD; ids distintos de los del catálogo |
| `players` (espejo esports VLR) | 146 | **0** coinciden por id con jugadores con carta |
| `roster_changes` · `tournaments` · `player_cards` | 0 · 0 · 0 | sin historial de plantillas utilizable |
| `events` | 3 (`vlr-2766` Champions 2026, `vlr-2976-emea-stage-2`, `demo-masters-madrid-2026`) | sin relación carta↔evento |
| `assets` (CMS) | 0 | sin logos subidos |
| `user_cosmetics` antes de F82 | 1 fila (un `titulo`) | **0 insignias** concedidas a nadie |
| `user_achievements` | 13 | logros (sistema aparte) |
| `player_profile_customization` | 3 | vitrina/logros destacados (0049) |

Conclusión: lo único fiable para construir colecciones es el **catálogo** (jugador + equipo impreso + edición) y los
**25 logos reales** que el producto ya sirve en `public/hints/teams/` (F72.3). El espejo esports no sirve (ids de otro
espacio, sin logos, sin historial).

## B. PLAYER COUNT
379 jugadores en `content_players`; 146 en el espejo esports `players` (otro espacio de ids).

## C. CARD-BACKED PLAYERS
**196** jugadores tienen al menos una carta (331 cartas). 183 jugadores del catálogo no tienen carta → nunca pueden ser
requisito (el generador solo parte de cartas). 0 cartas no obtenibles hoy (todas salen de algún sobre activo).
Jugadores con cartas de **dos equipos impresos**: 1 (`sociablee`: FUT y NAVI).

## D. TEAM COUNT
41 equipos impresos distintos en las cartas (`canonicalCardTeam`); 72 etiquetas de equipo «actual» en `content_players`
(plantilla vigente, no usada para sets); 37 filas en el espejo esports.

## E. TEAMS WITH LOGOS
25 de los 41 equipos impresos tienen logo real en el producto (`hintTeamLogoSrc` → `/hints/teams/<id>.png`).
Sin logo (16): All Gamers, DetonatioN FocusMe, DRX, EDward Gaming, FULL SENSE, GE, Gen.G, NS, Paper Rex, RRQ, T1,
Team Secret, TYL, VL, XLG, ZETA DIVISION. La tabla `teams` de BD no tiene ningún logo.

## F. ELIGIBLE TEAM COLLECTIONS
**23** equipos pasan todos los criterios (§AF): 100T, BBL, Cloud9, Dragon Ranger Gaming, Evil Geniuses, Eternal Fire,
Fnatic, FURIA, FUT, G2, GIANTX, Karmine Corp, KRÜ, Leviatán, LOUD, M8, MIBR, NAVI, NRG, PCIFIC, Team Heretics,
Team Liquid, Team Vitality (4–6 requisitos cada uno).

## G. SKIPPED TEAMS + REASONS
18 descartados, con motivo visible en el panel (pestaña «Generador»):

| Motivo | Equipos |
|---|---|
| `NO_LOGO` | All Gamers, DetonatioN FocusMe, FULL SENSE, GE, NS, Paper Rex, RRQ, T1, Team Secret, TYL, VL, XLG, ZETA DIVISION |
| `IDENTITY_CONFLICT` + `NO_LOGO` | DRX, EDward Gaming, Gen.G (auditoría 20.2 sin decisión) |
| `IDENTITY_CONFLICT` | Sentinels |
| `TOO_FEW_PLAYERS` | ENVY (2 jugadores) |

## H. EDITION SET POSSIBILITIES
7 ediciones diseñadas. Umbral = el de la maestría (5 … min(60, 15 % del catálogo = 49)):
- **Elegibles (borrador):** Champions S (20 cartas), Future Star (20 cartas).
- **Descartadas:** Base y Masters L / Masters SDC (`TOO_LARGE`), Moments y Record Breaker (`TOO_SMALL`).

## I. EVENT SET POSSIBILITIES
**Ninguna.** No existe relación carta↔evento/competición en la BD (`events` = 3 filas sin cartas; `tournaments`,
`player_cards`, `roster_changes` vacías). Las ediciones con nombre de evento (Masters, Champions) ya se cubren como
EDITION. No se ha creado ningún tipo EVENT (regla 0: no inventar). Game Changers / región: sin datos fiables → no creados.

## J. EXISTING BADGE SYSTEM
- **Insignias de maestría (F13/F14):** familia `insignia` del catálogo de cosméticos (`insignia:equipo:*`, `:region:*`…,
  con escalón de prestigio), derivadas del catálogo y concedidas en `user_cosmetics`. En producción **nadie** tiene ninguna.
- **Perfil (0049):** vitrina de 3 cartas + logros destacados en `player_profile_customization`; no había insignias en el perfil.
- Nada borrado ni renombrado. F82 **extiende** lo existente: las insignias de colección son la misma familia
  (`insignia:coleccion:*`) en la misma tabla (`user_cosmetics`), y las destacadas son una columna nueva de la misma fila de
  personalización (0049), escrita por un RPC hermano. Las de maestría también se pueden destacar (`ANY_BADGE_PATTERN`).

## K. COLLECTION DATA MODEL
`collection_sets` (0062): `id` estable por versión (`team-g2-v1`), `family` (`team:g2`), `version`, `kind`
(`TEAM`|`EDITION`, extensible), `subject_id`, `title`, `status` (`DRAFT`|`PUBLISHED`|`RETIRED`), `requirements` (jsonb),
`reward` (jsonb, hoy solo `{badgeId}`), `logo`, `checksum` (sha256), `row_version`, fechas y autor.
`user_collection_completions` PK `(user_id, set_id)` + `badge_id` + `completed_at` + `satisfied_by` (qué carta cumplió
cada requisito en el momento del reclamo; auditoría, nunca se recalcula). Dominio puro en `src/domain/collectionSets/`.

## L. REQUIREMENT MODEL
- `PLAYER_ANY_CARD` (sets de equipo): `key = player:<id>`, `cardIds` = las cartas **obtenibles impresas con ese equipo**.
- `SPECIFIC_CARD` (sets de edición): exactamente una carta.
Cada requisito se satisface una vez con poseer **cualquiera** de sus `cardIds`.

## M. VERSIONING
- Al publicar: validación completa → `checksum = sha256(canonicalPayload)` (orden canónico) → `DRAFT→PUBLISHED`.
- La BD congela lo publicado (disparador `_collection_sets_guard`): requisitos, recompensa, logo, sujeto, título, checksum
  inmutables; solo `DRAFT→PUBLISHED→RETIRED`; un set nace DRAFT; lo publicado no se borra; una sola PUBLISHED por familia.
- Cambio de plantilla/catálogo → `newVersion` (borrador v+1 regenerado, misma insignia). Lo completado sigue completado.
- Re-verificado hoy: los 6 publicados tienen **checksum correcto** recalculado desde la BD y siguen siendo válidos contra el
  catálogo vivo (`issues = 0`).

## N. TEAM MEMBERSHIP RULE
El equipo de una carta es el **impreso** en ella (`canonicalCardTeam`, decisión de producto del 2026-09-21), no la
plantilla actual (`Player.team`) ni ningún historial (no existe). Un jugador con cartas de dos equipos cuenta en cada set
**solo con las cartas de ese equipo** (test: `sociablee` FUT no completa NAVI). Identidad por `player_id`, nunca por nombre.
Como los requisitos se congelan con sus `cardIds`, un fichaje futuro no altera un set publicado (test «cambio de plantilla»).

## O. MULTIPLE VARIANT RULE
Cualquier variante elegible satisface `PLAYER_ANY_CARD` (G2: 4 cartas válidas por jugador). La UI lista las variantes
poseídas («owned-variants») sin multiplicar filas. En sets de edición, `SPECIFIC_CARD` exige la carta exacta.

## P. DUPLICATE RULE
El servidor reduce `user_cards` a ids **distintos** antes de calcular; un requisito cuenta una vez. Test «5 copias ≠ 5 jugadores».

## Q. SERVER PROGRESS
`GET /api/game/collection-sets` (usuario solo del Bearer, sin parámetros) calcula en servidor `required / owned / missing /
pct (entero hacia abajo, nunca 100 sin completar) / completeNow / state (LOCKED · IN_PROGRESS · CLAIMABLE · COMPLETED) /
completedAt` y, por requisito, `ownedCardIds` y `eligibleCardIds`. El cliente no recalcula nada.

## R. EXISTING USER EVALUATION
**Evaluación perezosa**, sin backfill ni ganchos: cualquier vía legítima que añada filas a `user_cards` (sobre, recompensa,
crafteo, proyecto, admin) se refleja en la siguiente lectura. Un usuario que ya cumplía un set al publicarse lo ve
CLAIMABLE sin hacer nada. **Probado en producción:** QA K (91cb8a2c) ya cumplía Eternal Fire con cartas obtenidas antes de
F82 y lo reclamó (§S). Hoy cumplen sets publicados: tu cuenta (los 6) y QA K (Eternal Fire).

## S. COMPLETION
Reclamo manual (`RECLAMAR INSIGNIA`), elegido sobre auto-concesión porque (1) encaja con el modelo existente (logros y
misiones también se reclaman en `/logros`/`/progresion`), (2) evita escrituras en GET (patrón de toda la casa desde F42) y
(3) permite el momento de celebración en el instante del reclamo. No hay mezcla de sistemas: nada se concede solo.
`app_collection_claim` vuelve a comprobar **en la misma transacción** contra `user_cards` cada requisito.

## T. EXACTLY-ONCE REWARD
PK `(user_id, set_id)` + `insert … on conflict do nothing` + rama `ALREADY` + `FOR SHARE` sobre el set (un retiro concurrente
espera). Insignia en `user_cosmetics` con `on conflict do nothing`.
- **Producción (real):** doble clic en la UI + 6 reclamos simultáneos desde otras dos sesiones de la misma cuenta →
  UI `COMPLETED`, 6 × `ALREADY`; BD: **1** compleción, **1** insignia (`docs/…/prod/db-after-claim.txt`). Reintento → `ALREADY`.
- **Postgres real aislado** (dry-run repetido hoy): 20 reclamos paralelos → 1 COMPLETED + 19 ALREADY; carrera reclamo↔retiro
  y reclamo↔desguace coherentes. `DRYRUN_OK`, 29/29.

## U. PERMANENCE
`user_collection_completions` no tiene FK a `user_cards` ni la toca ningún desguace/crafteo/venta; la insignia vive en
`user_cosmetics`. Test «permanente tras desguazar/vender». F79 decide el consumo de cartas: la compleción **no protege**
ninguna carta (no se ha tocado `domain/cards/protection.ts` ni ningún RPC de F79). Retirar un set no quita el trofeo a
quien lo completó (sigue visible para él).

## V. TEAM BADGES
Insignia `insignia:coleccion:team-<id>` por equipo, solo cosmética y permanente: no se gasta, no se vende, no se craftea,
no se lista en mercado (no existe ningún camino que la lea fuera de perfil/sala).

## W. LOGO ASSETS
Logo real sin alterar (`<img>` con `alt` = nombre del equipo) dentro de un escudo propio Valorosters (`TrophyBadge`:
hexágono, borde, brillo). Sin logo real → el equipo **no** genera set (no se dibuja uno falso). Ediciones: lenguaje visual
propio (glifo/tono), sin logos oficiales. **Riesgo vigente:** los 25 logos son los de F72.3, integrados técnicamente con la
nota «marcas para release pública SIN RESOLVER» (§BM).

## X. TROPHY ROOM
`/coleccion/trofeos` (enlace «Sala de Trofeos →» desde `/coleccion` para usuarios con cuenta). Cabecera con 4 cifras reales
(equipos completados, colecciones, insignias, % de catálogo = cartas distintas del catálogo poseídas / 331), banner de
«lista para reclamar», búsqueda, filtros (Todas / En progreso / Completadas / Sin empezar + Todo / Equipos / Ediciones
cuando hay más de un tipo publicado), orden (más cerca por defecto · completadas recientes · alfabético), insignias
desbloqueadas/bloqueadas y compleciones recientes. Los sets al 0 % se enseñan (descubrimiento).

## Y. TEAM GRID
Tarjeta por set: escudo con logo, nombre, tipo, barra, `owned/required`, «N jugadores restantes», estado con texto
(no solo color) y candado en lo bloqueado.

## Z. TEAM DETAIL
`/coleccion/trofeos/[setId]`: escudo grande, progreso, **TE FALTA N** primero (con la carta real de cada requisito y en qué
sobres puede salir), **YA TIENES N** después (variantes poseídas), y la recompensa. Botón `RECLAMAR INSIGNIA` solo si el
servidor dice CLAIMABLE.

## AA. MISSING PLAYERS
Sección primera y explícita: «Te faltan 2 · TRENT / VALYN — cualquier carta de trent con G2 · 4 cartas valen · Puede salir
en: Sobre Americas, Sobre Bronce, Sobre Champions» (captura real `prod/shots/QA-detail-progress-390.png`).

## AB. COMPLETION CELEBRATION
`CompletionMoment`: oscurece la pantalla, escudo con el logo, «EQUIPO COMPLETADO», nombre, «Insignia desbloqueada»,
`DESTACAR EN MI PERFIL` / `CONTINUAR`. Diálogo modal (foco atrapado, Escape cierra); versión **reducida** sin animación (capturas
`moment-*-reduced.png`). **Visto en producción real** con QA K (`prod/shots/K-moment-1440.png`). Si el reclamo ya existía,
el texto lo dice («Ya era tuya…»).

## AC. PROFILE BADGES
Sección «Insignias» justo bajo la vitrina, a tamaño de trofeo con nombre y subtítulo. PUBLIC: solo las elegidas y
poseídas; sin elegidas la sección no aparece; **nunca** bloqueadas ni la lista completa (verificado en producción: el
perfil público de K no contiene `ownedBadges`/`featuredBadgeIds`/`locked`). SELF: contador, «Elegir insignias», enlace a la sala.

## AD. EQUIP / UNEQUIP / REORDER
Pestaña «Insignias» del editor de perfil existente: hasta 3, subir/bajar/quitar (botones de 44 px con aria-label), guardar.
Servidor: forma (≤3, sin repetidas, patrón de insignia) → **propiedad dentro del RPC** contra `user_cosmetics` → versión
optimista. Producción: destacar → SAVED; mismo contenido → UNCHANGED; quitar → SAVED; versión vieja → 409 CONFLICT;
insignia ajena/inventada → 403 LOCKED; 4 → 400; cosmético no-insignia → 400. Reordenar: tests + dry-run (una cuenta QA
real solo tiene 1 insignia, así que el reorden en producción no es observable sin conceder insignias falsas).

## AE. ADMIN
`/admin/collection-sets` dentro del Control Center existente (grupo «Contenido» → «Colecciones»), mismas reglas `runAdmin`
(verifyAdmin + rate limit + cuerpo cerrado + auditoría): listar, generar borradores de equipos/ediciones, ver requisitos con
cartas (OVR, edición, equipo impreso, obtenible), editar borrador (título, insignia, quitar requisito, añadir jugador/carta),
previsualizar, publicar (con confirmación), retirar (motivo ≥ 8), nueva versión, borrar borrador. Concurrencia optimista por
`row_version`. Capturado en producción con datos reales de la BD (respuestas de admin interceptadas en el navegador, 0
escrituras): `prod/shots/admin-*`.

## AF. DRAFT GENERATOR
`generateTeamDrafts` / `generateEditionDrafts` (puros, sobre el catálogo vivo). Criterios TEAM: identidad canónica
(`NO_IDENTITY`), sin conflicto abierto en la auditoría 20.2 (`IDENTITY_CONFLICT`), logo real (`NO_LOGO`), ≥ 4 jugadores
con carta impresa (`TOO_FEW_PLAYERS`), todo jugador con al menos una carta obtenible (`UNOBTAINABLE` descarta el set
entero: nunca se quita a un jugador en silencio). EDITION: tamaño 5–49 y todas obtenibles. Nunca publica; una familia
existente no se toca.

## AG. PUBLISH VALIDATION
`validateForPublish`: estado DRAFT, id/versión/título/insignia válidos, no vacío, sin requisitos ni jugadores duplicados,
jugador existe, toda carta existe, es de ese jugador, del equipo del set (TEAM) o de la edición (EDITION), `SPECIFIC_CARD`
con una carta, sujeto conocido, logo = el real del equipo, y cada requisito con al menos una carta **obtenible**. La siembra
de producción además re-comprobó en SQL que cada carta congelada está `PUBLISHED` en `content_cards` (o abortaba).

## AH. DRAFT SETS CREATED
**19 en DRAFT:** 17 de equipo (100T, BBL, Cloud9, Dragon Ranger Gaming, EG, FURIA, FUT, GIANTX, Karmine Corp, KRÜ, LOUD, M8,
MIBR, NAVI, NRG, PCIFIC, Team Vitality) + 2 de edición (Champions S, Future Star).

## AI. PUBLISHED SETS
**6 PUBLISHED** (12:38:57Z, operador F82, auditados en `content_audit_log`): G2 (5), Team Heretics (6), Fnatic (5),
Leviatán (5), Team Liquid (5), Eternal Fire (4). Criterio: logo real, plantilla con carta obtenible para todos, identidad
verificada en 20.2 excepto Eternal Fire (identidad `unverified` pero sin conflicto abierto y equipo impreso exacto; ver §BM).
Compleciones en producción: 1 (QA K · Eternal Fire).

## AJ. RETIRED SETS
**0.** (Retirar está probado en tests y en el dry-run sobre Postgres real.)

## AK. SECURITY
Producción (QA, 71/71): anónimo → 401 en sala, reclamo y panel; reclamar borrador → 404 (invisible); incompleto → 409 sin
escritura; «tengo todas» (campo extra) → 400; reclamar en nombre de otro (`userId`) → 400; parámetro en URL → 400; id mal
formado → 400; destacar bloqueada/inventada → 403; usuario normal en el panel (leer/generar) → 401; perfil público sin
bloqueadas. Tests: A no puede reclamar con cartas de B ni ver su progreso; set retirado; borrador invisible.

## AL. RLS
Tablas nuevas con RLS activada **sin políticas** y sin privilegios para `anon`/`authenticated` (solo `service_role`, como
0049); RPC `SECURITY DEFINER` con `search_path` fijo y EXECUTE solo para `service_role`. Comprobado en el dry-run
(«privilegios: anon/authenticated sin nada») y en el contrato SQL de los tests.

## AM. RACE TESTS
Producción: doble clic + 6 reclamos en 2 sesiones → 1. Dry-run (Postgres real, psql en paralelo): A) 20 reclamos → 1;
B) retirar mientras 10 reclaman → cada uno COMPLETED o RETIRED, insignias = compleciones; C) 10 «destacar» con la misma
versión → 1 SAVED; D) reclamar mientras se desguaza la carta que lo completa → COMPLETED con su carta o INCOMPLETE.

## AN. SCALE / PERFORMANCE
Lectura de la sala = 5 consultas en paralelo (sets visibles, `user_cards` paginado, compleciones, cosméticos, fila de
perfil), sin N+1. Agregación pura medida (`scripts/_f82-perf.ts`, peor caso 331 cartas): 25 sets 0,4 ms / 41 KB; 250 sets
0,4 ms / 408 KB; 1.000 sets 1,0 ms / 1,6 MB. Con los 6 publicados la respuesta es pequeña. La estimación de «ya lo
cumplen» del panel lee solo las filas de `user_cards` de las cartas del set (≤ 400 ids). Ver §BM sobre el tamaño de
respuesta si se publican cientos.

## AO. 1440 · AP. 1024 · AQ. 390
Producción (QA K/QA): sala, detalle completado y perfil propio a 1440/1024/390 **sin desbordamiento horizontal**
(`scrollWidth − innerWidth = 0`); detalle en progreso a 390 sin desbordamiento; panel admin a 1440/1024/390 sin
desbordamiento. Arnés `/design-system/fase82`: 12 escenas × 3 anchos × normal/reducido (`qa-normal+reduced-1440+1024+390.json`).

## AR. ACCESSIBILITY
Teclado y foco visibles (`nx-focus`), celebración como `role="dialog"` modal con foco atrapado y Escape (`useDialogLayer`),
filtros con el control segmentado compartido (`Segmented`), `aria-pressed` en las opciones del editor de insignias, tarjetas
con `aria-label` «G2: 3 de 5. 2 jugadores restantes», búsqueda con etiqueta, listas ordenadas con `aria-label`, logos con `alt`, estados con **texto** («Te falta», «Ya tienes», «Reclamar», candado), no solo
color; movimiento reducido respetado (y es la configuración real del usuario).

## AS. ANALYTICS
`lib/collectionSets/telemetry.ts` define `collection_viewed`, `collection_set_viewed`, `collection_completed`,
`badge_unlocked`, `badge_equipped` y se llama en los puntos correctos, pero es un **no-op honesto**: el contrato de flujos
de telemetría está cerrado a propósito (4 flujos fijados por tests) y abrirlo requiere BD + contrato. Lo que sí queda medido,
con fecha y sin PII: `user_collection_completions.completed_at`, `user_cosmetics.granted_at` (source `collection:<set>`) y
`player_profile_customization.updated_at`.

## AT. ECONOMY UNCHANGED · AU. PACKS UNCHANGED
Ningún fichero de economía/sobres/tienda en el delta de release (lista de 58 ficheros comprobada). Precios en código
2.500/6.000/12.000/20.000/35.000/60.000 (+ inicial); probabilidades y número de cartas sin tocar. Recompensas F82 = solo
insignias: ni créditos, ni sobres, ni cartas. `tests` 5797/5797 incluyen los pins de economía (economyFinal, packEconomy…).

## AV. F81 UNCHANGED
`domain/packs/reveal.ts`, apertura, héroe, `localEconomy`, sync y store fuera del delta. Tests de F81/F81.1/F81.2 en verde.

## AW. F78 EXCLUDED
Release construida en el VPS desde el código de `dbe08499` + **solo** los 58 ficheros F82. Prueba hecha hoy: diff de sha256
de todos los ficheros (sin `node_modules`/`.next`) entre `releases/dbe08499` y `releases/d3973448` = exactamente la lista
del overlay (`SAME_SET`), sin ningún fichero de F78/offsite/B2. Y el código local coincide byte a byte con lo desplegado
(`LOCAL_EQ_DEPLOYED`). F78 no se ha tocado: `production:check` sigue mostrando sus 4 FAIL externos conocidos.

## AX. MARKETPLACE OFF · AY. PAYMENTS OFF
`GLOBAL_MARKET_ENABLED = false` (`src/config/features.ts`), `PAYMENTS_ENABLED = false` (`src/config/monetization.ts`),
confirmado por `production:check`. Insignias sin conexión al mercado.

## AZ. MIGRATION
`0062_collection_sets.sql`: cabeza previa comprobada = 0061 por estado real; aplicada **una vez** el 2026-10-03 ~12:38Z como
`postgres`, una transacción, sin registrar en `schema_migrations` (igual que 0026–0061). Aditiva: 2 tablas, 2 RPC, 1 columna
con 3 checks en `player_profile_customization`; 0049 sigue funcionando (dry-run). Cabeza nueva por estado real:
`/api/ready` → `migrationHead: 0062_collection_sets`. Rollback: `docs/operations/rollback/0062_collection_sets.ROLLBACK.sql`
(probado en el dry-run, re-aplicación limpia).

## BA. BACKUP
`/opt/nexus/backups/supabase-drlcards/pre-0062/20261003T120125Z` (para el dry-run) y `…/20261003T123819Z` (justo antes de
aplicar; `COMPLETE` + `SHA256SUMS` verificados por el dry-run de hoy). Esto es un backup local en el VPS: **no cierra F78**.

## BB. FULL TEST SUITE
`npm test`: **5797/5797**, 0 fallos (incluye 39 tests F82: 20 de dominio + 19 de servicio/panel/contrato SQL).

## BC. TYPES
`tsc` del código: OK. `tsc` de scripts: daba 1 error en el instrumento `scripts/_f82-qa.ts` (argumento de más en `tab.js`,
fuera del build de la app); corregido hoy → OK. (Instrumento: no afecta a la release; queda como única diferencia local vs desplegado.)

## BD. LINT
`eslint src`: 0 errores, 9 avisos (base del repo).

## BE. BUILD
Build de producción de `d3973448` en el VPS (contenedor desechable, `bin/deploy.sh`): OK, `BUILD_ID` = nombre de release
(`logs/build-drl-0.1.1-1-d3973448.log`); rutas `/coleccion/trofeos`, `/coleccion/trofeos/[setId]`, `/admin/collection-sets`
y APIs presentes.

## BF. HEALTH · BG. READY
`/api/health` 200 `ok`; `/api/ready` 200 `ready`, cabeza `0062_collection_sets`. Contenedor `healthy`, 0 reinicios desde
el despliegue; túnel con 4 conexiones.

## BH. SMOKE
`scripts/_f82-prod-qa.mts` contra `https://valorosters.com` con cuentas QA: **71/71** (`prod/prod-qa.json`): salud, auth,
sala, reclamo real exactamente-una-vez, insignias, perfil propio y público, 1024/390, y regresión de lectura: `/`,
`/coleccion`, `/coleccion/trofeos`, `/tienda`, `/misiones/crafting`, `/competitivo`, `/progresion`, `/admin/collection-sets`
→ 200; `/api/game/{state,me,competitive,forge,missions,crafting}` → 200. `production:check --app --vps` (12:45Z): 27 PASS,
1 WARN (auth-email, F77 conocido), 4 FAIL = F78 off-site (externos, conocidos).
No se probó compra/apertura real de sobres ni ranked en partida (QA sin saldo y sin cambios en esas áreas).

## BI. LOGS
`valorosters-app`: 8 líneas en 8 h, 0 errores. Postgres: solo mis consultas de auditoría con columnas mal escritas, las
sondas de privilegios de `production:check`, y `permission denied for table profiles` del navegador — **anterior a F82**
(201 veces en las 72 h previas): la precomprobación de admin (`fetchOwnProfile`) pide una columna que 0058 ya no expone.
Deuda vieja, no tocada.

## BJ. RELEASE
**Producción: `drl-0.1.1-1-d3973448`** (activa desde 2026-10-03T12:42:51Z) = `dbe08499` + 58 ficheros F82
(31 nuevos, 27 modificados; lista en el VPS `/tmp/f82/overlay.txt`).

## BK. ROLLBACK
Código: `bin/deploy.sh --activate drl-0.1.1-1-dbe08499` (la app anterior no usa nada de 0062; compatible con 0062 aplicada).
BD (solo si hiciera falta y tras desplegar el código anterior): `0062_collection_sets.ROLLBACK.sql`; pierde compleciones y
destacadas, no borra las insignias concedidas en `user_cosmetics` (decisión de producto aparte). Backup `pre-0062` disponible.

## BL. COMMIT/PUSH
Ninguno.

## BM. REMAINING RISKS
1. **Marcas/logos:** los 25 logos de equipo son los de F72.3, con la nota «marcas para release pública SIN RESOLVER».
   F82 los convierte en recompensa visible en perfiles públicos. Decisión tuya antes de una release pública.
2. **Eternal Fire** se publicó con identidad `unverified` (sin conflicto abierto y equipo impreso exacto). Si prefieres
   solo identidades verificadas, retírala (QA K conserva su trofeo).
3. **Tamaño de respuesta** de la sala si se publican cientos de sets (~400 KB a 250): habría que paginar o aligerar
   `eligibleCardIds`. Hoy 6 publicados.
4. **Analítica** de flujos sigue cerrada (no-op): medir uso requiere abrir el contrato de telemetría.
5. «Forma parte de: G2 Collection» en la ficha de carta y avisos «G2: 4/5» tras abrir sobres **no se hicieron** (secundarios
   en el encargo; el cálculo existe: `setsTouchedBy`).
6. Tu cuenta personal cumple los 6 sets publicados y verá 6 «RECLAMAR»: no se ha tocado (prohibido usarla para QA).
7. Reordenar insignias no es observable en producción sin conceder insignias falsas; cubierto por tests y dry-run.
8. Deuda previa: errores `permission denied for table profiles` del precheck de admin (§BI).

## BN. FINAL VERDICT

Definición de hecho: 1 ✔ · 2 ✔ (23 equipos convertibles, 6 publicados) · 3 ✔ · 4 ✔ · 5 ✔ · 6 ✔ · 7 ✔ (real, carrera en
producción) · 8 ✔ · 9 ✔ · 10 ✔ · 11 ✔ · 12 ✔ · 13 ✔ (QA K, retroactivo) · 14 ✔ · 15 ✔ · 16 ✔ · 17 ✔ · 18 ✔ · 19 ✔ ·
20 ✔ (con las salvedades de BH).

**F82 PRODUCTION = GO**

(Con el riesgo 1 —marcas de los logos— pendiente de tu decisión antes de una release pública.)
