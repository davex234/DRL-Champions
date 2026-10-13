# F84 — RANKED 2.0 / COMPETITIVE SYSTEM · Informe final

Fecha: 2026-10-04 · Rama `arch/stabilization` · Sin commit ni push.

Evidencias: `docs/product/qa/f84-ranked/` (distribución real `distribution-baseline.json` / `distribution-postdeploy.json`,
simulación `simulation.json`, QA visual del arnés `qa-*.json` + `shots/` a 1440/1024/390 normal y reducido) y
`docs/product/qa/f84-ranked/prod/` (ensayo `dryrun-0065.log`, aplicación `apply-0065.log`, frontera `stage-boundary.log` +
`overlay-files.txt`, despliegue `deploy.log`, QA de producción `prod-qa.json` + `match.json` + `shots/`).

> **Decisión central.** F84 **extiende** el Ranked que ya existía (cola 0032, rating Elo 0033–0035, escalera 0047, privados
> 0048, endurecimiento F76): el rating canónico sigue siendo `duel_pvp_ratings.rating` con la **misma fórmula**. Encima se
> construye la identidad competitiva: **rango + división DERIVADOS del rating** con fronteras versionadas (`rank-v1`), una
> **temporada competitiva** propia (independiente de la XP de F83), **colocación de 5 partidas** que solo REVELA el rango
> (el rating histórico se conserva como semilla), **Top 500** con elegibilidad por actividad, récord/pico por temporada
> escritos exactamente una vez por la liquidación, y la UX (centro, post-partida, perfil). La frontera F84 es el instante de
> aplicar 0065: **2026-10-04T17:33:41Z**.

---

## A. INITIAL PRODUCTION STATE
Comprobado contra producción antes de tocar nada: release `drl-0.1.1-1-22c509c6`, `/api/ready` ready, cabeza
`0064_season_track`, suite local 5871/5871, Temporada 2 · Asalto en DRAFT, pase heredado activo hasta el 30-nov. Árbol local
= producción fichero a fichero (sha256) salvo los 7 ficheros F78, `scripts/_f82-qa.ts` y `next-env.d.ts`.

## B. CURRENT RANKED AUDIT
- **Cola** (`duel_pvp_queue`, 0032/0033): una búsqueda viva por usuario (índice único parcial), TTL 600 s + barrido, sella el
  rating canónico al entrar (`rating_snapshot`), emparejador serializado con cerrojo consultivo; F76: `settle()` responde IDLE
  a un MATCHED muerto, 409 ACTIVE_MATCH con la entrada viva, época del cliente, `?match=` para F5.
- **Partida**: nace IN_PROGRESS (no hay fase WAITING jugable); resultado del MOTOR en el servidor; acciones con `state_version`
  y `actionId`; reloj de 30 s con jugada automática (F72.8).
- **Liquidación** `duel_pvp_settle_match` (0035): atómica, idempotente por índice único `(match_id, user_id)`, bloqueo ordenado
  de las dos fichas; se llama tras el UPDATE condicionado y como red de seguridad en cada sondeo completo.
- **Lectura**: `services/competitive.ts` (snapshot, historial, detalle, perfil, posición, escalera, emparejamiento) — solo
  lectura. Escalera F55 = todos con ≥ 1 partida, orden rating desc → updated_at asc → user_id asc.
- **UI F55**: `/competitivo` (héroe por puesto, «colocación 10» = partidas provisionales), resultado con ceremonia por puestos.
- **No existían**: rangos/divisiones, temporada competitiva, colocación por temporada, picos, Top 500, BYE/NO_SHOW/disputas
  en duelos (solo existen en el módulo táctico congelado `src/tournament/`).

## C. CURRENT RATING FORMULA
Elo logístico, **sin cambios en F84**: inicial **1000**; esperanza `1/(1+10^((Rrival−R)/400))`; **K por jugador**: 40 si
< 10 partidas de por vida, 24 después; delta = round(K·(S−E)); recorte a **[0, 5000]** (suelo 0, techo 5000) y delta
efectivo; empate S = 0,5; abandono en juego o vencimiento = derrota de `closed_by`; abandono antes de empezar →
NOT_COMPETITIVE; sin culpable → NO_ABANDONER; privado/PvE → NOT_PVP; elegibilidad = `mode='PVP'` terminada. Idempotencia por
índice único; histórico completo en `duel_pvp_rating_events` (old/delta/new/rival/K/resultado). Verificado en producción: 116
asientos, 0 roturas de cadena, 0 deltas irreproducibles, 0 descuadres de contadores.

