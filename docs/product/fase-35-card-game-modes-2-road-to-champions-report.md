# FASE 35 — CARD GAME MODES 2.0 · GAME MODES HUB + ROAD TO CHAMPIONS

Fecha: 2026-09-15 · Rama: `arch/stabilization` · Sin commit, sin push, sin deploy.

Principio de la fase: **CAMPAIGN NODE → PREPARAR PARTIDA → MOTOR PvE CANÓNICO → RESULTADO AUTORITATIVO → CAMPAIGN PROGRESSION.** No hay motor de campaña. El nodo decide contra qué equipo real, con qué dificultad canónica y qué recompensa única; la partida la juega `domain/cardgame` exactamente igual que una partida rápida.

---

## 1. Estado inicial encontrado

- No existía `/jugar`. La entrada a jugar era `/duelos` (hub de duelos: continuar, nuevo duelo, PvP, competitivo, mis equipos, repeticiones). Home «Jugar» → `/duelos`; nav sección jugar → `/duelos` con 7 entradas (tope de los tests).
- PvE: `services/duels.startMatch(deckId, difficulty)` con rival OPD-09 (mazo del catálogo más cercano en OVR, semilla aleatoria). Sin concepto de nodo, capítulo ni progreso de campaña.
- `duel_matches` (0014 + 0031) sin columna de contexto; `mode` ∈ PVE/PVP (0048 local añade PVP_PRIVATE). `getActiveMatch` no filtra por modo.
- Pago PvE por partida (`duelAward` + tope diario 20, ref `duel:<matchId>`).
- Migraciones 0046–0050 locales sin aplicar; no existía 0051.
- Catálogo: 772 cartas con combate, 66 equipos; **ningún equipo tiene 2 jugadores por cada uno de los 5 roles** (casi ninguno tiene Centinela).

## 2. Motor PvE canónico encontrado

`domain/cardgame`: orquestador `duel-turns-2` (10 turnos, alternancia, ejes), Combat Resolver `duel-combat-2` (SCORE → OVR_TIEBREAK → STAT_MARGIN → DRAW), bots `createDuelBot` con `DIFFICULTY_PROFILE` EASY 0 / NORMAL 0.5 / HARD 0.85 de heurística, `perfectInformation: false` en todos. Servidor: `services/duels.ts` (semillas `crypto`, estado en `duel_matches` sin políticas RLS, `toPublicView` redactado, `awardMatchOutcome` tras persistir).

## 3. Sistemas reutilizados

Motor y bots canónicos · `validateDuelDeck`/`makeDeckResolver`/`takeDeckSnapshot` · `CardRegistry` + catálogo persistido (`serverCatalog`) · `resolveTeamIdentity`/`currentTeamIdentity`/`isAmbiguousAlias` · `award()` → `app_grant_reward` (idempotencia por `ref`) · `duelAward` + tope diario · equipo activo (`readActive`, 0050) y `listDecks` · `PreMatchVersus`, `MatchIntro`, `MatchBoard`, `DuelMoment`, `ResultScreen` (hueco `extra`), `PostMatchProgress` · objetivos diarios (`MetaSnapshot.objectives`) · `ObjectiveCard` · `todayActions`/`NextUp` · `takeRate`/`app_rate_take` · telemetría cerrada (`isFlow`, reserva en 0046) · `isMissingSchema` · `HydrationGate` + `qaSimulate` para QA.

## 4. Qué has construido

1. **Game Modes Hub** `/jugar` (Road to Champions héroe + partida rápida, competitivo, retar a un amigo + desafíos del día).
2. **Road to Champions** `/jugar/road-to-champions`: definición versionada `rtc-1`, dominio puro (validación, rivales, dificultad, progresión, recompensa, read model), servicio con autoridad de servidor, API, mapa, detalle de nodo, pre-partida y resultado de nodo integrados en la arena canónica.
3. Persistencia local **0051** (no aplicada) con degradación honesta.
4. Integraciones: home, nav, NextUp, perfil propio, telemetría (no-op), rate limit.
5. 140 pruebas nuevas, verificador `campaign:verify` (+3 secciones), arnés QA y capturas.

## 5. Game Modes Hub

`src/app/jugar/page.tsx` + `components/modes/GameModesHub.tsx`. Cabecera «JUGAR / ELIGE TU PRÓXIMO DESAFÍO». Road to Champions es la tarjeta héroe (geometría NEXUS, línea de energía, capítulos X/5, CTA). Tres puertas a modos existentes: **Partida rápida** → `/duelos/jugar`, **Competitivo** → `/duelos/competitivo`, **Retar a un amigo** → `/social`. Estados SOLO de datos reales (`gameModes`, puro): DISPONIBLE · EN PARTIDA (paso `resume-duel`/`resume-pvp` del loop) · EQUIPO NO VÁLIDO (`decks.valid === 0`) · PROVISIONAL (`loop.competitive.provisional`) · NO DISPONIBLE (campaña sin 0051 o sin leer) · INICIA SESIÓN · COMPLETADA · CARGANDO. Sin dato (`null`) no se afirma nada. Dos lecturas en paralelo (meta + campaña), ninguna escritura nueva. Desafíos del día en la misma pantalla.

