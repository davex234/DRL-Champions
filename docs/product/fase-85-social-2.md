# F85 — SOCIAL 2.0 · Amigos, presencia y retos entre jugadores

**Release:** `drl-0.1.1-1-b7472c2b` (activa desde 2026-10-05 08:28Z) · **Cabeza BD:** `0066_social_2` · **Rollback de código:** `bin/deploy.sh --activate drl-0.1.1-1-6a923c24`

F85 se hizo en tres sesiones. Las dos primeras (2026-10-04) auditaron, construyeron, ensayaron, aplicaron 0066 y
desplegaron tres releases (`71c9e802`, `0f38d421`, `6a923c24`); la segunda se cortó justo después del último despliegue,
**sin verificar** la release y con la última QA de navegador en producción en **16/22** (aceptar un reto no entraba en la
partida). Esta tercera sesión (2026-10-05) auditó producción antes de tocar nada, encontró y corrigió tres defectos reales,
desplegó dos releases más (`931c073d`, `b7472c2b`) y cerró la verificación completa. Evidencia: `docs/product/qa/f85-social/`
(local) y `docs/product/qa/f85-social/prod/` (producción; la pasada fallida anterior se conserva en `prod/pre-931c073d/`).

---

## A. INITIAL PRODUCTION STATE
Medido el 2026-10-05 antes de editar: **producción ya NO estaba en el estado del brief** (`50b3eb69` / `0065`). Estaba en
`drl-0.1.1-1-6a923c24` con `0066_social_2` aplicada (`/api/ready` ready, check «social» en verde). Se trabajó sobre ese estado
real, sin revertir nada. Huella de la fuente desplegada contra el árbol local: **idéntica en `src/` y `supabase/`** salvo
los ficheros de F78 (`src/domain/ops/backup*.ts`, scripts off-site), que solo existen en local.
Temporada 2 · Asalto: DRAFT. `GLOBAL_MARKET_ENABLED=false`, `PAYMENTS_ENABLED=false`. Suite conocida 5916 → real 5944 (F85
añadió tests).

## B. EXISTING SOCIAL AUDIT
F85 **no creó un segundo sistema social**: extiende el de F29 (0048).
- Ya existía: `duel_friendships` (par canónico `user_lo < user_hi`, una fila por pareja, estados PENDING/ACCEPTED/DECLINED/BLOCKED),
  `duel_challenges` (reto con `match_id` reservado una vez), `profiles.last_seen_at` (latido), `/api/game/social`
  (`services/social.ts`, `domain/social`, `lib/social/client.ts`), hub `/social`, `PrivateDuelPanel` (revancha) y
  `getPrivateMatchInfo` (cara a cara).
- Identidad pública: `/jugador/[id]` (F31/F56/F89) con proyección pública en servidor; avatar emoji del perfil; equipo
  favorito F89 (`hintTeamLogoSrc`); rango F84 derivado (`domain/ranked`). Ninguno se duplicó.
- No existía: seguidores, feed, chat, sistema universal de notificaciones, sistema de reportes ni métricas técnicas. No se crearon.
- Defectos de F29 que F85 corrige: bloqueo como estado de la fila de amistad (el segundo bloqueo pisaba al primero y desbloquear
  borraba el ajeno); reto de 24 h; presencia con «activo recientemente» (30 min) sin semántica clara; sin límites; búsqueda que
  borraba `_`; sin aviso global de retos; badge que contaba retos MATCHED de partidas terminadas.

## C. EXISTING DUEL/PRIVATE MATCH AUDIT
Duelo privado = `duel_matches.mode = 'PVP_PRIVATE'` sobre el mismo motor, arena, sondeo y reconexión que el ranked.
Doble red de no-liquidación: `isSettleable` (`services/duelsPvp.ts:370`) exige `mode === "PVP"` y el RPC
`duel_pvp_settle_match` responde `NOT_PVP`. Misiones F73 y XP F83 cuelgan de la liquidación (`settlePvpMissions` → `missionEngine`
→ `seasonTrack.ingestSeasonEvent`), así que un privado no las toca. `_duel_pvp_has_active_match` cuenta privadas: en duelo
privado no se entra en cola ranked. Todo se conserva.

## D. ARCHITECTURE
- **BD (0066):** RPC `SECURITY DEFINER` atómicas con cerrojo consultivo por pareja (orden fijo), EXECUTE solo `service_role`.
- **Servidor:** `src/server/services/social.ts` (foto agregada, pulso, búsqueda, perfil social, comparar, mutaciones vía RPC);
  ruta `/api/game/social` (GET por parámetro, POST por acción, `userId` siempre del token, `no-store`, cubetas de rate limit).
- **Dominio puro:** `src/domain/social/social.ts` (relación, presencia, límites espejo de 0066, TTL, bandeja, búsqueda).
- **Cliente:** pulso compartido (`createSharedPoll`, F64) montado por el armazón en toda la app; `SocialLive` (aviso global de
  reto y estado del reto enviado); `BroadcastChannel` para converger pestañas.