## D. RATING DISTRIBUTION
Producción antes de F84 (agregado, sin usuarios): 20 fichas, **10 con partidas**; min 885 · max 1110 · media 999,7 · σ 74,6;
**P10 912 · P25 930,5 · P50 1004,5 · P75 1067 · P90 1091 · P95 1101 · P99 1108**; partidas P10 3,8 · P50 7,5 · P90 29,1.
Población real ≈ cuentas QA: muestra mínima, por eso los umbrales se apoyan también en la simulación (§BW–CB).

## E. INFLATION/DEFLATION ANALYSIS
Casi suma cero: neto −3 en 58 partidas (suma por partida entre −8 y +5). La asimetría viene solo de la K por jugador (40 vs
24 cuando uno es provisional) y del redondeo; no hay deriva sistemática. Simulación (1000 jugadores, 40 partidas): deriva
media por jugador −0,6…+1,1 puntos. **Fórmula no tocada**: no hay bug matemático.

## F. RANK IDENTITY
La carrera de un jugador de esports: de la **cantera** a la **cumbre**. Forma propia por tier (chevron, rombo, escudo,
hexágono con alas, blasón con corona, estrella en anillo, pico con rayos), complejidad creciente, divisiones como barras + numeral.

## G. RANK NAMES
**Cantera → Promesa → Titular → Veterano → Capitán → Estrella → Cumbre** (élite). Cortos, pronunciables, en español, ligados a
roster/esports. Sin Iron/Bronze/…/Radiant ni sus traducciones, sin nombres de los sobres (Bronce/Plata/Oro/Masters/Champions/
Icon) ni Leyenda/Titán (test R2 lo congela).

## H. DIVISIONS
III → II → I (I la alta) en los 6 tiers normales; la Cumbre sin divisiones. 19 escalones.

## I. THRESHOLDS
Anchura de división **30** (≈ 2,5 victorias netas con K 24). `rank-v1`: Cantera < 860 (III < 800, II 800–829, I 830–859) ·
Promesa 860–949 · **Titular 950–1039 (1000 = Titular II: el jugador medio es titular)** · Veterano 1040–1129 · Capitán
1130–1219 · Estrella 1220–1309 · **Cumbre ≥ 1310**. Con los datos reales: Promesa 3 · Titular 4 · Veterano 3 (ninguno
atrapado abajo, ninguno arriba). Cumbre ≈ 85 % de victorias sostenidas contra la media: rendimiento, no volumen.

## J. CONFIG VERSIONING
`src/domain/ranked/config.ts`: `RANK_CONFIGS` solo con `rank-v1`, huella congelada en test (R1); la temporada fija
`rank_config_version` (inmutable al publicarse, disparador). Cambiar fronteras = versión nueva + temporada nueva.

## K. RATING SOURCE OF TRUTH
Una sola: `duel_pvp_ratings.rating`. Cola (snapshot al entrar), liquidación, clasificación (la vista `competitive_ladder` hace
JOIN, no copia), perfil, emparejamiento y rango (derivado) leen esa columna. Guardia nueva: rating y contadores solo cambian
desde las funciones ledgerizadas (un UPDATE suelto choca, también del service_role).

## L. COMPETITIVE SEASON MODEL
`competitive_seasons` (DRAFT → PUBLISHED inmutable → CANCELLED; fase por hora de BD; dos publicadas no se solapan; `ends_at`
NULL = abierta, se fija UNA vez hacia el futuro). Config congelada: colocación 5, Top {500, ≥ 5 partidas, actividad 14 días},
tope de pareja {5 / 24 h}, `reset` (null en la 1). **Temporada competitiva 1** publicada en la migración, desde la frontera F84,
abierta.

