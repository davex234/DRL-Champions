# F86 · TORNEOS DE JUGADORES («copas»)

**Release:** `drl-0.1.1-1-3c097efb` (activa desde 2026-10-05 ~13:33Z) · **Cabeza BD:** `0069_player_cups` (aplicada 2026-10-05T13:29:24Z) · **Rollback:** `bin/deploy.sh --activate drl-0.1.1-1-c2ccec7f` y, si hiciera falta, `docs/operations/rollback/0069_player_cups.ROLLBACK.sql`. Evidencia: `docs/product/qa/cups/`.

| | |
|---|---|
| Tests | **6027/6027** (5988 + 39 de F86) · tipos 0 · lint 0 errores (26 avisos = base) · build PASS |
| Ensayo 0069 (copia aislada del backup) | **DRYRUN_OK 104/104** (`qa/cups/dryrun-0069.txt`) |
| QA visual (arnés, 1440/1024/390 × normal/reducido) | **457/457** (`qa/cups/visual.json`) |
| QA de producción | **66/66** (4 comprobaciones corregidas en el instrumento, anotadas) · smoke **80/80** · production:check **27 PASS · 1 WARN (F77) · 4 FAIL (F78)** |
| Regresiones | F83 **40/40** · F84 **51/52** (ver DF) · F85 **91/92 → cabeza corregida** · F81.2 prod **72/72** |