- **UI:** `/social` (Amigos · Solicitudes · Buscar · Retos · Recientes), `/social/comparar`, acciones sociales en `/jugador/[id]`,
  `PrivateDuelPanel` en el resultado del duelo amistoso.
- Base para F87 (clubs/parties): par canónico + bloqueo por dirección + RPC con cerrojo de pareja + pulso compartido. No se
  construyó nada de clubs/parties/feed.

## E. DATABASE MODEL
`duel_friendships` (existente, una fila por pareja canónica) · `social_blocks` (nueva: `blocker_id`, `blocked_id`, PK compuesta,
CHECK no-self, índice por bloqueado, RLS «solo leo mis bloqueos») · `duel_challenges` (existente + índice único «un PENDING por
pareja en cualquier sentido» + índice de recientes por pareja) · `profiles.last_seen_at` (existente) · `duel_matches` /
`duel_pvp_queue` (existentes, solo lectura para presencia).

## F. MIGRATION
`supabase/migrations/0066_social_2.sql` (aditiva, re-ejecutable). Aplicada **2026-10-04T20:48:48Z**, una transacción, 195 ms,
como `postgres`, sin registrar en `schema_migrations` (como 0026–0065). Huellas antes = después (`DATOS_INTACTOS`: 40 usuarios,
5 amistades, 101 retos, 307 partidas, md5 de ratings, liquidaciones, partida activa, economía y T2=DRAFT idénticos).
Concesiones de cliente: EXECUTE 0, escritura 0, anon no lee bloqueos. Pins «última migración» actualizados a 0066.

## G. FRIENDSHIP MODEL
Relación derivada (`relationFor`): `NONE · OUTGOING · INCOMING · FRIENDS · BLOCKED_BY_ME · BLOCKED_ME · SELF` (≡ NONE /
OUTGOING_PENDING / INCOMING_PENDING / FRIENDS / BLOCKED del brief). Un bloqueo manda sobre cualquier fila.

## H. CANONICAL PAIRS
Una fila por pareja: PK `(user_lo, user_hi)` con `lo < hi`. Imposible «A→B friends + B→A pending». Self imposible en BD
(`social_blocks` CHECK) y en todas las RPC (`SELF`).

## I. FRIEND REQUEST
`social_friend_request`: bajo cerrojo de pareja; idempotente (`ALREADY_PENDING`). 20 a la vez en BD → 1 REQUESTED + 19
ALREADY_PENDING, una fila; ×10 por HTTP en producción → una fila PENDING.

## J. CROSS REQUEST
Si B ya pidió a A, la solicitud de A **convierte en amistad** (código `ACCEPTED`) si ninguno está en el tope. C→D y D→C ×10
a la vez → UNA amistad ACCEPTED (BD); A→C ‖ C→A en producción → UNA amistad.

## K. ACCEPT
Solo el destinatario (`NOT_TARGET` si no). 20 aceptaciones simultáneas → 1 ACCEPTED + 19 NO_REQUEST, una amistad (BD);
×5 en producción → 1 ACCEPTED, resto 409.

## L. DECLINE
`DECLINED`; se puede volver a pedir después (re-add probado).

## M. CANCEL
El solicitante retira con `unfriend` sobre su PENDING. Aceptar ‖ retirar a la vez → un único resultado coherente.

## N. REMOVE FRIEND
`social_unfriend`: cualquiera de los dos; desaparece para ambos; cancela retos pendientes de la pareja. Partidas, historial,
ranked y perfil intactos.

## O. RE-ADD
Tras eliminar o rechazar se puede volver a pedir (salvo bloqueo). Probado en BD y producción.

## P. BLOCK
`social_block`: inserta MI bloqueo, borra amistad/solicitud y cancela retos pendientes de la pareja; una partida ya empezada
no se toca. Bloqueo mutuo = dos filas propias que no se pisan.

## Q. BLOCK PRIVACY
Respuesta neutra **idéntica en los dos sentidos**: `409 {"error":"Acción no disponible","code":"UNAVAILABLE"}`. El bloqueado:
no ve a quien le bloqueó en búsqueda ni en recientes, `?player=` y `?compare=` dan 404 como un id inventado, su foto no lleva
`blocked_by`, RLS le devuelve 0 filas de `social_blocks`.

## R. UNBLOCK
Solo MI bloqueo (`NOT_BLOCKED` si no existe; un tercero → 409). No restaura la amistad: queda NONE.
**Política de perfil público (§15):** bloquear impide la interacción directa pero NO oculta lo que ya es público (el perfil F89
de A sigue visible para C por `/jugador/[id]`; verificado en producción). No se construyó privacidad total.

## S. FRIEND LIMIT
**300** amigos por jugador (BD, comprobado en solicitar, cruzar y aceptar bajo cerrojo). Frontera en BD: 299 → pide y acepta (300);
300 → `FRIEND_LIMIT`; con 300, una solicitud entrante queda pendiente pero aceptarla choca.

## T. REQUEST RATE LIMIT
**50** solicitudes salientes pendientes (la 51.ª → `PENDING_LIMIT`) + cubeta HTTP `social_write` 30/min por usuario.