## M. F83 RELATIONSHIP
`game_season_id` opcional (enlace de calendario). La 1 **no** se enlaza: T2 sigue DRAFT, F84 funciona con el pase heredado en
curso. XP de temporada ≠ rating: ni una línea de 0065 toca `game_seasons`, `season_xp_ledger` ni `user_pass` (test C5).

## N. HISTORICAL BOUNDARY
- **Se conserva**: todos los ratings, contadores y los 116 asientos (sellados `ranked-rating-v1`, era la fórmula aplicada).
- **Se deriva legítimamente**: el rango ACTUAL de cualquier rating.
- **Empieza en F84**: colocación, récord y picos de temporada, número de partida de temporada, clasificación Top, fotos de
  cierre. Los asientos anteriores llevan `competitive_season_id = NULL`: no se inventan colocaciones ni picos históricos
  (verificado en producción: un resultado previo responde UNSEASONED).

## O. EXISTING PLAYER MIGRATION
Rating histórico = **semilla oculta**; nadie se reinicia a 1000. Al empezar la temporada todos están SIN CLASIFICAR (0/5); sus
5 partidas usan su rating real (K 24 para los veteranos) y al cerrarlas se revela el rango de ESE rating.

## P. PLACEMENTS
5 partidas ranked de la temporada. Se cuentan con `competitive_season_players.matches`, que SOLO incrementa la liquidación
detrás de la puerta del libro (exactamente una vez), y cada asiento sella `season_match_number` (índice único por
temporada/jugador/número). Si el contador y el número divergen, la transacción revienta (`COMPETITIVE_SEASON_DRIFT`).

## Q. PLACEMENT SEED
El rating vigente (sin reinicio). Preparado para futuras temporadas: `competitive_season_seed` (reinicio suave ledgerizado
`baseline + factor·(rating − baseline)`, un asiento por jugador), sin ejecutar.

## R. PLACEMENT SIMULATION
Rival al mismo rating: nuevo (1000, K 40) 5-0 → 1100 (Veterano I) · 4-1 → 1060 · 3-2 → 1020 · 2-3 → 980 · 1-4 → 940 · 0-5 →
900 (Promesa II); veterano (1089, K 24) ±60; bajo (885) ±60. Ninguna colocación lleva a la élite (test F2).

## S. PLACEMENT REVEAL
`RankChange` · «Colocación completada 5/5 → RANGO OBTENIDO → emblema → nombre + rating» (≈ 2,1 s), con destello propio.

## T. RATING LEDGER
Se reutiliza `duel_pvp_rating_events` (ya robusto) + columnas `formula_version`, `competitive_season_id`,
`season_match_number`, `rule`. Cambios no-partida en `competitive_rating_adjustments` (semilla/corrección, ref única, motivo).
Vista `competitive_rating_ledger` = los dos (auditoría e invariantes). Inmutables: UPDATE prohibido; DELETE solo en cascada de
borrado de cuenta.

## U. FORMULA VERSION
`ranked-rating-v1` en cada asiento (y en la temporada). Una fórmula futura = otra versión, sin perder auditabilidad.

## V. IDEMPOTENCY
Ensayo: la misma partida liquidada 20 veces a la vez → 1 SETTLED + 19 ALREADY_SETTLED, 2 asientos, récord 1. Producción: 6
lecturas del resultado → mismo movimiento, 2 asientos.

## W. CONCURRENCY
Ensayo: 10 partidas distintas de la misma pareja liquidadas a la vez → 10 SETTLED, números 1..10 contiguos, exactamente 5
STANDARD + 5 PAIR_CAP (el recuento del tope se hace con las fichas bloqueadas). Hallazgo corregido en el ensayo: `created_at
= now()` es la hora de INICIO de la transacción y desordenaba la cadena con liquidaciones concurrentes → ahora
`clock_timestamp()` bajo el bloqueo (cadena 0 roturas). Cierres y semillas concurrentes también exactamente una vez.

## X. PROMOTION
Cruce hacia arriba (servidor: `rankMovement` desde el asiento): ASCENSO con rango nuevo, desde dónde, rating y delta; cambio de
TIER = ceremonia grande.

## Y. DEMOTION
DESCENSO dicho con claridad, sobrio: antes → ahora, rating, «te faltan N para volver a X». Sin destellos ni fiesta.