## 6. Road to Champions

Campaña de NEXUS (no historia VCT): 3 capítulos (Clasificatorio, Circuito, Campeones) × 5 nodos. Cada nodo: rival = equipo real verificado; objetivo único «gana la partida de diez turnos, mismas reglas». Jugar = arena canónica `/duelos/jugar?campaign=<nodo>`.

## 7. Campaign definition/version

`src/data/roadToChampions.ts`: `{ campaignId: "road-to-champions", version: "rtc-1", name, tagline, chapters[{ id, order, name, description, theme, nodes[{ id, chapterId, order, type, name, objective, opponent: { teamId }, difficulty, requirements: { completed[] }, nextNodes[], rewards: { firstClear: { credits } } }] }] }`. Determinista (sin reloj/azar; test T14). `validateCampaign` (puro): slug/versión, 3 capítulos, 12–18 nodos, órdenes contiguos, un jefe al final de cada capítulo, ids únicos `cN-nM`, entrada única, enlaces existentes y simétricos, sin ciclos, todo alcanzable, dificultad = regla, recompensa = tabla, techo total, rival existente/verificado/con roster actual/no repetido. Definición separada del progreso; ids de nodo ESTABLES (una versión nueva añade, no reutiliza).

## 8. Chapters

| Cap. | Nombre | Tema | Base de dificultad | Cartas del rival |
|---|---|---|---|---|
| 1 | Clasificatorio | cian | ROOKIE (EASY) | BASE (jefe: MID) |
| 2 | Circuito | violeta | PRO (NORMAL) | MID (jefe: TOP) |
| 3 | Campeones | oro | CHAMPION (HARD) | TOP |

Capítulo desbloqueado = algún nodo no bloqueado; completado = 5/5.

## 9. Nodes/tipos

15 nodos: por capítulo 3 × MATCH, 1 × ELITE, 1 × BOSS. ELITE/BOSS son **presentación y contexto** (tamaño, halo, ◈/◆, dificultad de la regla), sin ninguna ventaja de reglas (T30: el nodo no admite claves de modificadores). CHALLENGE no se construyó.

| Nodo | Tipo | Rival | Región | Bot | Cartas | Núcleo + refuerzos | Σ OVR |
|---|---|---|---|---|---|---|---|
| c1-n1 Primer contacto | MATCH | NAVI | EMEA | EASY | BASE | 7 + 3 | 756 |
| c1-n2 Presión alta | MATCH | LOUD | Americas | EASY | BASE | 7 + 3 | 737 |
| c1-n3 Lectura de mapa | MATCH | BLG | China | EASY | BASE | 6 + 4 | 760 |
| c1-n4 Ritmo de élite | ELITE | TE | China | NORMAL | BASE | 7 + 3 | 741 |
| c1-n5 Guardián del clasificatorio | BOSS | JDG | China | NORMAL | MID | 7 + 3 | 757 |
| c2-n1 Nueva liga | MATCH | FUT | EMEA | NORMAL | MID | 5 + 5 | 778 |
| c2-n2 Viaje al Pacífico | MATCH | GE | Pacific | NORMAL | MID | 5 + 5 | 774 |
| c2-n3 Doble filo | MATCH | XLG | China | NORMAL | MID | 5 + 5 | 790 |
| c2-n4 Muro táctico | ELITE | Karmine Corp | EMEA | HARD | MID | 5 + 5 | 786 |
| c2-n5 Señor del circuito | BOSS | Fnatic | EMEA | HARD | TOP | 4 + 6 | 810 |
| c3-n1 Escenario mayor | MATCH | NS | Pacific | HARD | TOP | 5 + 5 | 812 |
| c3-n2 Sin margen | MATCH | G2 | Americas | HARD | TOP | 5 + 5 | 814 |
| c3-n3 Noche larga | MATCH | TYL | China | HARD | TOP | 6 + 4 | 819 |
| c3-n4 Antesala | ELITE | Paper Rex | Pacific | HARD | TOP | 5 + 5 | 828 |
| c3-n5 Corona NEXUS | BOSS | Leviatán | Americas | HARD | TOP | 5 + 5 | 873 |

## 10. Campaign map