## U. PLAYER SEARCH
`GET ?q=`: prefijo de `username`, sin mayúsculas, ≥ 2 caracteres, ≤ 32, 10 por página, como mucho 5 páginas (offset ≤ 40),
debounce 300 ms en el cliente. `_` es literal (antes se borraba y «qa_camp» no encontraba a nadie: corregido en `0f38d421`).

## V. SEARCH PRIVACY
Solo identidad pública (nombre, avatar, equipo favorito si es público, rango F84, relación). Sin correo (`@` → 400), sin
UUID como consulta, sin metadatos, sin `last_seen_at`; presencia solo de amigos; excluye al propio buscador, a quien me bloqueó y
a cuentas con ban/suspensión vigente.

## W. SEARCH PERFORMANCE
p50 208 ms / p90 262 ms extremo a extremo. Paginación en servidor; nunca se descarga la lista de jugadores. Lecturas auxiliares
por lote (`.in()`). Índice existente `profiles_username_lower_idx (lower(username) text_pattern_ops)`; la consulta usa `ilike`
de PostgREST, que no lo aprovecha — irrelevante con 40 perfiles (deuda DL-4).

## X. SOCIAL HUB
`/social` con cinco pestañas (Amigos · Solicitudes · Buscar jugadores · Retos · Jugadores recientes), resumen (amigos, en línea,
solicitudes, retos), `?tab=` y `?aceptar=`. UNA lectura agregada al entrar (`GET /api/game/social`) + el pulso.

## Y. FRIEND LIST
Avatar, nombre, rango F84, presencia con palabra, RETAR · COMPARAR · menú (perfil, eliminar, bloquear). Orden EN PARTIDA → EN COLA
→ EN LÍNEA → DESCONECTADO → nombre. Primera página (100) en la foto; «Ver más» pagina en servidor.

## Z. REQUESTS UI
Recibidas (ACEPTAR / RECHAZAR), enviadas (RETIRAR) y bloqueados (DESBLOQUEAR), con rango del jugador.

## AA. RECENT PLAYERS
Derivados de `duel_matches` reales del usuario (sin tabla nueva): rivales únicos por partida más reciente, con recuento; acción
según relación (VER PERFIL, AÑADIR AMIGO o RETAR). Verificado en producción: solo partidas donde el usuario participó, sin
duplicados, quien me bloqueó no aparece.

## AB. PRESENCE MODEL
`IN_MATCH · IN_QUEUE · ONLINE · OFFLINE` («En partida», «En cola ranked», «En línea», «Desconectado»). Sin AWAY/DND/INVISIBLE,
sin «visto hace…».

## AC. ONLINE SEMANTICS
**EN LÍNEA = último latido hace < 2 min.** El latido sale del pulso de cualquier pestaña VISIBLE de la app (no solo `/social`).
No se deriva de «hizo una petición hoy».

## AD. HEARTBEAT
Pulso `POST pulse` cada **20 s** con la pestaña visible (y al volver a ella / tras una acción). Escribe `last_seen_at` solo si el
anterior tiene **≥ 40 s** (UPDATE condicionado en servidor): como mucho ~1 escritura por minuto por jugador aunque tenga varias
pestañas. **Cambio de esta sesión:** antes era 45 s / 20 s; la entrega real de un reto medida en producción fue **41,7 s** —
demasiado para un reto de 5 min —; ahora **16,8–17 s** medidos en producción con dos navegadores.

## AE. TTL
Sin cierre de sesión limpio: a los 2 min sin latido, DESCONECTADO (derivado al leer, sin barrido ni marcas). Probado en
producción (`--ttl`): sin latido > 2 min → OFFLINE. Latido más viejo de una pestaña viva = 40 s + 20 s = 60 s < TTL.

## AF. MULTI-TAB PRESENCE
Una sola marca por usuario (`last_seen_at`): cerrar una pestaña no desconecta mientras otra late. Dos sesiones latiendo seguidas
→ UNA escritura (producción).

## AG. MULTI-DEVICE PRESENCE
Igual que multi-pestaña (la marca es por usuario, no por sesión): cerrar el móvil no desconecta el PC. Probado con dos
sesiones independientes de la misma cuenta.

## AH. IN_MATCH
Derivado en servidor de `duel_matches` (PVP/PVP_PRIVATE en WAITING/IN_PROGRESS sin `closed_reason`); no depende del latido. El
cliente no puede declararse en partida (`pulse` con `presence=IN_MATCH` se ignora).

## AI. IN_QUEUE
Derivado de `duel_pvp_queue` (QUEUED/PAIRING sin caducar, la definición F76) **y** latido fresco (una entrada de cola dura 10 min
aunque se cierre la pestaña: sin latido no se afirma que siga buscando). Sin booleano mutable.

## AJ. PRESENCE PRIVACY
Solo amigos ven presencia. Desconocido, búsqueda y perfil público → `presence: null`. Sin hora exacta.