## Z. SAME-DIVISION RESULT
«Titular II · +8» con la barra dentro de la división (de la posición anterior a la nueva) y los puntos para la siguiente.

## AA. PEAK RATING
`peak_rating` por temporada (máximo `new_rating`), escrito por la liquidación; = máximo del libro (invariante comprobado).

## AB. PEAK RANK
`peak_ranked_rating` = máximo desde que completó la colocación → «Mejor rango de la temporada» = `deriveRank(pico)`; no se
reconstruye con el rating actual (test P3).

## AC. SEASON SNAPSHOT
`competitive_season_close` (preparada): foto final por jugador desde el libro inmutable (rating final, pico, pico de rango,
récord, colocación, puesto con la actividad medida al FINAL, tope 500). Ensayo: 3 cierres simultáneos → una foto por jugador;
inmutable. Sin ejecutar (la 1 no termina).

## AD. LEADERBOARD
Top de la temporada: posición, jugador (nombre/avatar públicos), **emblema + rango**, rating, récord V–D de temporada. Vacía y
honesta hoy en producción (0 elegibles: nadie ha completado la colocación).

## AE. LEADERBOARD PAGINATION
`range` acotado (≤ 50, offset alineado) sobre la vista; posición por 3 recuentos `head`; nunca la escalera entera.

## AF. AROUND ME
«Tu zona»: los 3 de encima y 3 de debajo (servidor) cuando no estás en la página visible; botón «Ir a mi posición».

## AG. TOP 500 / ELIGIBILITY
Elegible = colocación completa + ≥ 5 partidas de temporada + una partida en 14 días. El Top enseña `min(elegibles, 500)`; un
puesto > 500 no se numera. Inactivo conserva rating y rango, pierde el número (no hay decay). Emblema + «Top 500 · #N».

## AH. LOW POPULATION
Con 17 elegibles se ven 17 (test S4: 83 → 83; tope 10 con 25 → 10). Clasificación vacía con mensaje de cómo entrar.

## AI. RANKED HUB
`/competitivo` reconstruido: héroe con emblema grande, RANGO + división, rating, puesto del Top, mejor rango, progreso a la
siguiente división, colocación X/5, por qué estás fuera del Top, récord de temporada; CTA de juego único; últimas partidas;
clasificación + tu zona; «Cómo funcionan los rangos» (fronteras reales). Una petición de snapshot (+ mazos + play-status, como antes).

## AJ. RANK EMBLEMS
SVG propios (`CompetitiveEmblem`), 7 formas, marcos crecientes, barras de división, anillo de colocación, contorno discontinuo
sin clasificar; `aria-label` con el nombre. Sin assets externos.

## AK. POST-MATCH UX
`GET /api/game/duel/pvp?outcome=1` devuelve `rank` (movimiento derivado del asiento en el servidor): colocación X/5, rango
obtenido, ascenso, descenso, misma división, tope de pareja; el cliente no calcula nada. Solo se pinta junto al asiento.

## AL. PROMOTION ANIMATION
Emblema viejo → contador del rating → destello al cruzar → emblema nuevo (≈ 1,7–2,5 s; QA: termina en el rango final ≤ 4 s).

## AM. DEMOTION UX
Ver §Y.

## AN. PROFILE F89
Héroe: emblema + Rango (o «Colocación 3/5») + Rating + Top #N + Mejor rango · temporada. Sección ranked: rango y mejor de la
temporada; colocación de la temporada. Equipo favorito, vitrina, insignias, carrera, colecciones y privacidad intactos.

## AO. PUBLIC PROFILE
Proyección pública: rango solo tras colocación; sin versión, saldo ni correo (tests S8/S10, QA producción). Sin caché HTTP
(`no-store`): un cambio de rango se ve en la siguiente lectura.

## AP. MATCHMAKING
Sin cambios: buscador = el que más espera; rival = menor diferencia de `rating_snapshot` (rating canónico sellado al entrar).

## AQ. MATCHMAKING RANGE
Ventana por espera: < 15 s ±150 · < 45 s ±300 · < 90 s ±600 · después cualquiera; siempre el más cercano dentro.