`components/campaign/CampaignMap.tsx`. Escritorio/tableta: una banda por capítulo con los nodos sobre una línea ondulada (posiciones en % → sin scroll horizontal), tramos superados con energía animada (`nx-energy`), pendientes discontinuos. Móvil (<md): lista vertical, un nodo por fila con rival y dificultad. Nodo: hexágono SVG; **bloqueado** apagado + candado + texto «Bloqueado»; **disponible** cian + pulso lento (`nx-node-pulse`, 2,4 s) + «Disponible · Siguiente»; **completado** verde + ✓ + «Completado»; **jefe** más grande, halo y ◆; élite ◈. Estado siempre en texto (no solo color). Cabecera `CampaignHero`: X/Y nodos, capítulos X/Y, créditos de primera victoria conseguidos/total, barra con `role="progressbar"`, CTA «Continuar · 2-3 Doble filo». Avisos `CampaignNotice`: no disponible, sin conexión, error, inicia sesión, nodo en marcha, completada, sin equipo. Detalle `NodeSheet`: panel lateral (≥md) / hoja inferior (móvil) con rival (roster actual + refuerzos, escalón de cartas, Σ), dificultad (campaña + bot), estado, objetivo, tu equipo activo, recompensa de primera victoria (o «conseguida»), historial (mejor resultado, intentos, victorias), motivo de bloqueo, CTA (JUGAR / REJUGAR / RETOMAR / EDITAR EQUIPO / CREAR EQUIPO / INICIA SESIÓN / SIN CONEXIÓN / NO DISPONIBLE) y «Abandonar el nodo en marcha». `?node=<id>` abre el detalle (enlazable, «atrás» lo cierra).

## 11. Opponents

Solo **equipos del registro canónico** (`TEAM_IDENTITIES`) con estado `verified` y roster actual resoluble sin ambigüedad. Núcleo = jugadores cuyo `Player.team` resuelve con `currentTeamIdentity` al id del nodo (TH y «Team Heretics» son la misma identidad; alias ambiguos nunca se fusionan: T20). Ningún jugador, carta ni equipo inventado (T16–T19, `campaign-content:verify` 15/15). La UI dice la composición real: «5 jugadores del roster actual + 5 refuerzos reales de China». El mazo rival NO se revela carta a carta (información oculta; T71/T94): solo equipo, núcleo/refuerzos, escalón y Σ (la misma cifra que ya enseña el marcador en partida).

## 12. Bot deck generation

`domain/campaign/opponent.ts#buildOpponentPlan(catalog, teamId, tier)` — puro, determinista (T21, también con otra instancia del catálogo):
1. Una carta por jugador según escalón: BASE = su versión de menor OVR, MID = mediana, TOP = mayor (solo cartas con trío de combate; empate por `cardId`).
2. Por rol canónico, hasta 2 jugadores del núcleo (mayor OVR, empate por `playerId`).
3. Huecos: jugadores de la misma región fuera del núcleo con OVR más cercano a la media del núcleo; si no hay, del resto del catálogo.
4. Nunca repite jugador; mínimo de núcleo 3 (`OPPONENT_MIN_CORE`), si no: `ok:false` y el nodo no se sirve.
Servidor: `duels.fixedOpponentDeck(cardIds, name, label)` crea las instancias sintéticas `bot-rtc-<nodo>-i` y pasa por el **mismo** `validateDuelDeck` + `makeDeckResolver(..., versionOf)` + `takeDeckSnapshot` que el rival OPD-09 (T22, T115). Plan calculado una vez por (catálogo, definición) en `WeakMap`.

## 13. Difficulty mapping

`domain/campaign/difficulty.ts`: `ROOKIE→EASY`, `PRO→NORMAL`, `CHAMPION→HARD` (`DIFFICULTY_PROFILE` intacto, T28). Regla fija validada: MATCH = base del capítulo; ELITE = base +1 (tope CHAMPION); BOSS = base +1 y cartas +1 (tope TOP). Sin IA nueva, sin información perfecta, sin trampas. El cliente nunca elige dificultad ni rival (el POST no lo admite).

## 14. Campaign progression

`domain/campaign/progression.ts` (puro). Estados derivados: COMPLETED (hay progreso COMPLETED), AVAILABLE (requisitos completados), LOCKED. `applyOutcome` por intento liquidado: intentos +1, victorias, mejor resultado (WIN > DRAW > LOSS), primera victoria (fecha + partida) inmutable. `summarize`: completados/total, capítulos, siguiente nodo, campaña completa. MASTERED no se construyó.

## 15. Unlock rules

Condición explícita: completar los nodos de `requirements.completed` (lineal). Sin nivel de cuenta, sin pago, sin energía, sin tiempo. Un nodo completado se puede rejugar siempre. Servidor rechaza bloqueado (409 LOCKED) antes de reservar nada (T58).

## 16. Win/loss/draw policy

WIN completa (primera vez = primera victoria). LOSS cuenta intento y mantiene disponible. **DRAW NO completa** (`DRAW_COMPLETES_NODE = false`, T36/T56): un empate no supera un nodo; cuenta el intento. Perder o empatar un nodo ya completado no lo descompleta (T38). Resultado del jugador = bando A del resultado autoritativo (`winner null` o `isDraw` → DRAW, igual que `duelRewards.outcomeOf`).

## 17. Persistence