## AK. CHALLENGE MODEL
Reto = `duel_challenges` (retador, retado, mazo del retador, `previous_match_id` para revancha, `expires_at`). Solo entre amigos.
Siempre DUELO AMISTOSO `PVP_PRIVATE`.

## AL. CHALLENGE LIFECYCLE
`PENDING → ACCEPTED (match_id reservado) → MATCHED (partida creada)` · `DECLINED` · `CANCELLED` · `EXPIRED`. Un ACCEPTED cuya
partida no nace en 2 min se cancela perezosamente (nunca «aceptado sin partida»).

## AM. CHALLENGE TTL
**5 minutos** por reloj de la BD (`now()`), evaluado al leer y al aceptar. Antes de caducar: PENDING; exactamente en `expires_at`:
caducado; después: `EXPIRED`. El reloj del navegador solo pinta la cuenta atrás.

## AN. CHALLENGE RATE LIMIT
Un reto pendiente por pareja (índice único, en cualquier sentido); **10 retos por pareja (sentido) y hora** (el 11.º →
`CHALLENGE_LIMIT`, 429 en producción mientras el sentido contrario sigue pudiendo); cubeta HTTP `social_write`.

## AO. CHALLENGE ACCEPT
Solo el retado (un tercero → 404 sin revelar existencia). Bajo cerrojo de pareja + fila, la RPC re-comprueba con la hora de la BD:
caducidad, amistad, bloqueo, partida activa/reserva de cualquiera de los dos y cola ranked. Mazo obligatorio y revalidado.

## AP. MATCH CREATION
La RPC reserva `match_id` UNA vez; el servidor crea la partida `PVP_PRIVATE` (retador = A, retado = B) con `createPvpMatch` y
marca MATCHED. Verificado en producción: participantes exactos, modo privado.

## AQ. ACCEPT RACE
20 aceptaciones simultáneas (BD) → 1 ACCEPTED + 19 ALREADY_ACCEPTED con el MISMO `match_id`; ×5 en producción → una partida.

## AR. CANCEL/ACCEPT RACE
Cancelar ‖ aceptar (×3, BD) → nunca «cancelado + partida»: un único resultado.

## AS. EXPIRE/ACCEPT RACE
Decide la BD: aceptar tras `expires_at` → `EXPIRED` y la fila queda EXPIRED, sin partida (BD y producción).

## AT. BLOCK/ACCEPT RACE
Bloquear ‖ aceptar → coherente (bloqueado y reto cancelado, o partida ya reservada que termina por su ciclo). Tras el bloqueo,
el reto no se puede aceptar (`UNAVAILABLE`). Dejar de ser amigos ‖ aceptar → coherente; unfriend cancela el pendiente (§100).

## AU. ACTIVE MATCH CONFLICT
Crear o aceptar con una partida viva (o reserva) de cualquiera de los dos → `409 BUSY`. Aceptar a la vez los retos de dos amigos
→ 1 ACCEPTED + 1 BUSY (una partida).

## AV. RANKED QUEUE CONFLICT
Política: **no se acepta ni se crea un reto con la cola ranked viva** (`409 IN_QUEUE`, «sal de la cola»); la cola NO se cancela
en silencio (producción: tras el 409, la entrada sigue QUEUED). En duelo privado no se entra en cola (409).

## AW. DELIVERY
Sin infraestructura nueva (ni Realtime ni SSE): el pulso compartido de 20 s, relectura al volver a la pestaña, y 5 s mientras
espero respuesta a MI reto. Medido en producción: reto recibido sin recargar en **16,8 s**; retador dentro de la partida
**5,5 s** después de aceptar.

## AX. SOCIAL COUNTERS
`badge` del servidor = solicitudes recibidas + retos recibidos pendientes; en la navegación («Social · N»). Un mismo reto no genera
varios avisos (recordado por pestaña en `sessionStorage`).

## AY. CHALLENGE UX
Desde Amigos: RETAR → hoja con equipo legal preseleccionado → «Esperando respuesta…». El retado ve, en cualquier pantalla, una
tarjeta con avatar, nombre, rango F84, «Te reta a un duelo amistoso» (o «Te pide la revancha»), «Sin rating ni colocación»,
cuenta atrás, ACEPTAR / RECHAZAR. Retador: «¡X ha aceptado! Entrando en la partida…» (y entra), o «ha rechazado» / «ha caducado».

## AZ. REFRESH
Todo estado del reto vive en el servidor: F5 conserva retos, esperas y partida. **Bug corregido en esta sesión:** con el hub
abierto, `/social?aceptar=<reto>` marcaba el enlace como hecho con la foto ANTERIOR al reto y la hoja de aceptar no se abría
nunca (causa de los fallos «aceptar no entra en la partida» de la QA del 2026-10-04). Ahora solo se da por hecho cuando la foto
trae el reto (y si no, se relee una vez). Pin `D11`.

## BA. RECONNECT
El pulso devuelve `activeMatchId`: al volver, el jugador detecta su partida viva (producción). F5 en la partida → la MISMA
partida, sin crear otra.