## AR. LOW-POPULATION MATCHMAKING
Con 2 jugadores se emparejan (ventana abierta tras 90 s). Nunca bots en ranked (rival humano). Partida real QA en producción
emparejada en segundos con la cola vacía.

## AS. PVE
`mode='PVE'` → NOT_PVP, 0 asientos (ensayo); el PvE nunca llama a la liquidación (test F69 vigente).

## AT. PRIVATE MATCHES
`PVP_PRIVATE` → NOT_PVP (dos redes: servicio y SQL); sin rating, colocación ni Top (ensayo + QA producción).

## AU. BYE
No existe en duelos ranked (solo en el bracket táctico congelado). No hay rating por BYE.

## AV. NO_SHOW
No existe como estado: la partida nace en juego; quien no aparece juega con jugada automática del reloj (F72.8) y el resultado
se liquida normalmente. Sin farmeo posible (no se elige rival ni resultado).

## AW. ABANDON
Abandono en juego = derrota del que se va (liquidado, cuenta para colocación y récord). Antes de empezar no hay estado jugable.
Desconectarse no es abandono, pero el reloj juega y la partida se resuelve: no sirve para esquivar la pérdida.

## AX. DISPUTES
No hay sistema de disputas en duelos (resultado del motor en el servidor). Re-resolver es imposible: liquidar dos veces choca
contra el índice único; F84 no añade rutas de corrección de resultado.

## AY. RECONNECT
El movimiento se deriva del ASIENTO: F5 o reconexión → mismo resultado; nunca doble liquidación (ensayo + producción).

## AZ. MULTI-TAB
Mismo dato en todas las pestañas; la ceremonia se consume una vez por partida y navegador (`localStorage`), sin escritura al servidor.

## BA. REMATCH FARMING
Riesgo real medido: la misma pareja QA llegó a 26 partidas puntuadas en 24 h. Mitigación sin romper la población baja: **tope
de pareja** — la misma pareja intercambia rating como mucho 5 veces en 24 h; las siguientes se juegan y cuentan (récord,
colocación) con delta 0 (`rule = PAIR_CAP`, K 0). El Elo ya limita por sí solo la ganancia contra una cuenta sacrificada.

## BB. WIN TRADING
Mismo tope + emparejamiento automático (nadie elige rival) + Elo autolimitante. Dos cuentas pueden coincidir en cola; no pueden
fabricar más de 5 intercambios al día entre ellas. Sin antifraude ML (fuera de alcance).

## BC. SELF MATCH
Imposible en BD (`duel_matches_mode_shape`: `player_b_id <> user_id`), en la cola (dos filtros) y ahora también en la liquidación.

## BD. CLIENT SPOOFING
Ninguna ruta acepta ganador, delta, rango ni colocación; el competitivo no tiene POST (405); `?rating=9999` se ignora (QA
producción); la liquidación solo recibe un `matchId` y lee el resultado de la fila.

## BE. RLS
Récord, ajustes y fotos: lectura propia; temporadas: publicadas; libro y fichas: sin políticas (solo servidor); vistas solo
service_role. 0 privilegios de escritura/ejecución de cliente (apply-0065.log).

## BF. CROSS-ACCOUNT
Resultado de partida ajena → 404 (servicio + producción); perfil público sin datos privados; foto competitiva atada a la cuenta.

## BG. SECURITY
Funciones SECURITY DEFINER con `search_path` fijo, EXECUTE solo service_role (la interna del récord ni eso); guardia de
escritura del rating; libro inmutable; corrección solo por RPC auditada (motivo ≥ 10, ref única, |delta| ≤ 500), sin botón.

## BH. AUTH HYDRATION
`/competitivo` muestra el estado neutro mientras resuelve la sesión; nunca rango demo ni ajeno (test A1).

## BI. ACCOUNT SWITCH
Hallazgo corregido: la foto de `/competitivo` y la tarjeta ranked de `/duelos` no estaban atadas a la cuenta (un cambio de
cuenta sin recarga podía enseñar un instante el rango anterior). Ahora van atadas a la cuenta que las pidió y una respuesta
tardía de otra cuenta se descarta (patrón F81.2/F89).