## A. INITIAL PRODUCTION STATE
`drl-0.1.1-1-c2ccec7f`, cabeza `0068_public_account_tag`, 5988/5988, 40 cuentas, un admin (personal, #9KZAWPC), Temporada 2 en DRAFT, mercado y pagos OFF, F78 abierto, F77 aviso. F86 no existía (auditoría previa interrumpida, sin ficheros).

## B. EXISTING EVENT AUDIT
`tournaments`, `/torneos` y `/api/admin/tournaments` son la capa ESPORTS (VLR, Pick'ems, F30) → los torneos de jugadores van como **copas** (`cups`, `/copas`, `/admin/copas`; en la interfaz «Torneos»). Sin sistema de disputas, sin cron de partidas, sin notificaciones push: hay sondeo compartido (F64), auditoría append-only (F58), insignias F82 y admin `is_admin` (0067).

## C. EXISTING MATCH ENGINE AUDIT
`createPvpMatch` (dos jugadores ya decididos, mazos revalidados, id reservable), acciones con `state_version`, reloj F72.8 que juega por el ausente, abandono persistido (`closed_by`). `PVP_PRIVATE` no liquida rating (`isSettleable` + RPC), ni misiones (solo RANKED), ni XP F83. Puede empatar (reglas V2) → no hay sorteo posible.

## D. TOURNAMENT ARCHITECTURE
Dominio puro (`src/domain/cups/`: cuadro, siembra, ciclo de vida, validación) = especificación; 0069 la reproduce en SQL con RPC atómicas (cerrojo de la copa); servicio `server/services/cups.ts` (lecturas agregadas + trabajo perezoso); gancho `cupSettlement.ts` en `duelsPvp`; admin `server/admin/cups.ts` sobre `runAdmin`; UI `components/cups/*`.

## E. TOURNAMENT MODEL
`cups` (slug, nombre, descripción, reglas, formato, siembra, visibilidad PUBLIC/UNLISTED, estado, fechas de inscripción, inicio, ventana por ronda, mín/máx, contador, tamaño/rondas, versión, hitos, campeón) · `cup_registrations` (PK cupo+usuario, seed y foto de rating, colocación) · `cup_matches` (ronda, posición, A/B, lados vacíos, siguiente cruce/lado, estado, ganador, resolución, partida, «listo», ventana, marcador real).

## F. LIFECYCLE
Persistido: DRAFT → PUBLISHED → IN_PROGRESS → COMPLETED | CANCELLED. Derivado con la hora del servidor: SCHEDULED / REGISTRATION_OPEN / REGISTRATION_CLOSED. Sin cron.

## G. FORMAT
Eliminación directa 1 contra 1 (CHECK `format = 'SINGLE_ELIMINATION'`), extensible.

## H. REGISTRATION · I. UNREGISTER
`cup_register` (publicado, ventana abierta, no sancionado, con perfil, plazas) y `cup_withdraw` (solo con la inscripción abierta; la fila se conserva). Gratis. Producción: 20 clics simultáneos = 1 fila.

## J. CAPACITY · K. CAPACITY RACE
Máximo 64, mínimo 4. Cerrojo de la copa + CHECK `participant_count <= max`. Ensayo: **63 + 20 a la vez → 64** (1 REGISTERED, 19 FULL); forzar 65 → CHECK.

## L. ELIGIBILITY
Cuenta autenticada con perfil y sin sanción vigente; sin rango mínimo (arquitectura preparada).

## M. BRACKET MODEL
Todos los cruces de todas las rondas al generar; cada uno conoce su siguiente cruce y lado; lado «vacío» = resuelto sin jugador (BYE o doble no presentado).

## N. BRACKET GENERATION · O. BRACKET IDEMPOTENCY
`cup_generate` UNA vez (perezosa tras el cierre o por el admin). Ensayo: **20 a la vez → 1 GENERATED + 19 ALREADY, 63 cruces**; producción: 20 lecturas → 1 cuadro, 1 auditoría del sistema.

## P. SEEDING · Q. RATING SNAPSHOT · R. TIE SEEDING
Rating ranked F84 fotografiado en `seed_rating` (sin ranked = 1000); empate por `md5(copa:usuario)`, luego id. Cambiar el rating después no mueve el cuadro (ensayo). Colocación estándar: 1 y 2 solo en la final, 1–4 no antes de semifinales.

## S. BYES · T. NON-POWER-OF-TWO
Tamaño = potencia de 2 ≥ N; los BYES para los mejores seeds, avanzan sin partida (resolución BYE, sin estadística de combate). Ensayo SQL: 5→3, 6→2, 7→1, 10→6, 12→4, 20→12 BYES.

## U. BRACKET PROPERTY TESTS
11 pruebas de dominio: invariantes (una aparición, ≤2 por cruce, ganador participante, camino único, un campeón), **6.100 cuadros aleatorios** con retenciones y dobles no presentados.

## V–AF. SIMULACIONES 4 · 5 · 6 · 7 · 8 · 10 · 12 · 16 · 20 · 32 · 64
Dominio: los 11 tamaños jugados enteros (un campeón, n−1 eliminados, colocación por ronda). **SQL = dominio en los 61 tamaños 4–64** (ronda 1, seeds, campeón «gana el mejor seed», invariantes y colocaciones), ensayo.

## AG. MATCH CREATION · AH. MATCH AUTHORITY · AI. MATCH START
«Listo» de los dos con su equipo (`cup_ready`, caduca a los 30 s, la pantalla lo renueva cada 5 s); la BD reserva el id una vez y el servidor crea la partida con el motor canónico (`PVP_PRIVATE`). Nada nace antes de que los dos cruces de origen sean finales. Producción: A espera, B arranca, A otra vez → la MISMA partida; 1 partida por cruce (UNIQUE).

## AJ. RESULT · AK. RESULT FINALITY
Lo lee la BD del MOTOR (`status/winner`, o `closed_by` en abandono). FINAL = COMPLETED (motor) o resolución admin auditada; solo eso alimenta la ronda siguiente.

## AL. ADVANCEMENT · AM. PROPAGATION IDEMPOTENCY · AN. LOSER ELIMINATION
Un lado siguiente se escribe una vez (si ya estaba, aborta). Ensayo: **20 liquidaciones → 1 SETTLED + 19 ALREADY**; producción: 20 lecturas → cuadro idéntico. El perdedor conserva su inscripción con ronda y colocación.

## AO. DISPUTES · AP. DOWNSTREAM SAFETY
No existe sistema de disputas: un final no canónico (empate, sin resolver, cierre por tiempo) queda **ACTION_REQUIRED** y nadie avanza hasta la resolución admin. El cruce siguiente no puede empezar sin sus dos jugadores finales (ensayo y servicio).

## AQ. ABANDON · AR. NO_SHOW · AS. DEADLINES
Abandono = gana quien se queda (producción ×3). Plazo vencido sin partida → «Plazo vencido · en revisión»; «listo» rechaza (DEADLINE_PASSED); jamás un ganador por tiempo o sorteo.

## AT. ADMIN RESOLUTION
A / B avanza (confirmando su **#TAG exacto**, sin distinguir mayúsculas) o «ELIMINAR A LOS DOS» (el que espere aguas abajo pasa por BYE administrativo). Motivo obligatorio, auditado con tags. Ensayo + servicio; producción: torneo terminado → 409.

## AU. FINAL · AV. CHAMPION · AW. CHAMPION RACE
Final → COMPLETED, campeón derivado del cuadro. Ensayo: **20 liquidaciones de la final → 1 campeón, 1 trofeo**.

## AX. TROPHY · AY. TROPHY IDEMPOTENCY
`insignia:torneo:<slug>` en `user_cosmetics` (F82), con `source = cup:<id>`; nuevo tipo `TOURNAMENT` («Campeón · torneo», «Torneo · fecha»). Índice de dueño único: otra cuenta no puede tener ese trofeo.

## AZ. TOURNAMENT HISTORY
Archivo de finalizados paginado y «Tu historial» (participaciones, títulos, mejor resultado) en `/copas`.

## BA. PROFILE F89
Por el baseline actualizado: **ninguna integración** en la tarjeta de identidad (contrato F86-C8). El perfil propio ya enlaza con la Sala de Trofeos.

## BB. TROPHY ROOM
El trofeo aparece en la Sala de Trofeos del campeón (producción) y se puede destacar como cualquier insignia; no cuenta como insignia de colección.

## BC. TOURNAMENT HUB · BD. TOURNAMENT DETAIL · BE. MY TOURNAMENTS · BF. UPCOMING MATCH
Hub: «Tu partida está lista» primero, Mis torneos, En inscripción, Próximos, En curso, Finalizados. Ficha: cabecera de evento (nombre, estado, cuenta atrás, participantes, formato, premio, acción), mi partida, campeón, cuadro, horario, reglas, participantes. Indicador «Torneos» en el menú (sondeo compartido, 60 s).

## BG. BRACKET DESKTOP · BH. TABLET · BI. MOBILE · BJ. CURRENT PLAYER HIGHLIGHT
≥1024: árbol por columnas con conectores, desplazable dentro de su región (64 = 6 columnas). Móvil: pestañas por ronda + lista legible. «Ver mi partida» enfoca TU cruce (verificado en las 6 pasadas).

## BK–BQ. ADMIN · CREATE · VALIDATION · PUBLISH · CANCEL · AUDIT LOG · PUBLISHED IMMUTABILITY
`/admin/copas` sobre `runAdmin` (`is_admin`, sin roles nuevos). Borrador con vista previa (validación de fechas, mín/máx, máximo soportado, ventana imposible, nombre, reglas); publicar con versión; publicado = solo texto (guardia en BD `CUP_LOCKED`); cancelar con motivo (en curso: escribir el identificador); nada publicado se borra. Auditoría: creación, edición, publicación, cuadro, retenciones, resoluciones, cancelación, finalización.

## BR. RLS · BS. IDOR · BT. CLIENT SPOOFING · BU. DB CONSTRAINTS
RLS sin políticas y sin privilegios de cliente; RPC solo service_role; guardias para cualquier rol (ni service_role escribe un ganador o un seed). Cuerpo con lista blanca (`winner`/`seed`/`userId` → 400). Inscribir a otro, jugar un cruce ajeno, liquidar, avanzar, coronar o leer un borrador: rechazado (ensayo, servicio y producción).

## BV. AUTH HYDRATION · BW. ACCOUNT SWITCH · BX. MULTI-TAB
La foto va atada a la cuenta que la pidió; al cambiar de sesión se descarta. Producción 390: B → C sin marcar nunca a B como «tú». Relectura cada 20 s, al volver a la pestaña y tras acciones propias.

## BY. PERFORMANCE · BZ. DATABASE INDEXES · CA. QUERY PLANS
Ficha = 4–5 consultas fijas (64 inscritos, 63 cruces). Índices: único (cup, ronda, posición), partidas vivas por jugador, activas por copa, archivo. Cuadro de 64: 0,5 ms; «mi cruce»: Bitmap Index Scan.

## CB–CE. F84 RATING · PLACEMENT · TOP500 · PAIR LIMIT ISOLATION
Producción: rating de los 4 jugadores idéntico y **0 eventos de rating** nuevos tras 3 partidas → sin colocación, Top 500, récord competitivo ni consumo del tope de parejas.

## CF. F83 XP ISOLATION · CG. F73 MISSION ISOLATION · CH. F85 SOCIAL ISOLATION
Sin XP de temporada (ganchos solo ranked), **0 misiones** contadas, **0 amistades** creadas; el cara a cara y los «duelos privados recientes» excluyen los cruces; el resultado no ofrece revancha.

## CI. SECURITY HARNESS · CJ. CONCURRENCY HARNESS
Ensayo 104/104 (guardias, privilegios, carreras 20× de inscripción, generación, reserva, liquidación y final) + servicio 12/12 + contratos 16/16.

## CK. VISUAL QA 1440 · CL. 1024 · CM. 390 · CN. REDUCED MOTION · CO. ACCESSIBILITY
457/457: sin desbordamiento, h1 único, táctil ≥44 px, árbol/pestañas según ancho, cada cruce con nombre accesible y estado en texto, campeón quieto con movimiento reducido, consola limpia.

## CP. EMPTY STATES · CQ. ERROR STATES
«No hay torneos abiertos ahora» sin inventar. Completo, cerrado, ya inscrito, aún no se puede jugar, rival por decidir, plazo vencido, cancelado: textos claros.

## CR. MIGRATION · CS. BACKUP · CT. MIGRATION REHEARSAL
0069 aditiva, una transacción, 304 ms, 0 filas existentes cambiadas. Backup `pre-0069/20261005T132903Z` (`BACKUP_OK`; off-site NO configurado). Ensayo 104/104 con rollback (trofeos y partidas conservados) y reaplicación.

## CU. PRODUCTION QA
66/66: torneo QA **no listado** de 4 cuentas QA jugado entero con el motor (abandonos), campeón QA D con su trofeo; segundo torneo QA cancelado. A fue admin temporal (operador, auditado) y se retiró. Las ventanas de ronda del torneo QA se adelantaron por SQL de operador (solo QA). Restos: `qa-f86-muvaj6mq` (COMPLETED) y `…-c` (CANCELLED), no listados (un torneo publicado no se borra por diseño).

## CV. PERSONAL ACCOUNT
**#9KZAWPC**, admin, 0 inscripciones, 0 cruces, 0 trofeos de torneo, rating/créditos/XP iguales. No se usó.

## CW–DC. F76 · F79 · F80 · F81 · F81.2 · F82 · F83
Smoke 80/80 (cola, competitivo, tienda, sobres, perfiles…). Precios, forja, sobres, tienda y temporada **byte a byte** iguales a F83. F81.2 prod 72/72. Sala de Trofeos 200 para no campeones. F83 40/40.

## DA. F81.2 HARNESS
Las 3 filas históricas eran del instrumento de PRODUCCIÓN: la cuenta QA G no tiene sobres, así que su «real» en `/abrir/estandar` es el aviso «No tienes este sobre», no la ceremonia. Aserción corregida (el «real» sale del inventario real); app sin cambios. Local 9/9 ×2, prod 72/72.

## DD. F83 HARNESS · DF. F84 HARNESS
Ambos fijaban su migración como cabeza: ahora exigen «≥ su migración + su check en verde». F83 40/40. F84 51/52: la cabeza pasa; queda una guardia distinta («ficheros idénticos a la release de F83») que falla solo porque F86 cambió a propósito `collectionSets.ts` (trofeos en la Sala); los 7 ficheros de economía/forja/sobres/tienda/temporada son idénticos. No se ha tocado. El instrumento F85 tenía el mismo pin de cabeza: corregido (91/92 → PASS en la repetición, que se paró en el límite anti-spam de retos de F85 por la pasada anterior; lo social se limpió).

## DE. F84 REGRESSION · DG. F85 REGRESSION · DH. F89 REGRESSION
F84 51/52 (arriba). F85 91/92 (solo el pin). Perfil intacto (tests y contrato F86-C8).

## DI. SEASON 2 STATUS · DJ. LEGACY PASS · DK. F77 STATUS · DL. F78 EXCLUDED
Temporada 2 **DRAFT**. Pase heredado sin cambios. F77: el aviso de siempre. F78 abierto (4 FAIL off-site); sus 9 ficheros = producción.

## DM. MARKETPLACE · DN. PAYMENTS
OFF / OFF.

## DO. RELEASE BOUNDARY
Base `c2ccec7f` + overlay: **27 añadidos + 32 modificados, 0 borrados**, `BOUNDARY_OK`; los instrumentos `_` de QA no viajan.

## DP. FULL TEST SUITE · DQ. F86 TESTS · DR. TYPES · DS. LINT · DT. BUILD
6027/6027 · 39 de F86 · 0 · 0 errores / 26 avisos · PASS (local y en el VPS).

## DU. HEALTH · DV. READY · DW. PRODUCTION SMOKE · DX. LOGS
200 · ready, cabeza 0069, check «cups» en verde · 80/80 · 0 errores desde el despliegue; logs estructurados `cups.*`. Un «connection reset» puntual del túnel a las 13:45:24Z (telemetría) coincidió con una pasada de F81.2 (repetida: 72/72).

## DY. RELEASE · DZ. ROLLBACK
`drl-0.1.1-1-3c097efb` · `--activate drl-0.1.1-1-c2ccec7f`; BD con el ROLLBACK de 0069 (quita torneos, conserva trofeos y partidas).

## EA. COMMIT/PUSH
Ninguno.

## EB. FIRST REAL TOURNAMENT READINESS
**«Valorosters Open #1»** creado como **BORRADOR** (no publicado, invisible): inscripción 19→24 oct, inicio 24 oct 18:00Z, rondas de 1 día, mín 8, máx 64. Publicarlo (o cambiar fechas) es decisión tuya desde `/admin/copas`.

## EC. REMAINING RISKS
1. Los dos jugadores tienen que estar a la vez en la pantalla para empezar (sin calendario de hora exacta); si no coinciden dentro del plazo, decide un admin.
2. Sin notificación instantánea: indicador del menú cada 60 s y relectura cada 20 s.
3. Empates exactos y cierres por tiempo requieren a un admin (ACTION_REQUIRED).
4. La foto de perfil heredada (API, no visible en la tarjeta) sigue contando cruces de torneo como duelos privados en la «carrera».
5. F84 instrumento: guardia de ficheros congelados con collectionSets.ts cambiado (DF).
6. F78 (DR off-site) abierto; F77 aviso.

## ED. FINAL VERDICT
Modelo, ciclo de vida, cuadro 4–64 con BYEs, inscripción exactamente-una-vez, carreras, siembra, partida canónica única, resultado del servidor, avance y campeón exactamente-una-vez, trofeo F82, admin auditado, aislamiento y QA en tres anchos: cumplidos con evidencia en ensayo, servicio y producción.

F86 PRODUCTION = GO