## BB. REMATCH
REVANCHA en el resultado del duelo amistoso = **reto nuevo** con `previous_match_id` (debe pertenecer a los dos); mismas reglas y
TTL; uno pendiente por pareja (×4 → uno). **Bug corregido en esta sesión:** en la pantalla de resultado (ruta inmersiva) no se
montaba el aviso global, el retador no entraba solo y `/duelos/pvp` fijaba la partida al montar, así que aceptar la revancha
dejaba el resultado viejo. Ahora la arena PvP monta `SocialLive` (solo avisa de la revancha de la partida en pantalla, ya
terminada) y una partida NUEVA en `?match=` remonta la arena (`ArenaPorPartida`; quitar `?match=` no remonta). Producción:
revancha aceptada desde el resultado → los dos en la MISMA partida nueva, sin rastro del resultado anterior. Pin `R8`.

## BC. PROFILE F89
Acciones sociales en el perfil de OTRO jugador según estado: AÑADIR AMIGO · SOLICITUD ENVIADA · ACEPTAR · AMIGOS + RETAR +
COMPARAR; BLOQUEAR en menú contextual («…», `role="menu"`). Perfil propio: nunca añadirme/retarme. Rango F84 y Profile 2.0
intactos (verificado en producción con amigo, desconocido y propio).

## BD. COMPARE
`/social/comparar?id=` lado a lado con SOLO datos públicos reales: rango F84, rating (ya público), nivel de temporada, partidas
y % de victorias públicos, cartas únicas/totales, colecciones completadas e insignias. **Sin puntuación compuesta ni «quién es
mejor»** (pin + verificado en producción). No expone inventario. Consigo mismo 400; con quien me bloqueó 404.

## BE. PRIVATE MATCH ISOLATION
Partida amistosa jugada ENTERA en producción (dos veces): `PVP_PRIVATE`, participantes exactos, resultado sin rating ni rango.
En BD: 108 partidas privadas en total y **0** eventos de rating ligados a ellas.

## BF. F84 RATING ISOLATION
0 asientos de rating para la partida; ratings de A y B intactos (antes = después). `duel_pvp_settle_match` → `NOT_PVP`.

## BG. F84 PLACEMENT ISOLATION
Colocación/récord de temporada competitiva intactos (2:2 antes = después).

## BH. F84 TOP-500 ISOLATION
Sin récord nuevo en `competitive_season_players` → la elegibilidad Top no cambia.

## BI. F83 XP ISOLATION
0 XP de temporada por la partida; `season_xp_ledger` = 0 filas en producción (T2 sigue en DRAFT). Regla real preservada.

## BJ. F73 MISSION ISOLATION
0 eventos de misión por la partida (las misiones cuelgan de la liquidación, que no corre para privadas). Créditos y XP de cuenta
de A y B intactos.

## BK. RLS
`social_blocks`: el bloqueador lee la suya, el bloqueado 0 filas. `duel_friendships` / `duel_challenges`: sin políticas de cliente
(403 con token de jugador; solo servidor). RPC `social_*` directas con token de jugador → denegadas (solo `service_role`). Grafo
de amistades privado: no hay lista pública ni contador público (§86–87).

## BL. IDOR
Producción: K acepta solicitud A→B → 409 sin efecto; K elimina amistad A↔B → 409; K acepta reto A→B → 404; K cancela reto ajeno
→ 409; K desbloquea en nombre de A → 409; el retador no acepta su propio reto; `?match=` solo para sus dos jugadores (K → 404);
revancha con partida ajena → 404.

## BM. CLIENT SPOOFING
El cuerpo solo lleva ids; `userId` siempre del token. Campos `userId`/bando falsos se ignoran; no hay forma de fijar relación,
remitente, partida, participantes, presencia EN PARTIDA ni bloqueo ajeno (pin `I2` + producción).

## BN. DB CONSTRAINTS
PK de pareja canónica; `social_blocks` PK + CHECK no-self; índice único de PENDING por pareja (en cualquier sentido) y el de 0048
por sentido; `match_id` reservado una vez bajo cerrojo; invariantes comprobadas en el ensayo: nunca dos pendientes por pareja,
ACCEPTED/MATCHED siempre con `match_id`, ninguna amistad con bloqueo vigente.

## BO. TRANSACTIONS
Toda transición en UNA RPC `plpgsql` (cruzada, aceptar, bloquear, aceptar reto + reserva) con `pg_advisory_xact_lock` de los dos
usuarios en orden fijo + `FOR UPDATE` de la fila. La creación de la partida va en una segunda transacción protegida por la
reserva de 2 min y la caducidad perezosa.

## BP. AUTH HYDRATION
Foto social atada a la cuenta que la pidió (patrón F81.2/F89): respuesta tardía de otra cuenta descartada; el pulso compartido
va por clave de usuario. F81.2 regresión en producción: **69/72, idéntico a su propia QA original** (las 3 filas de
`/abrir/estandar` fallan igual desde el 2026-10-02: la cuenta QA G no tiene sobres estándar).

## BQ. ACCOUNT SWITCH
Producción (navegador): logout A → login K → `/social` sin un fotograma de amigos ni retos de A.