`supabase/migrations/0051_campaign_road_to_champions.sql` — **LOCAL, NO APLICADA**:
- `campaign_progress (user_id, campaign_id, node_id) PK · campaign_version · status ATTEMPTED|COMPLETED · best_result · attempts · wins (≤ attempts) · first_cleared_at · first_clear_match_id · updated_at`; CHECK COMPLETED ⇔ `first_cleared_at`.
- `campaign_attempts (id, user_id, campaign_id, campaign_version, node_id, match_id UNIQUE → duel_matches ON DELETE SET NULL, status STARTED|SETTLED|ABANDONED, result, first_clear, reward_granted, created_at, settled_at)`; CHECKs de coherencia; índices únicos parciales `one_open (user_id) WHERE status='STARTED'` y `first_clear_once (user_id, campaign_id, node_id) WHERE first_clear`.
- RLS activa sin políticas, `revoke all` a anon/authenticated, `grant` a service_role. No altera tablas existentes (T124). No toca `duel_matches.mode` (añadir un modo CAMPAIGN cambiaría cola, rating, repeticiones y perfil).
Degradación sin aplicar: GET 200 `available:false, unavailableReason:"MIGRATION_PENDING"` (mapa en vista previa, todo bloqueado, «ROAD TO CHAMPIONS TODAVÍA NO DISPONIBLE»); start 503 MIGRATION_PENDING; gancho de partida no-op; NextUp sin paso. Sin sustituto en localStorage.

## 18. Idempotency/concurrency

- Reserva antes de crear la partida (índice único parcial): doble clic / dos pestañas → una sola partida (T62, verificador).
- Partida PvE en curso bloquea lanzar (409 ACTIVE_MATCH).
- Liquidación: transición condicional `STARTED → SETTLED` por intento; `match_id` único; la segunda llamada ve 0 filas (T54, T63 gancho + sync concurrentes).
- Progreso leído antes del reclamo (un solo intento abierto por usuario ⇒ nadie lo cambia en medio); si el upsert falla, el reclamo se deshace y se reintenta al sincronizar.
- Primera victoria única en BD + clave de libro mayor `campaign:<campaña>:<nodo>`; pago fallido → `reward_granted=false` → la reconciliación lo cobra una vez (T68).
- Reserva huérfana > 2 min → ABANDONED; partida borrada → ABANDONED sin contar intento (T65, T66). Abandonar con partida ya terminada liquida en vez de borrar (T67).
- Versión nueva: progreso con `rtc-0` sigue contando (T73); intento de nodo retirado se liquida sin progreso ni pago (T74).

## 19. Active Deck integration

El detalle del nodo enseña el equipo activo (o el primero listo) con Σ y estado; inválido → EDITAR EQUIPO (`/duelos/mazos?deck=`), sin equipos → CREAR EQUIPO. Lanzar acepta `deckId` opcional (UUID propio); sin él, el servidor usa el activo (`readActive`, 0050) o el primer válido (`listDecks`). La legalidad y la propiedad las revalida el PvE canónico (409 → DECK_NOT_READY y la reserva se retira, T60).

## 20. PreMatch integration

`components/campaign/CampaignPreMatch.tsx` en la arena cuando hay `?campaign=`: migas «‹ Road to Champions», «ROAD TO CHAMPIONS · CAPÍTULO 2 · NODO 2-3 · PARTIDA», nombre del nodo, `PreMatchVersus` (TU EQUIPO VS «Bot · XLG · Normal», rival oculto), placa de rival (roster + refuerzos, escalón, Σ, dificultad, jefe), recompensa, selector de equipo, bloqueo explicado, «Jugar nodo» / «Rejugar nodo». Sin selector de dificultad. La pre-partida rápida no cambia (T119).

## 21. Match Experience integration

Misma arena de Fase 33: `MatchIntro` (nombre del rival real), `MatchBoard` (usa `rivalLabel`, que la arena rellena en presentación con el equipo del nodo), `DuelMoment`, `ResultScreen`. Reconexión: una partida en curso que es la de un intento abierto recupera su contexto al entrar (lectura del servidor). Nada de motor, protocolo PvP, timers ni resolución cambia.

## 22. Post-match progression

Al cerrar la partida, `playTurn` (tras persistir y pagar) liquida la campaña con los hechos del motor; la arena llama `action:"sync"` y el banner `CampaignResultBanner` (hueco `extra`, antes de `PostMatchProgress`) lee el **intento liquidado** (`lastAttempt.matchId === view.matchId`): NODO COMPLETADO (+créditos) · INTÉNTALO DE NUEVO · EMPATE · NODO PENDIENTE · VICTORIA · NODO YA COMPLETADO · CAPÍTULO N COMPLETADO · ROAD TO CHAMPIONS COMPLETADO · SINCRONIZANDO PROGRESO (con «Actualizar progreso»). CTA «Siguiente nodo» tras ganar y «Volver al mapa». «Revancha» = rejugar el nodo; «Cambiar rival o mazo» se oculta en campaña.

## 23. First-clear behavior

Primera victoria = primera WIN del usuario en el nodo: marca `first_cleared_at` y `first_clear_match_id` (inmutables), `first_clear=true` en el intento y paga una vez. Rejugar: permitido, `replay:true`, sin primera victoria ni pago (T57); el detalle lo avisa.

## 24. Rewards/economy