## BJ. PERFORMANCE
Centro: 1 snapshot (lecturas acotadas en paralelo) + mazos + play-status, igual que F55. Plan de la clasificación en el ensayo:
índice `competitive_season_players_ladder_idx` + join por PK, 0,2 ms con datos reales.

## BK. DATABASE INDEXES
Nuevos: `competitive_season_players_ladder_idx (season_id, last_match_at) WHERE placement_completed_at IS NOT NULL`,
`competitive_season_players_user_idx`, `duel_pvp_rating_events_season_seq` (único), `competitive_rating_adjustments_*`. Se
reutilizan `duel_pvp_ratings_rating_idx` y `duel_pvp_rating_events_user_idx` (tope de pareja). Medido con EXPLAIN ANALYZE.

## BL. ADMIN
`/admin/competitive` gana: temporada competitiva (fechas, colocación, reglas del Top, tope de pareja, enlace F83), fronteras de
`rank-v1` (validadas), fórmula, distribución por rango, salud (Σ partidas de temporada = asientos con temporada). Solo lectura.

## BM. MANUAL CORRECTION
No existía mecanismo. Se deja `competitive_rating_correct` (auditada, ledgerizada, sin interfaz); ningún «set rating = X».

## BN. RANK CONFIG VALIDATION
`validateRankConfig`: primer suelo 0, suelos estrictamente crecientes, divisiones exactas (sin huecos ni solapes), solo la
élite sin divisiones, ids únicos, versión no vacía (test R3); el panel enseña los problemas si los hubiera (0).

## BO. 1440 QA · BP. 1024 QA · BQ. 390 QA
Arnés `/design-system/f84` (27 escenas: sin clasificar, colocación 4/5, bajo, medio, alto, Cumbre, fuera del Top, vacía,
nombre largo, tu zona, 10 resultados, clasificación, emblemas, leyenda, 3 perfiles): **162/162** en cada anchura (sin
desbordamiento, consola limpia, textos, h1 único, emblema accesible, CTA ≥ 44 px, nombres truncados, ceremonias). Producción
con sesión QA: `/competitivo` y perfil a 1440/1024/390 sin desbordamiento.

## BR. REDUCED MOTION
**38/38** por anchura: misma información, `data-animated=false`, sin fotogramas intermedios (`prefers-reduced-motion`).

## BS. ACCESSIBILITY
Rango nunca solo por color (forma + barras + nombre), `aria-label` en emblemas, `progressbar` con valores, h1 único, CTA único,
leyenda con `<summary>` enfocable, filas propias con `aria-current`.

## BT. MIGRATION
`0065_ranked_competitive.sql` (cabeza real previa 0064), aditiva. Aplicada **2026-10-04T17:33:41Z**, una transacción, 253 ms,
sha256 `ba718a2f…a857b3ca`, recuentos y huellas idénticos antes/después, privilegios de cliente 0, T2 DRAFT. Cabeza por
estado real en `release.ts`/`health.ts`/`migration-state.sh` (check «ranked»).

## BU. BACKUP
`/opt/nexus/backups/supabase-drlcards/pre-0065/20261004T173150Z` (COMPLETE + SHA256SUMS) con el script de la release de
producción y off-site forzado a «no configurado». No cierra F78.

## BV. MIGRATION REHEARSAL
Postgres desechable restaurado de ESE backup: **DRYRUN_OK 77/77** (`prod/dryrun-0065.log`): huellas de 21 tablas, histórico
sellado, privilegios/RLS, inmutabilidad y guardia, carreras A–D, lo que no puntúa, invariantes, vista y su plan, guardas de
temporada, corrección auditada, fin de temporada + fotos, reinicio suave, borrado en cascada, **rollback (la liquidación
vuelve byte a byte a la de producción, md5 `ae18598…`)** y re-aplicación idempotente.

## BW. REAL DATA SIMULATION
Escala anclada a los datos: en la simulación de primera temporada (≈ 40 partidas, colas pequeñas como la concurrencia real) σ ≈ 76–110 según población y dispersión de habilidad, como la real (75). Reparto típico: Cantera ~5 % · Promesa ~22 · Titular ~39 · Veterano ~25 · Capitán ~7 · Estrella ~1 · Cumbre ~0.