## BR. MULTI-TAB STATE
Una acción anuncia el cambio (`BroadcastChannel` + evento): las demás pestañas releen el pulso y, si su `version` cambia, el hub
(aceptar en una pestaña aparece en la otra; un bloqueo quita RETAR). Otros dispositivos convergen por el pulso (≤ 20 s).

## BS. PERFORMANCE
Producción, p50/p90 extremo a extremo (incluye Cloudflare): foto `/social` 227/356 ms (23,5 KB), pulso 207/223 ms (110 B),
búsqueda 208/262 ms, página de amigos 210/243 ms, perfil social 236/324 ms, comparar 382/463 ms. `/social` al cargar = 1 lectura
agregada + el pulso (que el armazón ya hace en toda la app).

## BT. DATABASE INDEXES
Existentes y usados: `duel_friendships_{lo,hi}_idx (user_*, status)`, PK de pareja; `duel_challenges_{challenger,challenged}_idx`,
`duel_challenges_match_idx`. Nuevos (0066): `duel_challenges_pending_pair_uniq`, `duel_challenges_pair_recent_idx`,
`social_blocks_blocked_idx`. Presencia: PK de `profiles`; cola: `duel_pvp_queue_active_uniq`. Búsqueda: ver W.

## BU. QUERY PLANS
Revisados en el ensayo: con las tablas actuales (5 amistades, 121 retos) el planificador elige Seq Scan — correcto a este
tamaño; los índices por usuario/estado existen para cuando crezcan. No se añadieron índices a ciegas.

## BV. SECURITY HARNESS
Producción: anónimo GET/POST 401; cross-user, solicitud/reto/bloqueo ajenos, self (400), id inventado, partida forjada, rival
forjado, presencia forjada, lectura de grafo/retos ajenos (403), enumeración por correo (400), UUID como consulta (nada), sin PII
en ninguna respuesta. Smoke de producción (escalada de privilegios) **74/74**.

## BW. CONCURRENCY HARNESS
`scripts/ops/_f85-dryrun.sh` sobre copia restaurada de producción (24 usuarios sintéticos): **0 fallos** (`DRYRUN_OK`): 20
solicitudes, cruzadas ×10, 20 aceptaciones, aceptar‖retirar, bloquear‖aceptar, 20 retos, 20 aceptaciones de reto, aceptar‖cancelar,
aceptar‖caducar (exacta incluida), bloquear‖aceptar reto, unfriend‖aceptar reto, dos amigos a la vez, reservas, invariantes.
HTTP en producción: ×10 solicitudes, ×5 aceptaciones, cruzada, ×10 retos, ×5 aceptaciones de reto, ×4 revanchas.

## BX. PRESENCE HARNESS
1 pestaña, 2 sesiones (multi-pestaña/multi-dispositivo), cierre sin logout → TTL OFFLINE (> 2 min reales), EN PARTIDA del
servidor, EN COLA con latido, logout y cambio de cuenta, presencia entre dos Chrome reales («En línea» al instante).

## BY. CHALLENGE HARNESS
Producción: crear, rechazar, cancelar, caducar, aceptar → partida, F5, reconexión, revancha (API ×4 + navegador aceptada desde
el resultado), bloqueo, conflicto de partida activa, conflicto de cola ranked, no amigos (403), mazo ajeno rechazado.

## BZ. RATE LIMIT HARNESS
Búsqueda: ≥ 25 búsquedas normales pasan y luego 429 (anti-scraping). Retos: 10/pareja/hora → 429 `CHALLENGE_LIMIT`, el sentido
contrario sigue pudiendo. Escrituras 30/min (el instrumento las topa con sus ráfagas y espera la ventana). Pulso 40/min (20 s ×
varias pestañas + 5 s de espera caben). Uso normal nunca topado en la QA de navegador.

## CA. 1440 QA · CB. 1024 QA · CC. 390 QA
Arnés `/design-system/f85` (`scripts/_f85-qa.ts`, código final): **600/600** a 1440/1024/390, movimiento normal y reducido — hub,
amigos 0/1/20/200+, nombres largos, solicitudes, búsqueda (resultados/más/vacía), recientes, retos, perfil (amigo/menú/
desconocido/enviada/bloqueado/largo), comparar (completo/escaso), reto recibido (normal/revancha/largo/ocupado). Sin desbordamiento
horizontal, consola limpia, imágenes con alt. Producción: hub 1440 y 390, hoja de reto, espera, aviso en 390 (dentro de pantalla,
top 567/bottom 748 de 844), duelo, resultado con revancha, aviso de revancha sobre el resultado en 390, partida de revancha,
perfiles, comparar, cambio de cuenta (`prod/shots/`).

## CD. REDUCED MOTION
El aviso y la nota aparecen sin desplazamiento (`initial=false`, duración 0) con `prefers-reduced-motion` (arnés + navegador de
producción en reducido a 390).