Primera victoria en **créditos existentes** por la única vía (`award` → `app_grant_reward`), clave `campaign:road-to-champions:<nodo>` (sin versión: una `rtc-2` no repaga), motivo `campaign_first_clear`. Tabla 50 (MATCH) / 100 (ELITE) / 200 (BOSS) → **1.350 en toda la campaña** (techo 1.500; un Sobre Estándar cuesta 750). La partida paga además lo de siempre (tabla PvE + tope diario de 20 partidas pagadas, compartido): la campaña no abre granja. Sin moneda nueva, sin sobre/cartas de campaña, sin stamina, tickets ni reintentos de pago.

## 25. Campaign completion

X/Y NODOS y CAPÍTULO X/Y en cabecera, hub y perfil propio; aviso y banner «Road to Champions completado»; nodos rejugables. Sin puntuación global inventada.

## 26. Achievements

No se añadieron logros de campaña: el sistema de logros existente mide métricas del meta (`duels_won`, colección…) y extenderlo exigiría métricas nuevas en `player_progression`/misiones (autoridad del pase). Las partidas de campaña SÍ cuentan para los logros/misiones existentes de duelos porque son partidas PVE normales. Documentado como P2.

## 27. Daily PvE challenges/objectives

Reutiliza el sistema de misiones: `dailyPveObjectives` = objetivos `daily` con métrica `duel_*`/`duels_*` sin reclamar, desde `GET /api/game/meta`. Se enseñan en el hub con `ObjectiveCard` (estados: con desafíos, ninguno hoy, no se pudieron leer, leyendo, sin sesión). Sin tabla `daily_challenges` (T79), sin modificadores de reglas. Las partidas de campaña cuentan.

## 28. Quick Play

`/duelos/jugar` sin parámetro: idéntico (T111, T118, T119). `startMatch` ahora delega en `createPveMatch` con el MISMO rival OPD-09, mismas validaciones, mismo orden de semillas (T113) y misma inserción (T112).

## 29. Competitive

Sin cambios: rating, K-factor, cola, liquidación ranked y `/api/game/competitive` intactos. La campaña es PVE: 0 impacto en rating; el servicio no importa ni toca nada competitivo (T110, T139, verificador).

## 30. Private challenges

Sin cambios (PVP_PRIVATE de Fase 29). El hub enlaza «Retar a un amigo» → `/social`.

## 31. Home/NextUp integration

Home: acción principal «Jugar» → `/jugar` (con equipo listo; los demás estados no cambian). NextUp (`services/loop.ts`): paso `campaign` tipo `play`, prioridad 6.5 (detrás de «Juega un duelo»), solo con equipo válido, sin partida a medias y campaña disponible y sin terminar (una lectura acotada, `null` sin 0051). `todayActions`/`RANK`/`continueCta` intactos: la recomendación única sigue siendo la de siempre (T81–T87).

## 32. Season integration

Temporada intacta (una sola `nexus-s1`, sin Temporada 2, T86). El **Season Action Board no incorpora la campaña**: `todayActions` deduplica por tipo y `play-ranked` (tipo `play`) siempre está con equipo válido; añadir un tipo nuevo cambiaría el motor de prioridad compartido. Documentado P2. `season/actions.ts` y `services/season.ts` no conocen la campaña (T83).

## 33. Profile integration/privacy

Perfil propio (`snap.view === "SELF"`): `CampaignProfileBadge` «Road to Champions · X/15 nodos · capítulos X/3» (o «Todavía no disponible»). Perfil público: nada (T88). La API solo sirve la foto del token (GET sin parámetros).

## 34. Read models/API

- `CampaignSnapshot`: `serverNow, campaignId, version, name, tagline, available, unavailableReason, chapters[{…, completed, total, complete, unlocked, nodes: CampaignNodeView[]}], summary, activeAttempt, lastAttempt, economy{firstClearTotal, firstClearEarned}`. `CampaignNodeView`: tipo, estado, dificultad (campaña + bot), rival (equipo, tag, región, núcleo, refuerzos, Σ, escalón, jugable), requisitos, siguientes, recompensa, primera victoria, mejor resultado, intentos, victorias, siguiente. Sin `user_id`, ids de intento ni cartas del rival (T71).
- GameModes: `gameModes(facts)` puro sobre meta + campaña.
- API `/api/game/campaign`: `GET` (con sesión: mapa personal no-store; sin sesión: vista previa `public, max-age=60, s-maxage=300`; cualquier parámetro → 400) · `POST {action:"start", nodeId, deckId?}` → `{view, nodeId, replay}` · `POST {action:"sync"}` · `POST {action:"abandon"}`. Lista cerrada de claves (otra → 400 FIELD_NOT_ALLOWED).

## 35. Security

Usuario siempre del token; nunca `userId`, `difficulty`, `opponent`, `winner`, `result`, `reward`, `completed` en el cuerpo. El servidor valida nodo existente (404), desbloqueo con SU progreso (409), rival jugable (503), ninguna partida PvE en curso (409), un intento abierto (409), equipo propio y legal (PvE canónico). Rival y dificultad salen de la definición. 5xx → 503 genérico (salvo estados de producto MIGRATION_PENDING/RIVAL_UNAVAILABLE/INVALID_DEFINITION). Rate limit `campaign_read` 60/min y `campaign_write` 20/min (cubetas nuevas, sin migración). Tablas solo servidor (RLS sin políticas). Formatos validados (`cN-nM`, UUID). Campaña nunca escribe `duel_matches` (T109) ni toca rating.