## BX. 50% WIN SIMULATION
50 %: P50 993–1001 → Titular II (61–67 % de los casos en Titular).

## BY. 55/60% SIMULATION
55 %: 1020 (20 partidas) → 1045 (200) · Veterano III. 60 %: 1042 → 1084 · Veterano II. 70 % × 200: Capitán II.

## BZ. LOSING SIMULATION
40 %: 951 (20) → 911 (200) · Promesa II; P10 a 200 partidas 842 (Cantera II).

## CA. LOW SAMPLE
20 partidas: dispersión ±60 alrededor de la media verdadera (K 40 al principio): el rango aún se mueve, como debe.

## CB. HIGH SAMPLE
200 partidas: correlación habilidad↔rating 0,93–0,95; reparto Cantera 19 % · Promesa 20 · Titular 19 · Veterano 19 · Capitán 14 ·
Estrella 6 · **Cumbre 1–3 % (≥ 71–79 % de victorias)**: difícil, por rendimiento.

## CC. EXPLOIT TESTS
Liquidación duplicada/concurrente, resultado repetido, partida ajena, contra uno mismo, privado, PvE, abandono en juego y antes
de empezar, sin culpable, partida inexistente, temporada terminada (asiento sin temporada), cierre/semilla concurrentes,
corrección sin motivo/repetida, UPDATE/DELETE del libro, UPDATE del rating (superusuario y service_role), temporada publicada
editada/cancelada/borrada, delta/rango del cliente: todos rechazados o neutros (ensayo + tests + producción).

## CD. PRODUCTION QA
`_f84-prod-qa.mts`: **61/61** — cabeza, temporada activa, rating = BD, estado coherente, clasificación = elegibles reales (0),
página acotada, perfil público/F89 sin datos privados, frontera histórica (UNSEASONED), cuenta ajena 404, privado, spoofing,
UI con sesión a 1440/1024/390, regresión de páginas/APIs, ficheros de economía/forja/sobres/sets/temporada idénticos a la
release anterior, T2 DRAFT, 0 ajustes/fotos. **Partida ranked real entre dos cuentas QA** (`477ffed2…`): emparejadas sin
bots, jugada por API, liquidada una vez, asientos `competitiva-1`/`ranked-rating-v1`, colocación 1/5 (rango oculto), récord =
número sellado, cadena intacta (885→879, 1089→1095).

## CE. PERSONAL ACCOUNT
Sin tocar: sin ficha de rating ni récord de temporada antes ni después (comprobado por consulta); los instrumentos abortan si la ven.

## CF. F76 REGRESSION
Cola: emparejamiento real OK; tras terminar, las dos cuentas vuelven a IDLE y `play-status` sin partida que retomar; tests F76 verdes.

## CG. F79 REGRESSION · CH. F80 REGRESSION
Ficheros de forja, economía, precios y sobres de la release activa = byte a byte los de la anterior; los seis precios
(2.500/6.000/12.000/20.000/35.000/60.000) presentes; `forge`/`crafting` 200.

## CI. F81 REGRESSION
Apertura e hidratación sin cambios (ningún fichero de F81 en el overlay; tests verdes).

## CJ. F82 REGRESSION
Sets/insignias/Sala de Trofeos sin cambios; `badges.ts` solo añade el formato `insignia:competitiva:*` (preparado, nada otorgado).

## CK. F83 REGRESSION
Temporada 2 · Asalto **DRAFT**; 0 XP de temporada; `season-track` 200; `/temporada` 200; ningún fichero de F83 tocado salvo pins.

## CL. F89 REGRESSION
Perfil: equipo favorito, vitrina, insignias, carrera, colecciones y privacidad intactos (tests F89 verdes); solo se integra el rango.

## CM. F78 EXCLUDED
Los 9 ficheros F78 del staging son los de producción (o ausentes en ambos); los nuevos de F78 no viajan. F78 sigue abierto.

## CN. MARKETPLACE · CO. PAYMENTS
`GLOBAL_MARKET_ENABLED=false`, `PAYMENTS_ENABLED=false` (production:check). Sin recompensas económicas por rango.