## CE. ACCESSIBILITY
Pestañas con ARIA, menú `role="menu"`, aviso como `region` con `aria-label` y `aria-live="polite"`, nota `role="status"`, objetivos
táctiles ≥ 44 px, foco por teclado, estado con palabra (no solo color), sin modal que atrape en el aviso.

## CF. EMPTY STATES
Sin amigos, sin solicitudes, sin recientes, búsqueda sin resultados y sin retos con CTA útil (buscar jugadores, retar a un amigo).

## CG. LONG NAMES
Nombres largos truncados sin romper tarjetas, botones ni el aviso (escenas `long-names`, `profile-long`, `incoming-long`).

## CH. LARGE FRIEND LIST
0 / 1 / 20 / 200+ con fixture aislada del arnés (sin relaciones basura en producción); primera página 100 + «Ver más».

## CI. BACKUP
Antes de 0066: `pre-0066/20261004T204655Z` (y uno previo `20261004T180420Z`) con `COMPLETE`, manifiesto y SHA256SUMS, hecho con el
`backup-drlcards.sh` de la release de producción. Esta sesión no aplicó migraciones (no hizo falta backup nuevo); el diario de
04:30Z existe. **No hay DR off-site: F78 sigue abierto.**

## CJ. MIGRATION REHEARSAL
`_f85-dryrun.sh` sobre copia restaurada en 0065: aplica en una transacción (189 ms), no cambia ningún dato existente (huellas de
15 tablas), privilegios, RLS, todos los casos de BW, rollback aplica y deja las RPC **byte a byte** como 0048 (md5), bloqueos
vuelven como filas BLOCKED, 0066 se re-aplica tras el rollback y es re-ejecutable. `DRYRUN_OK`, 0 fallos.

## CK. PRODUCTION QA
Release final `b7472c2b`: API **93/93** (con TTL) + **92/92** (papeles invertidos), navegador con dos Chrome **24/24**. Cuentas
solo QA (A f45, B qa352, C f64, K f69). Al terminar: 0 bloqueos, 0 retos pendientes, 0 reservas, 0 partidas privadas vivas, 0
colas vivas; las amistades creadas por la QA se eliminaron (quedan las 5 preexistentes de cuentas QA de F66). Las partidas
amistosas jugadas quedan como historial. Nada fabricado (cartas, créditos, rating).

## CL. PERSONAL ACCOUNT
Intacta: 0 filas sociales (amistades, retos, bloqueos) de la cuenta personal; los instrumentos abortan si la ven.

## CM. F76 REGRESSION
`_f76-ui.ts` en producción sobre `b7472c2b`: **17/17** (MATCHED muerto, doble clic, dos sesiones, F5 en partida, resultado fijado por
`?match=`, «Buscar otro rival» → búsqueda nueva sin remontar, consola limpia, limpieza).

## CN. F79 REGRESSION · CO. F80 REGRESSION · CP. F81 REGRESSION · CQ. F82 REGRESSION
La frontera de release demuestra que **ningún fichero de forja, economía, tienda, sobres o colecciones cambió** (solo 13 ficheros
sociales/arena sobre `6a923c24`). `production:check`: catálogo 331/331, arte de cartas/sobres, flags; `/api/ready`: forge, crafting,
collections en verde. Precios F80 (2.500/6.000/12.000/20.000/35.000/60.000) sin tocar. F81.2: ver BP.

## CR. F83 REGRESSION
`_f83-prod-qa.mts`: **39/40**; el único fallo es su pin de cabeza («0064»), que ahora es 0066 por diseño. Temporada 2 = DRAFT.

## CS. F84 REGRESSION
`_f84-prod-qa.mts` (lecturas): **51/52**; el único fallo es su pin de cabeza («0065»). Rating, rango, colocación, Top, libro y pico
intactos; tope de pareja y cola sin cambios (BF–BH, CM).

## CT. F89 REGRESSION
Perfil propio / amigo / desconocido verificados en el navegador de producción con las acciones sociales; Profile 2.0 intacto.

## CU. F77 STATUS
WARN conocido (autoconfirmación de registro). No se tocó email ni recuperación; no se envían solicitudes por correo.

## CV. F78 EXCLUDED
Ningún fichero de F78 viaja: el staging comprueba cada uno (`F78 = producción` / `ausente en producción y en el staging`). Sin
cambios en Backblaze, clave de recuperación, cert, scripts off-site, programador ni configuración.

## CW. MARKETPLACE · CX. PAYMENTS
`GLOBAL_MARKET_ENABLED=false`, `PAYMENTS_ENABLED=false` (production:check PASS «flags»).

## CY. RELEASE BOUNDARY
`F85_BASE=drl-0.1.1-1-6a923c24 scripts/ops/_f85-stage.sh` (base = release F85 viva): 3630 ficheros → **added=0 modified=13
removed=0**, `BOUNDARY_OK` (= overlay exacto), F78 = producción. Overlay (`prod/overlay-f85-1.txt`): `api/game/social/route.ts`,
`duelos/pvp/page.tsx`, `social/page.tsx`, `layout/GameShell.tsx`, `social/SocialLive.tsx`, `f85.social.render.test.tsx`,
`domain/social/{social.ts, social.test.ts, f85.social.test.ts, social.contract.test.ts}`, `lib/social/client.ts`,
`services/rateLimit.ts`, `services/social.ts`. Tar `92c97a3e…baa75`. Las releases F85 anteriores salieron igual sobre `50b3eb69`.