## 36. Economy security

Pago único por (usuario, nodo) garantizado dos veces (índice parcial + clave de libro mayor); sin versión en la clave; reintento seguro; total acotado y validado en la definición (REWARD_CAP); empate no paga; rejugar no paga; partidas sujetas al tope diario PvE existente; concesión solo por `award` (T48); `campaign-economy:verify`: campaña completa paga exactamente 1.350 y rejugarla entera añade 0.

## 37. Offline/reconnect/multi-tab

Sin conexión: hub «SIN CONEXIÓN · Tu progreso está seguro», mapa con aviso y última foto, detalle con CTA deshabilitada; nada se completa en local. Vuelve la conexión / vuelve la pestaña → se relee (sin sondeo). Reconexión en la arena recupera el contexto del nodo. Multi-pestaña: reserva única, liquidación condicional, `sync` idempotente.

## 38. Cache/performance

Definición y mazos rivales: calculados una vez por (catálogo, definición) (`WeakMap`); vista previa pública cacheable. Progreso: `no-store`. Lecturas acotadas (`PROGRESS_LIMIT 100`, `ATTEMPTS_RECENT 5`, `RECONCILE_LIMIT 5`), dos consultas en paralelo para el mapa, una para el resumen (NextUp/perfil), sin N+1 por nodo (T137). La arena pide la foto del nodo en paralelo al arranque.

## 39. Telemetry

`lib/campaign/telemetry.ts`: contextos `game_modes_view, campaign_open, campaign_node_open, campaign_match_start, campaign_node_complete, campaign_replay, campaign_chapter_complete` en el flujo `campaign`, **reservado en 0046 (no aplicada)** y fuera de `FLOWS` (4) ⇒ no-op honesto (T122). Zona de ruta `/jugar*` → `duel_hub` (taxonomía cerrada existente, sin ampliar 0029).

## 40. Responsive/mobile/tablet

Hub: héroe + rejilla que apila a 1 columna. Mapa: escritorio/tableta línea ondulada en %, móvil vertical (T104); detalle en panel lateral o bottom sheet con zona segura. Capturas a 1440/1024/390 sin desbordamiento horizontal (ver §43).

## 41. Accessibility/reduced motion

Nodos = `<button type="button">` con `aria-label` completo («Nodo 1-2 · Partida · Presión alta · contra LOUD · dificultad Novato · Disponible · Siguiente»), `aria-haspopup="dialog"`, `aria-expanded`; estado, dificultad, recompensa y progreso en texto; diálogo con `role="dialog"`, `aria-modal`, título, foco inicial, Tab atrapado, Escape y foco devuelto (T101); objetivos de 44 px (T102); headings h1/h2/h3; `role="progressbar"` con `aria-valuetext`; avisos `role="status"`/`alert`; `prefers-reduced-motion` apaga pulso y energía (T103) y la arena ya usa `MotionConfig reducedMotion="user"`; sin destellos (ciclos ≥ 1,6 s).

## 42. Game feel/visual system

Geometría NEXUS (hexágonos, retícula, filos `nx-clip`), profundidad por gradientes radiales, líneas de energía que recorren lo superado, halo de jefe, atmósfera por capítulo (cian / violeta / oro), CTA rosa de acción principal, tipografía display en mayúsculas, marca ✓ de completado, candado de bloqueado.

## 43. QA visual

`/design-system/fase35?scene=…` (QA SYNTHETIC: definición y rivales reales, progreso inventado) + `scripts/_fase35-visual-qa.ts` → `docs/product/qa/fase35/` (README con escena y comprobaciones por captura). **98 capturas** de **67 escenas + 2 rutas reales** (64 escenas del brief + 65–67 desafíos del día) a 1440/1024/390 según escena: **0 con desbordamiento horizontal, 0 errores de consola propios, 0 selectores sin encontrar**. Cubre: hub (completo, jugador nuevo, sin equipo, en partida, provisional, sin sesión, campaña no disponible, sin conexión, completada), mapa (nuevo, en progreso, capítulo completo, jefe final, completada, migración sin aplicar, sin sesión, sin conexión, error de backend con y sin última foto, nodo en marcha, sin equipo, primera derrota, capítulo bloqueado), detalle de nodo (bloqueado, disponible, completado/rejugar, élite, jefe, equipo inválido, sin equipo, no disponible, sin conexión, retomar, otro nodo en marcha, sin sesión, hoja inferior móvil), pre-partida de campaña (disponible, rejugar, jefe, equipo inválido, sin equipos, bloqueado, error de partida activa), intro y tablero con el mazo REAL de XLG, resultados (nodo completado, inténtalo de nuevo, empate, victoria rejugada, capítulo completado, campaña completada, sincronizando), progreso X/Y, economía, estados vacíos/error, perfil propio, NextUp secundario, navegación, composición del rival, nodo jefe, líneas de energía (tableta), teclado (foco visible en el nodo 1-1), movimiento reducido, rutas reales `/jugar` y `/jugar/road-to-champions` sin Supabase local.
Correcciones salidas de la QA: decoración del héroe del hub y del mapa sobre textos (oculta <md, limitada en ≥md), etiquetas de nodo sobre las líneas (placa oscura), «Cambiar rival o mazo» en el resultado de campaña (oculto, también en el arnés), intro capturada durante el fundido de hidratación (settle 3,4 s), tablero/resultados con el mazo QA genérico etiquetado como XLG (ahora el mazo real del nodo) y escena de empate sin empate real contra XLG en 400 semillas (ahora empate REAL del motor en espejo, declarado en pantalla).
Entorno: la primera sesión de capturas con `next dev` + suite completa en paralelo agotó la memoria del equipo (procesos huérfanos detenidos); las capturas definitivas se hicieron contra `next start` (build de producción), en serie.