## CP. RELEASE BOUNDARY
Base `drl-0.1.1-1-22c509c6` (3.606) + overlay (54) = 3.617: **añadidos 11 + modificados 43 = overlay exacto**, 0 borrados
(`prod/stage-boundary.log`, `prod/overlay-files.txt`). Cada modificado era idéntico a producción antes de editarlo, así que su
diff es solo F84. Fuera: instrumentos `_f84-*`, docs.

## CQ. FULL TEST SUITE
`npm test`: **5916/5916** (5871 + 45 nuevas).

## CR. F84 TESTS
17 de dominio (`f84.ranked.test.ts`: fronteras, derivación, versión congelada, validación, colocación, semilla, pico, movimientos,
elegibilidad, fórmula, simulación de colocaciones), 16 de servicio (`f84.ranked.service.test.ts`: temporada activa, clasificación,
Top acotado, paginación, población 0, resultado desde el asiento, cuenta ajena, privado, perfil, contratos de fórmula literal /
exactamente una vez / spoofing / una sola fuente / F83 / sin economía), 11 de render (`f84.ranked.render.test.tsx`), 1 de
cabeza (ops). Pins de fases anteriores reescritos a su intención (cabeza 0065, escalera = clasificación de temporada,
colocación 5 por temporada, ceremonia de rango).

## CS. TYPES · CT. LINT · CU. BUILD
`typecheck` 0 errores; `eslint src` 0 errores y 0 avisos en ficheros de F84 (26 avisos preexistentes); build local y build de
la release en el VPS OK.

## CV. HEALTH · CW. READY
`/api/health` 200; `/api/ready` ready, cabeza `0065_ranked_competitive`, 12 checks en verde (nuevo «ranked»).

## CX. PRODUCTION SMOKE
§CD (61/61). `production:check --app --vps`: **27 PASS · 1 WARN (auth-email, F77) · 4 FAIL (F78 off-site:
NOT_CONFIGURED, drill, schedule, f78-offsite-dr)** — los mismos que en F83; no se maquillan.

## CY. LOGS
0 errores en `valorosters-app` desde el despliegue; Postgres sin errores nuevos.

## CZ. RELEASE
**`drl-0.1.1-1-50b3eb69`**, activa desde 2026-10-04 ~17:37Z.

## DA. ROLLBACK
Código: `bin/deploy.sh --activate drl-0.1.1-1-22c509c6` (compatible con 0065: no lee las tablas nuevas y la liquidación nueva
es compatible). BD, solo DESPUÉS del código: `docs/operations/rollback/0065_ranked_competitive.ROLLBACK.sql` (restaura la
liquidación exacta de 0035; pierde datos de temporada competitiva, conserva ratings y asientos).

## DB. COMMIT/PUSH
Ninguno.

## DC. REMAINING RISKS
1. **Población real casi nula** (10 con partidas, casi todas QA): las fronteras están ancladas en la distribución real y en la
   simulación; con jugadores reales conviene revisarlas al cerrar la Temporada competitiva 1 (sería `rank-v2` en la 2).
2. **Temporada competitiva 1 abierta**: no hay cierre programado; cerrarla (fijar `ends_at`, `competitive_season_close`,
   insignias de mejor rango y reinicio suave de la 2) es una decisión pendiente, idealmente ligada a la activación de la T2 de F83.
3. **Tope de pareja** (5/24 h): con dos amigos como únicos jugadores, la 6.ª partida del día no mueve rating (se explica en
   pantalla). Ajustable en la siguiente temporada.
4. La liquidación es la de siempre, eventual respecto al cierre de la partida (dos transacciones, red de seguridad por sondeo).
5. Las insignias competitivas y la foto de cierre están preparadas pero no se han ejercitado en producción (no hay temporada
   terminada); sí en el ensayo.
6. F78 (off-site) y F77 (verificación de correo) siguen abiertos y fuera de F84.

## DD. FINAL VERDICT
Definición de hecho 1–47 ✔ (40: T2 sigue DRAFT; 42: F78 excluido; 45: cuenta personal intacta; 46–47: sin commit ni push).

**F84 PRODUCTION = GO**