## CZ. FULL TEST SUITE
**5946/5946** (0 fallos) sobre el código final.

## DA. F85 TESTS
`domain/social/f85.social.test.ts` (D1–D11), `server/services/f85.social.service.test.ts` (P1–P3, S1–S2, U1–U2, V1, C1, R1, I1–I2),
`components/social/f85.social.render.test.tsx` (R1–R8): **29** propios + `social.contract.test.ts` / `social.test.ts` actualizados
(**83**). Más: ensayo de BD (61 casos), producción API (93 + 92), navegador (24), arnés visual (600).

## DB. TYPES
`npm run typecheck`: 0 errores (app + scripts).

## DC. LINT
0 errores · 26 avisos = la misma línea base de F84 (0 nuevos).

## DD. BUILD
`next build` PASS (incluye `/social`, `/social/comparar`). Aviso conocido de `instrumentation.ts` (`process.exit` en Edge), previo.

## DE. HEALTH · DF. READY
`/api/health` 200. `/api/ready` ready, cabeza `0066_social_2`, 13 checks en verde (incluye «social» y «ranked»).

## DG. PRODUCTION SMOKE
Smoke **74/74**. `production:check --app --vps`: **27 PASS · 1 WARN (auth-email, F77) · 4 FAIL (F78 off-site: backup-offsite
NOT_CONFIGURED, drill, schedule, f78-offsite-dr)** — exactamente los mismos que en F83/F84. App y BD en `0066_social_2`.

## DH. LOGS
`valorosters-app` desde el despliegue de `b7472c2b`: 0 líneas de error/excepción. Errores sociales con log estructurado
`[social] <acción> <código>` sin PII. No hay infraestructura de métricas: no se inventó (contadores técnicos = deuda DL-5).
Telemetría: se reutilizan los eventos sociales ya existentes de F29 (`trackSocial`); no se inventaron eventos nuevos.

## DI. RELEASE
| release | cuándo (UTC) | qué |
|---|---|---|
| `71c9e802` | 2026-10-04 20:52 | F85 inicial (tras aplicar 0066 a las 20:48) |
| `0f38d421` | 2026-10-04 21:11 | búsqueda con `_` literal; revancha ×N = una |
| `6a923c24` | 2026-10-04 21:40 | aceptar con el único equipo legal (sin verificar al cortarse la sesión) |
| `931c073d` | 2026-10-05 08:05 | `?aceptar=` con foto anterior al reto; pulso 20 s / escritura 40 s |
| **`b7472c2b`** | **2026-10-05 08:28** | **revancha desde el resultado (aviso en la arena, retador entra solo, arena por partida)** |

## DJ. ROLLBACK
Código: `bin/deploy.sh --activate drl-0.1.1-1-6a923c24` (misma BD). Pre-F85: primero `--activate drl-0.1.1-1-50b3eb69` y después
`docs/operations/rollback/0066_social_2.ROLLBACK.sql` (ensayado: RPC idénticas a 0048; un bloqueo mutuo queda en uno, limitación
de 0048).

## DK. COMMIT/PUSH
Ninguno. Todo en el árbol de trabajo.

## DL. REMAINING RISKS
1. **Entrega por sondeo** (≤ 20 s, medida 17 s): suficiente para un reto de 5 min; tiempo real (Realtime/SSE) sería otra fase.
2. Un aviso de reto en una pestaña en segundo plano no llega hasta volver a ella (sin pestaña visible no hay pulso y, a los 2 min,
   el jugador aparece Desconectado — coherente con la semántica).
3. Un reto normal recibido en la arena PvP (fuera de la revancha de esa partida) espera a que el jugador salga de la arena: decisión
   para no interrumpir; queda en Social y en el contador.
4. Búsqueda con `ilike` no usa el índice `lower(username)` (irrelevante con 40 perfiles; reescribir con RPC si crece).
5. Sin contadores técnicos (`friend_request_created`…): no existe infraestructura de métricas y no se creó.
6. Las 5 amistades preexistentes son de cuentas QA de F66; no se tocaron.
7. F78 (DR off-site) sigue abierto; F77 WARN sigue.

## DM. FINAL VERDICT
Los 77 puntos de la definición de terminado se cumplen con evidencia en producción; los únicos FAIL del production check son los
4 de F78 (conocidos, fuera de alcance) y el WARN de F77. Los tres defectos que dejaron la sesión anterior en 16/22 (aceptar desde
el hub, entrega lenta, revancha desde el resultado) están corregidos, desplegados y verificados con dos navegadores reales.
Sin chat, sin clubs, sin feed, sin commit, sin push. Temporada 2 en DRAFT; pase heredado, mercado y pagos sin tocar.

F85 PRODUCTION = GO