## 44. Tests/gates

**Pruebas nuevas: 140/140** — `campaign.test.ts` T1–T50 (dominio, rivales, dificultad, progresión, recompensa), `campaign.service.test.ts` T51–T74 + T95–T99 (partida, seguridad, idempotencia, concurrencia, reconciliación, sin 0051), `campaign.contract.test.ts` T75–T94 + T100–T140 (hub, NextUp/temporada, privacidad, a11y/UI, regresión).

| Gate | Resultado |
|---|---|
| `npm test` | **2111/2111**, 0 fallos (exit 0) |
| `tsc --noEmit` (web) | 0 errores |
| `tsc -p tsconfig.scripts.json` | 0 errores |
| `next build` | exit 0 (`/jugar`, `/jugar/road-to-champions` en la tabla de rutas) |
| ESLint (ficheros nuevos y modificados) | 0 |
| `security:verify` | 201 ✓ / 0 ✗ |
| `pack:verify` (aislado) | 42 ✓ / 0 ✗ (linealidad ratio 2,13) |
| `content:verify` | 21 / 0 |
| `distribution:verify` | 30 / 0 |
| `competitive:verify` | 27 / 0 |
| `importer-vlr:verify` | 69 / 0 |
| `combat:verify` | 5 / 0 |
| `deck:verify` | 34 / 0 |
| `social:verify` | 33 / 0 |
| `replay:verify` | 25 / 0 |
| `season:verify` · `season-time` · `season-pass` · `season-security` · `season-recap` | 21/0 · 4/0 · 4/0 · 4/0 · 4/0 |
| **`campaign:verify`** (nuevo) | **33 / 0** |
| **`campaign-content:verify`** · **`campaign-security:verify`** · **`campaign-economy:verify`** (nuevos) | **9/0 · 13/0 · 11/0** |

Regresiones cubiertas por la suite y los verificadores: PvE (rápida, reconexión, pago), PvP/PVP_PRIVATE, Match Experience 3.0, Deck Builder, Collection, Progression/meta, Competitive, Social, Profile, Live Events, Pick'ems, Season.
Contratos de fases previas actualizados a propósito (ver §45.6 y §48). Postgres real (índices parciales, RLS, `app_grant_reward`, `app_rate_take`): **NO EJECUTADO — REQUIERE BD DE PRUEBAS**.

## 45. Bugs reales encontrados/corregidos

1. `route.ts` exportaba una constante no válida para una ruta de Next (`NODE_PARAM`) → habría roto `next build`; ahora es local.
2. Bucle `for … return` en el GET (unreachable-loop) → validación explícita de parámetros.
3. Decoración del héroe del hub cruzaba la lista de capítulos (QA) → SVG limitado a la mitad derecha en ≥md.
4. Etiquetas de nodo sobre las líneas de energía en escritorio (QA) → placa oscura detrás del texto.
5. «Cambiar rival o mazo» en el resultado de campaña prometía algo que el nodo no permite → oculto en campaña (la salida es «Volver al mapa»).
6. Contratos de fases 26/27/32/33/34 que fijaban textos cambiados legítimamente (arranque de la arena, hueco `extra`, «no existe 0051», máximo de migración 50) → la arena conserva la línea fijada (foto de campaña en paralelo) y los tests se actualizan manteniendo su intención (0051 solo de campaña, sin tablas de temporada ni de repeticiones).
7. Fixture QA con un código de error de mazo inexistente (TS2352) → corregido.
8. (Doble de prueba) `abandon` simulado no borraba la partida → alineado con `abandonMatch`.

## 46. P2 reales

1. **0051 y 0046 sin aplicar**: en un entorno real la campaña responde «todavía no disponible» y la telemetría `campaign` es no-op hasta aplicarlas (con `FLOWS` actualizado en el mismo cambio).
2. Índices parciales, CHECKs, RLS y `app_grant_reward` reales: **NO EJECUTADO — REQUIERE BD DE PRUEBAS** (probado con `MemorySupabase`).
3. Rivales con refuerzos: ningún equipo del catálogo cubre 2 por rol; se declara en UI. Si el catálogo gana rosters completos, el núcleo crece solo.
4. Season Action Board sin «Continuar Road to Champions» (dedupe por tipo del motor compartido).
5. Sin logros propios de campaña (requeriría métricas nuevas en la autoridad del pase).
6. `startMatch` (partida rápida, previo a esta fase) no impide abrir una segunda partida PvE en paralelo; la campaña sí lo impide. Si un jugador abre una rápida con un nodo en marcha, `getActiveMatch` retoma la más reciente y el nodo queda abierto hasta abandonarlo o terminarlo.
7. El historial/repeticiones no etiqueta qué partidas fueron de campaña (el enlace vive en `campaign_attempts`, no en `duel_matches`).
8. NextUp añade una lectura acotada secuencial; el perfil propio una petición más.
9. Una partida de campaña retomada desde otra ruta sin `?campaign=` recupera contexto solo si su intento abierto está enlazado (reserva + enlace en la misma petición; si el enlace fallara, la reconciliación la abandona tras 2 min).

## 47. Migraciones creadas/no aplicadas

- **Creada: `0051_campaign_road_to_champions.sql` — LOCAL, NO APLICADA.** No se tocó `schema_migrations`.
- **Modificada (local, sigue sin aplicar): `0046_telemetry_flows_progression.sql`** (+ `'campaign'`).
- 0046, 0047, 0048, 0049, 0050: siguen sin aplicar. Sin Supabase local, sin Docker, sin producción.

## 48. Archivos creados/modificados

**Creados**
- Dominio: `src/domain/campaign/{types,difficulty,rewards,definition,opponent,progression,snapshot,index}.ts`
- Contenido: `src/data/roadToChampions.ts`
- Servidor: `src/server/services/campaign.ts`, `src/server/services/testing/memorySupabase.ts`, `src/app/api/game/campaign/route.ts`
- Cliente: `src/lib/campaign/{client,presentation,telemetry}.ts`
- UI: `src/components/campaign/{CampaignMap,NodeSheet,CampaignHero,CampaignPreMatch,CampaignResultBanner,CampaignProfileBadge}.tsx`, `src/components/modes/GameModesHub.tsx`
- Rutas: `src/app/jugar/page.tsx`, `src/app/jugar/road-to-champions/page.tsx`
- QA: `src/app/design-system/fase35/{page.tsx,fixtures.ts}`, `scripts/_fase35-visual-qa.ts`, `docs/product/qa/fase35/*.png` + `README.md`
- Pruebas: `src/domain/campaign/campaign.test.ts` (T1–T50), `src/server/services/campaign.service.test.ts` (T51–T74, T95–T99), `src/domain/campaign/campaign.contract.test.ts` (T75–T94, T100–T140)
- Verificador: `scripts/campaign-verify.ts`
- Migración: `supabase/migrations/0051_campaign_road_to_champions.sql` (local, no aplicada)
- Informe: `docs/product/fase-35-card-game-modes-2-road-to-champions-report.md`

**Modificados**
- `src/server/services/duels.ts` — `startMatch` → `createPveMatch` (mismo rival OPD-09), `startCampaignMatch`, `fixedOpponentDeck`, gancho `settleCampaignFor` tras persistir y pagar.
- `src/server/services/loop.ts` — paso `campaign` (play, 6.5) con `readCampaignSummary`.
- `src/server/services/rateLimit.ts` — cubetas `campaign_read`, `campaign_write`.
- `src/app/duelos/jugar/page.tsx` — `?campaign=`: pre-partida de nodo, lanzamiento por campaña, rival real en tablero, reconexión con contexto, `sync` al terminar, banner de nodo, «Cambiar rival o mazo» oculto en campaña.
- `src/app/page.tsx` — «Jugar» → `/jugar`.
- `src/design/nav.ts` — sección jugar → `/jugar` (+ «Modos de juego», «Pizarra» fuera del menú), barra móvil Jugar → `/jugar`.
- `src/lib/telemetry/contract.ts` — `/jugar*` → zona `duel_hub`.
- `src/app/jugador/[id]/page.tsx` — `CampaignProfileBadge` solo SELF.
- `src/app/globals.css` — `nx-node-pulse`, `nx-energy` (+ reduced motion).
- `supabase/migrations/0046_telemetry_flows_progression.sql` — + `'campaign'` (sigue sin aplicar).
- `package.json` — `campaign:verify`, `campaign-content:verify`, `campaign-security:verify`, `campaign-economy:verify`.
- Contratos actualizados con intención preservada: `src/components/duel/gameplay.contract.test.ts` (C6 home → `/jugar`), `src/domain/deckBuilder/deckBuilder.contract.test.ts` (máximo 0051, solo campaña), `src/domain/progression/meta.contract.test.ts` (hueco `extra` con banner previo), `src/domain/season/season.contract.test.ts` y `src/lib/duel/experience.contract.test.ts` (0051 solo de campaña, sin tablas de temporada/repeticiones).
- Memoria: `road-to-champions-fase35.md` + índice.
