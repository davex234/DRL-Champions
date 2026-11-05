# FASE 33 — MATCH EXPERIENCE 3.0 · Informe

Pre-partida + intro + tablero como escenario + resolución de turno + final + repetición, **sin tocar reglas**.
Fecha: 2026-09-15. Sin commit, sin push, sin deploy, sin Docker, sin VPS, sin migraciones aplicadas.

---

## 1. Estado inicial encontrado

- El brief daba 1735 tests tras la Fase 32. **Medido al empezar: 1861 tests, 1860 verdes, 1 rojo.**
- La diferencia se explica: una sesión anterior (14-09, 22:18–22:33) había empezado la Fase 33 y la dejó a
  medias, **sin informe, sin arnés y sin capturas**: `src/lib/duel/experience.ts` (dominio de presentación),
  `experience.test.ts` / `experience.contract.test.ts`, `experienceTelemetry.ts`, `qaSimulation.ts`,
  `lib/haptics.ts`, cuatro componentes en `components/duel/experience/`, integración en `MatchBoard`,
  `DuelMoment`, `MatchIntro`, `ResultScreen`, `PvpArena`, `PvpOutcome`, `ReplayViewer`, y correcciones en
  `matchView.ts`, `duels.ts#getReplay` y las rutas de duelo.
- El test rojo era un **falso positivo del propio contrato**: `!/fetch\(|Poller|usePvpSync/` sobre `PvpArena`,
  que importa legítimamente `turnRemainingMs` y el tipo `SyncState` de `pvpPoller` («Poller» en la ruta).
- Esta sesión **verificó** ese trabajo contra el código canónico, lo **midió** con un arnés visual nuevo y lo
  **completó/corrigió** (secciones 4 y 44).

## 2. Motor/reglas canónicas encontradas

Del código, no del brief:

| regla | fuente |
|---|---|
| Flujo `duel-turns-2`, `TURNS_PER_MATCH = 10` | `domain/cardgame/match/types.ts` |
| Atacante guardado EXPLÍCITAMENTE en la partida (`attacker`), alterna con `attacker: other(attacker)` | `match/orchestrator.ts` |
| Eje del defensor impuesto por la tabla `COMBAT_MATCHUP` (SH↔EF, GS↔GS) vía `requiredDefenderStat` | `domain/cards/combat.ts` |
| **Turno**: gana el valor mayor del eje enfrentado; a igualdad `TIE` y **nadie puntúa** (OPD-05 `NO_POINT`). **No hay desempate por turno.** | `combat/resolver.ts#resolveEncounter` |
| **Partida** (`duel-combat-2`): `SCORE` → si empate, suma de OVR de las 10 cartas que **sí da +1 punto** (`OVR_TIEBREAK`) → si empate, total de estadísticas declaradas **sin punto** (`STAT_MARGIN`) → si empate, `DRAW` (`NONE`) | `combat/resolver.ts#resolveCombat`, `rules.ts` |
| Rating: Elo 1000, K 40 provisional (<10 partidas) / 24; liquida `duel_pvp_settle_match` solo `mode='PVP'` | `domain/cardgame/rating`, `duelsPvp.ts#isSettleable` |
| Información oculta: `projectMatchFor` redacta el snapshot rival (solo jugadas + declarada) | `domain/cardgame/pvp/projection.ts` |

Consecuencia de diseño: el brief pedía «tiebreak por turno» (OVR/total en el turno). **No existe**. La
explicación de desempate se presenta **a nivel de partida** (paso a paso), y el turno empatado dice
«Empate a N: ningún jugador suma punto.».

## 3. Sistemas reutilizados

`MatchBoard` + arena (`ArenaSurface`, `HandFan`, `PlayedRow`, `ClashBanner`), `DuelCard`/`DuelCardBack`,
`DuelMoment`, `MatchIntro`, `ResultScreen`, `MatchSummary` (`FeaturedCardPanel`, `DecisionPanel`, `RoundStrip`),
`PvpArena`/`PvpLobby`/`PvpOutcome`/`PrivateDuelPanel`, `ReplayViewer`, `TurnHistory`, `HelpSheet`,
`SoundToggle` + `lib/sound#playCue` (Web Audio sintetizado), `usePvpSync`/`PvpSyncPoller` (sin bucles nuevos),
`buildMatchView`/`projectMatchFor`, `getReplay`, `MatchDetailView` (Fase 28), `ChallengeSheet` (Fase 29),
`Sheet` accesible de `deck/bits`, `lockCopy`/`connectionCopy`/`roundVerdict` de `gameplayUx`, `trackFlow`.

## 4. Qué has construido

**Heredado y verificado** (sesión previa): dominio `experience.ts`, HUD de turno, detalle de turno, relato
del resultado, `PreMatchVersus`, repetición 1.0 sobre hechos, corrección de perspectiva del jugador B,
repetición para A y B sin cartas no jugadas, errores 5xx enmascarados en `/api/game/duel` y PvP, vibración.

**Construido/corregido en esta sesión:**
- `derivePhase` **conectado de verdad** a la mesa (`MatchBoard` → `data-phase` + chip de fase); en PvP con el
  estado real del poller (`sync`), en PvE con `revealing`.
- `PHASE_LABEL` (rótulos) y `matchEndPresentation` (final) en el dominio puro.
- `MatchEndHero`: transición VICTORIA/DERROTA/EMPATE para PvP y privado (antes: titular plano y tabla).
- `ResultStory`: desempate **revelado paso a paso** (turnos → OVR → total), criterio decisivo marcado.
- `MatchHud` rehecho como **barra de una línea** + `TurnTimeline` separado (columna lateral en `xl`, bajo la
  mano en el resto): el HUD heredado sacaba la mano del pliegue (sección 44).
- Presupuesto vertical de la mesa recalibrado (`arenaVars`: 300 → 344 px fijos).
- Mano: la carta elegida sube y el resto **pierde énfasis**.
- `DuelMoment`: cartas protagonistas más grandes y sin frase duplicada.
- Rating ranked con rótulos **Antes → Después** y delta `+N / −N / 0` (sin «+0»).
- Pre-partida del **duelo privado** real: `PreMatchVersus` compacto dentro de `ChallengeSheet`.
- `/api/game/competitive` (historial y detalle de partida) ya no filtra textos internos en 5xx.
- `haptics.ts`: no vibra sin activación de usuario (evita errores de consola).
- Arnés `/design-system/fase33` (66 escenas) + `scripts/_fase33-visual-qa.ts` + capturas.
- Tests nuevos del dominio y contratos (sección 43).

## 5. Presentation state machine

`derivePhase(view, selección local, submitting, revealing, introOpen, sync)` → una de
`RECOVERING · OFFLINE · RESYNC · INTRO · SELECT_CARD · SELECT_STAT · CONFIRM · LOCKED · WAITING_RIVAL · REVEAL · FINISHED`.

Prioridad: **verdad del servidor** (sin vista → RECOVERING/OFFLINE; terminada/ciclo terminal → FINISHED;
`ERROR` → OFFLINE; `STALE` → RESYNC) → **lo que la pantalla enseña** (intro, revelación, jugada en vuelo) →
**lo que el jugador elige** (una selección que ya no está en la mano del servidor se ignora).
No es estado guardado (se recalcula en cada render; contrato «la fase no es estado guardado»), no bloquea
el poller, no toca versiones ni retrasa acciones. Mapeo al vocabulario del brief: PRE_MATCH = pantalla
previa; INTRO; TURN_PREPARE/PLAYER_SELECTION = SELECT_CARD/SELECT_STAT/CONFIRM; LOCKED; RIVAL_REVEAL = carta
declarada del rival en mesa; STAT_REVEAL/TURN_RESOLUTION/SCORE_UPDATE = REVEAL (`DuelMoment`); NEXT_TURN =
nueva vista; FINAL_TURN = cabecera; MATCH_RESULT/POST_MATCH = FINISHED + pantallas de resultado.

## 6. PreMatch 3.0

`PreMatchVersus`: **TU EQUIPO** (3 cartas protagonistas por OVR + resto en tira ligera `xs`) **VS** **RIVAL**
(10 reversos + identidad pública). PvE en `PreMatch` («Bot · Normal»), Ranked en `PvpLobby` («Rival por
rating»), Privado en `ChallengeSheet` (compacto, avatar + nombre del amigo). Sin 10 cartas pesadas, sin Card3D.
Textos fijados por e2e intactos («Preparación», «Fácil/Normal/Difícil», «Comenzar duelo»).

## 7. Hidden-information handling

- Nada nuevo pide datos: todo sale de `DuelMatchView` (ya redactada por `projectMatchFor` en PvP) o del mazo
  propio. `PreMatchVersus`/`MatchIntro`/`RivalHand` reciben **un número** de cartas rivales, no cartas.
- Tests 19–26: mazo oculto ausente del JSON de la vista; carta del rival sin declarar ausente; borrador de
  defensa del rival ausente; eje del rival solo tras declarar; la revelación expone exactamente una carta no
  jugada (la declarada); partida cerrada a medias sin lo no jugado; reconexión igual; repetición sin lo no
  jugado (también en servidor: `duelsReplay.service.test.ts`).
- No se usa `opacity:0` para esconder nada: lo oculto no está en los datos.

## 8. Match Intro

`MatchIntro`: «NEXUS DUEL · 10 turnos», TÚ (mazo + Σ OVR) VS RIVAL (dificultad o nombre del amigo), quién
abre, reversos del rival y tu mano. Dura `INTRO_MS.full = 1600 ms` (reducido 500 ms), **Saltar** (botón 44 px,
clic fuera, Esc/Enter/Espacio). Solo al entrar en una partida recién creada; al reconectar no se repite.

## 9. Battle Board

Jerarquía: barra de turno (HUD) → mesa (canto con turno y pista · banda rival con mano boca abajo y jugadas ·
**zona de duelo** con marcadores de flanco, carta rival, placa VS con ejes y cifras, tu carta · tu banda) →
controles (instrucción, cerrojo, ejes, confirmar) → mano en bandeja → línea de turnos. En `xl`, columna lateral
con línea de turnos 5×2 e historial. A 1440×900, en el arnés (que lleva encima la barra de la app y la franja QA,
~115 px), la mano vuelve a asomar en el pliegue; con el HUD heredado quedaba entera por debajo. La ruta real
`/duelos/jugar` es inmersiva (barra de 56 px), así que allí sobra más alto.

## 10. Turn header / attack–defense

`MatchHud`: «TURNO N DE 10» + chip **▲ ATACAS** (verde) / **▼ DEFIENDES** (rojo) + filo de color del rol +
chip de fase + «ÚLTIMO TURNO» (oro) + marcador. El rol sale de `view.youAreAttacker` (del orquestador, que
guarda `attacker`); nunca de par/impar.

## 11. Axis presentation

Atacando: los tres ejes reales (`STAT_ORDER` = stronghold, gamesense, entryfrag) como botones SH/GS/EF con la
cifra de la carta elegida. Defendiendo: «EL RIVAL ATACA CON GAMESENSE · RESPONDES CON GAMESENSE» con
`pendingRival.stat` y `requiredStat` del servidor; no hay botones de eje. Si el rival no ha declarado:
«EL RIVAL ESTÁ ELIGIENDO SU ATAQUE» (sin inferir).

## 12. Card selection / action lock

Elegir carta: sube, se ilumina y el resto de la mano baja al 55 % de opacidad; aparece la cifra en la placa
central y el CTA («Declarar y atacar» / «Responder»). Al enviar: `lockCopy` → «Resolviendo…» y chip
**CARTA BLOQUEADA**; mano, ejes y botón `disabled`, `aria-busy`; `inFlight` impide doble envío (PvE) y
`busy`/`tuTurno` (PvP). Rechazo → se suelta; `STALE` → se suelta y se resincroniza (`releaseAction`, tests 29–32).

## 13. Waiting / network states

PvP sin tu turno: chip **ESPERANDO AL RIVAL**, botón «Esperando al rival…», «El rival está decidiendo…».
Conexión (`connectionCopy`): «Recuperando la partida…», «Reconectando… la partida sigue en el servidor», «Sin
conexión. Se reintenta solo…». Conflicto de versión: aviso de resincronización + chip RESINCRONIZANDO. Sin
spinner gigante.

## 14. Rival reveal

La carta rival solo aparece cuando el servidor la manda (`pendingRival`, al declarar él): cae en su hueco de
la zona de duelo (reverso → carta con entrada 400 ms) con su eje y cifra en la placa. En la revelación del
turno (`DuelMoment`) entran las dos cartas desde su lado (0 ms) → eje y cifras (260 ms) → comparación
(520 ms) → veredicto (760 ms).

## 15. Card VS Card

`DuelMoment`: rival arriba, tú abajo (mismo mapa que la mesa), cartas 92/124/140 px según ancho, VS central
con el tono del ganador, sello «GANA» junto a la cifra ganadora, perdedor apagado (no escondido).

## 16. Stat reveal

Nombre real del eje + cifra grande por bando, secuencial y rápido. Sin ruleta ni números subiendo: las
cifras son las del turno resuelto (`turn.you.value`, `turn.rival.value`).

## 17. Turn resolution

Titular **PUNTO PARA TI / PUNTO PARA EL RIVAL / EMPATE** (`TURN_HEADLINE`, del `outcome` del servidor) +
explicación (`explainTurn`): «Tu Entryfrag 99 supera a Stronghold 78 del rival.» · «Gamesense 88 del rival
supera a tu Gamesense 70.» · «Empate a 80: ningún jugador suma punto.». Si las cifras no cuadran con el
resultado o faltan: **«Turno resuelto por el servidor.»** (no se adivina). Marcador tras el turno =
`scoreAfterYou/Rival` guardado por el orquestador.

## 18. Tiebreak explanation

`decisionSteps(result)` solo con los pasos aplicados (`decidedBy`): SCORE → [turnos]; OVR_TIEBREAK →
[turnos empatados (marcador final − 1 punto del desempate), suma OVR «desempata y da un punto»];
STAT_MARGIN → [turnos, OVR empatado, total «sin punto adicional»]; NONE → [todo empatado, «Empate total.
Ningún jugador suma punto.»]. `ResultStory` los revela uno tras otro (≈0,45 s) y marca el decisivo; con
movimiento reducido aparecen ya puestos. Cifras ausentes → «—»/«Sin dato».

## 19. Scoreboard

Siempre visible: HUD (≥ sm), canto de la mesa (móvil) y marcadores de flanco (≥ lg). Pulso de escala al
cambiar (clave por valor). Durante la partida `scoreA/B` del orquestador; al terminar, el del resolver (incluye
el punto del desempate OVR). `aria-live="polite"` solo en el marcador del HUD.

## 20. Turn timeline

`buildTimeline`: 10 casillas (`totalTurns`), glifo + palabra + color: ● ganado · ○ perdido · — empate ·
◆ en juego · · pendiente; rol (atacaste/defendiste) solo en jugados y el actual. Botones `min-h-[44px]` con
`aria-label` completo; lo futuro, deshabilitado y sin datos. Leyenda visible.

## 21. Turn detail

`TurnDetailSheet` (hoja accesible, Esc, foco): quién atacó, titular, explicación, tu carta y la del rival (ya
revelada al jugarse) con eje y cifra, «Gana el turno», marcador tras el turno. Solo turnos jugados
(`turnDetail` → `null` para actual/futuro). Solo lectura.

## 22. Final-turn / match-point behavior

Turno 10: chip **ÚLTIMO TURNO** oro y borde dorado del HUD; en la revelación, «· último turno».
**Punto de partida** (derivable y probado): con `after = total − turno`, asegurado si `a > b + after + 1`;
punto de partida de A si no asegurado y `a + 1 > b + after` (ganar este turno deja ventaja inalcanzable por
marcador; el OVR solo actúa a igualdad). `BOTH` («TURNO DECISIVO») solo en el último turno empatado. Sin
dramatismo inventado cuando no se cumple.

## 23. Match end

PvE: la revelación del último turno se ve y al cerrarla entra `ResultScreen` (titular con impacto, sala teñida,
corona solo en victoria). PvP/privado: `MatchEndHero` — veredicto con escala/tracking y barrido de energía
(0,9 s, un nodo), marcador (final, o **al cierre** si fue abandono/tiempo), causa y **último turno contado**.
Veredicto: del resultado del resolver, `closedBySide` o el asiento de rating (decidido en la página).

## 24. Match Summary 3.0

Resultado + marcador + causa · cómo se decidió (paso a paso) · carta de la partida · recompensa (PvE) · nivel
(XP del servidor) · objetivos del meta (Fase 27) · línea de 10 turnos con recuento ganados/perdidos/empatados
· turno a turno con miniaturas · cartas jugadas. CTAs reales: PvE **Revancha · Cambiar rival o mazo · Ver la
partida · Mis mazos · Salir a Duelos**; Ranked **Buscar otro rival · Volver a Duelos · Ver la partida · Ver la
escalera**; Privado **Revancha (reto nuevo) · Social · Perfil · Otro reto** + Ver la partida.

## 25. Ranked rating presentation

Solo `mode='PVP'`. **Antes → Después** y delta `+N / −N / 0` del asiento real `duel_pvp_rating_events`
(`GET …/pvp?outcome=1`). Sin asiento aún: «Calculando el rating…» (no se inventa). Provisional: se detecta por
el **K del asiento** (`kFactor === 40`), semántica de la Fase 28, sin «placement». Escalera: posición y
puestos ganados/perdidos solo con dos fotos del servidor.

## 26. Rewards presentation

Solo `result.award` del servidor (PvE; `null` en PvP). Créditos, XP y puntos de rango tal cual; «Abonada
automáticamente al terminar» — **sin botón Reclamar** (el servidor abona). PvP/privado: «Los duelos PvP no dan
créditos ni XP.». Sin award: «Recompensa no disponible.».

## 27. MVP / Card of the Match

Viable con hechos persistidos (cada `DuelTurn` guarda `encounter` con carta, eje, valor y resultado).
`cardOfTheMatch(history)` — **algoritmo exacto**:
0. Cada carta juega UNA vez por partida ⇒ suma como mucho 1 punto; solo compiten las cartas que **ganaron** su
   turno (y cuyo resultado cuadra con sus cifras). Si ninguna ganó → **no hay carta de la partida** (se dice).
1. mayor margen en el eje enfrentado; 2. mayor valor propio; 3. turno más temprano; 4. `uid` (estable).
Rótulo «CARTA DESTACADA», nunca «MVP» (contrato). No da créditos, XP ni mejora (test 54).

## 28. Replay 1.0

`buildReplayTimeline(replay)` → `ReplayFrame[]` desde los turnos persistidos (`duel_matches.state.turns` →
`toTurnView`): número, atacante, cartas, eje, cifras, explicación, resultado, marcador después y, en el último
fotograma, cómo se decidió. **No re-ejecuta el motor** (test 57 prohíbe importar match/combat/opponent).
Parcial (terminó antes, huecos, cartas ausentes) → «Repetición parcial. …»; sin turnos → «Detalle no
disponible para esta partida.». Controles: primero/anterior/**reproducir-pausar**/siguiente/último, 1x/2x,
saltar a cualquier turno, teclado ← → Inicio Fin Espacio. **Sin 0051**: la persistencia actual basta.

## 29. Match History integration

Historial competitivo → `/duelos/competitivo/partida/[id]` (Fase 28) → **«Ver la partida →»** →
`/duelos/replay/[id]`. También desde `PvpOutcome` y `ResultScreen`. Acceso: solo participantes (404 al
resto, `or(user_id, player_b_id)` con el `userId` del token); PvE solo su dueño; no se hizo público ningún
replay. En curso → 409 «La partida aún no ha terminado».

## 30. Reconnect / resync

PvE: `boot` pide la partida activa y pinta el estado del servidor («Partida recuperada desde el servidor:
turno N de 10, marcador X–Y»), sin intro ni animaciones antiguas. PvP: la primera foto tras entrar/reconectar
NO anima (`planReveals(null, …)`); si llegan varios turnos de golpe se revela **solo el último** (cola acotada,
`MAX_QUEUED_REVEALS = 1`). Nada de «frame 37»: solo se cuenta cuántos turnos se vieron en memoria de pantalla.
`STALE_VERSION` → mensaje «La partida avanzó mientras decidías…», `syncNow()`, fase RESYNC; nunca fatal.

## 31. Timeout

Solo con plazo del servidor (`turnDeadlineAt` + `serverOffset`): reloj «Tu tiempo / Tiempo del rival»,
urgente ≤ 15 s. Vencido: «El tiempo del rival se agotó. El servidor está cerrando el turno…» — no se declara
nada. PvE no tiene plazo y no enseña reloj.

## 32. PvE

Misma mesa, HUD, fase, revelación y final. Bots (`opponent/*`), dificultades Fácil/Normal/Difícil y
coeficientes **sin tocar** (tests 78/104). Recompensa del servidor. Sin sondeo: cada petición nace de una acción.

## 33. Ranked / PvP

`PvpArena` sobre `MatchBoard` con `sync` real del poller; intro solo en partida nueva; revelación del turno
recién resuelto; reloj del servidor; abandono con confirmación; final con `MatchEndHero`, rating y escalera.
Sin segundo bucle de red (contrato: ≤ 1 `setInterval` visual, sin `fetch` en la arena).

## 34. PVP_PRIVATE

Misma arena y reconexión; rótulo «Duelo privado · sin rating» con el rival; pre-partida en el reto; final sin
rating ni escalera, con cara a cara y Revancha como reto nuevo. **No liquida** (doble red `isSettleable` +
RPC; test 79). `ratingPresentation("PVP_PRIVATE")` → «Duelo privado: no mueve el rating.».

## 35. Sound / haptics

Reutiliza `SoundToggle` + `playCue` (Web Audio sintetizado, sin assets, respeta `isMuted`): `ui` al elegir,
`whoosh` al bloquear e intro, `round_win/round_lose` al veredicto del turno (sincronizado con su aparición),
`match_point`, `victory/defeat` al final. `primeAudio()` al primer gesto (autoplay). Vibración (`lib/haptics`):
mejora progresiva, pulsos ≤ 60 ms, **solo** si hay `navigator.vibrate`, activación de usuario previa, no
silenciado y sin movimiento reducido.

## 36. Visual effects / performance

CSS/DOM y framer-motion; sin canvas/WebGL nuevos. Efectos: glow de bando, sala teñida, barrido de energía de
un nodo, pulso de marcador, sello GANA, filo de rol. `DuelCard` ligero en toda la partida; **ninguna Card3D**
en la arena (máximo 2 cartas grandes en la revelación). Sin bucles infinitos de animación.

## 37. Responsive / mobile / tablet

390: HUD de 2 líneas (marcador en el canto de la mesa), zona de duelo con cartas ×1,9, comparación de ejes
bajo la zona, controles apilados, mano en carril con snap horizontal, línea de 10 turnos al final;
revelación con dos cartas protagonistas; resultado y repetición a una columna. 1024: mesa central grande,
línea de turnos bajo la mano. 1440: mesa centrada + columna lateral (turnos 5×2 + historial). Desbordamiento
horizontal medido por el script en cada captura (sección 42).

## 38. Accessibility / reduced motion

Cartas y ejes son botones con nombre; flujo de teclado capturado (Tab hasta la mano → Enter → ejes). Resultado
textual (VICTORIA/DERROTA/EMPATE, PUNTO PARA TI…), glifo+palabra en la línea de turnos, marcador con
`aria-live="polite"` sin spam, hojas con Esc y foco, 44 px en controles táctiles de la línea de turnos y la
repetición, `focus-visible`, repetición con teclado. `prefers-reduced-motion`: `MotionConfig reducedMotion="user"`
en arena y arnés; intro 500 ms; revelación por fundido (tiempos a 0); resultado y pasos del desempate ya
puestos; mano sin transiciones (`motion-reduce`); sin vibración. Sin flashes.

## 39. Read models / API / projections

Sin filas crudas: `DuelMatchView` (proyección por bando), `DuelResultView`, `DuelReplay` (turnos en
perspectiva, `rivalCards` = solo jugadas, `mode`, `rivalName`), `CompetitiveMatchDetail`, `PvpMatchSnapshot`.
Proyección según espectador (`side`), modo (PvE sin redactar el propio; PvP con `projectMatchFor`), estado y
terminada. La presentación (`experience.ts`) es una capa pura sobre esas vistas (equivalente a
`MatchExperienceSnapshot`/`ReplaySnapshot` sin crear un tercer DTO).

## 40. Security / privacy

Usuario del token (`getSession`), `userId/side/playerId` del cuerpo ignorados; cuerpos validados campo a campo
(UUID, `STATS`); el cliente no manda ganador, rating, recompensa ni eje del defensor (`requiredDefenderStat`
en servidor); repetición/detalle solo participantes; sin clave de servicio en cliente; 5xx genéricos en
`/api/game/duel`, `/api/game/duel/pvp` y ahora `/api/game/competitive`. Tests 87–96b + servicio de repetición
contra Supabase en memoria.

## 41. Telemetry

8 contextos (`match_intro_view, turn_card_select, turn_lock, turn_reveal, turn_result_view, match_result_view,
replay_open, rematch_click`) en `experienceTelemetry.ts` sobre el flujo `duel_play`. **0046 sin aplicar** y el
contrato `FLOWS` sigue con 4 flujos ⇒ `trackExperience` es **no-op honesto** (test). No se tocó `DUEL_CONTEXTS`.

## 42. QA visual

`docs/product/qa/fase33/` — **145 capturas** a 1440/1024/390 (76 entradas: los 70 escenarios del brief + punto de
partida, evento de rating pendiente, rating PvP en rutas reales, historial→partida, arena privada e intro PvP)
sobre 66 escenas del arnés + 3 rutas reales. README con tabla, fase medida (`data-phase`), desbordamiento horizontal
y errores de consola: **0 desbordes, 0 errores de consola propios** (antes del arreglo de vibración: 11).
Fallos del INSTRUMENTO encontrados y corregidos (no del producto): intros fotografiadas bajo el fundido del
`HydrationGate` (asentamiento 1,5 → 2,8 s) y flujo de teclado que se perdía en los menús del armazón del arnés
(ahora: emulación de foco, Enter elige carta, Shift+Tab + Enter elige eje, Tab al botón → fase `CONFIRM` medida). Escenas interactuadas de
verdad: elegir carta/eje, abrir detalle de turno, flujo de teclado, silenciar. Casos que las semillas no dan
se fabrican con la forma de `DuelResultView` y lo dicen en pantalla (franja «QA SYNTHETIC · … fabricado»).
Rutas reales sin sesión (`/duelos/jugar`, `/duelos`, `/duelos/pvp`): smoke. Mapa brief → captura en el README.

## 43. Tests / gates

| gate | resultado |
|---|---|
| `npm test` (node:test, 1 proceso por fichero) | **1870 / 1870 verdes**, 0 fallos, 0 cancelados (inicio de sesión: 1860/1861) |
| typecheck web (`tsc --noEmit`) | **0 errores** |
| typecheck scripts (`tsc -p tsconfig.scripts.json`) | **0 errores** |
| `next build` | **exit 0** |
| ESLint (`ESLINT_USE_FLAT_CONFIG=false npx eslint` sobre todo lo tocado; `npm run lint` está roto con Next 16) | **0 problemas** |
| `security:verify` | 201 ✓ / 0 ✗ |
| `pack:verify` | 42 ✓ / 0 ✗ |
| `content:verify` | 21 ✓ / 0 ✗ |
| `distribution:verify` | 30 ✓ / 0 ✗ |
| `competitive:verify` | 27 ✓ / 0 ✗ |
| `importer-vlr:verify` | 69 ✓ / 0 ✗ |
| `combat:verify` | 5 ✓ / 0 ✗ |
| `deck:verify` | 34 ✓ / 0 ✗ |
| `social:verify` | 33 ✓ / 0 ✗ |
| `replay:verify` | 25 ✓ / 0 ✗ |
| `pvp-arena:verify`, `pvp-sync:verify`, `duel:e2e`, `duel:shots` | **NO EJECUTADO — REQUIERE BD DE PRUEBAS** |

Cobertura del brief (ficheros): **presentación 1–10, explicación 11–18, información oculta 19–26, selección 27–33,
marcador/línea 34–41, resultado 42–50, carta de la partida 51–55, repetición 56–63 y 65, reconexión 66–73,
modos 74–77** en `src/lib/duel/experience.test.ts`; **64 y 87** (privado solo participantes, sin acceso ajeno),
26/65 en servidor y errores en `src/server/services/duelsReplay.service.test.ts` (Supabase en memoria);
**78–86, 88–96, 96b, 97–125** y fronteras (sin segundo motor, sin doble sondeo, QA aislada, telemetría cerrada,
fase derivada en la mesa, final PvP, pre-partida privada) en `src/lib/duel/experience.contract.test.ts`.
Regresión adicional: `duel.test.ts` (invariantes de UI_FILES/PVP_UI), `gameplay.contract.test.ts`,
`arena.behavior.test.ts`, `social.contract.test.ts`, `competitive.contract.test.ts`, `deckBuilder.contract.test.ts`,
`resolver.test.ts`, `match.test.ts`, `opponent.test.ts`, `pvp.test.ts`, `pvpPoller.test.ts` — todos verdes.
Nuevos en esta sesión (+9): rótulos de fase, prioridad servidor>revelación, final con marcador del resolver,
final a medias «al cierre», final sin datos y veredicto que no toca el marcador, fase derivada en la mesa,
héroe final PvP, pre-partida privada, 96b.

## 44. Bugs reales encontrados/corregidos

| # | bug | dónde | estado |
|---|---|---|---|
| 1 | Jugador **B** de PvP veía sus turnos ganados como perdidos (`attacker/outcome` absolutos) | `matchView.ts#toTurnView` | corregido (sesión previa) · verificado test 76 |
| 2 | **Fuga de privacidad**: `getReplay` enviaba el snapshot rival ENTERO (cartas no jugadas) y solo servía a A | `duels.ts#getReplay` | corregido (previa) · verificado `duelsReplay.service.test.ts` |
| 3 | Textos internos (Supabase) en 5xx de `/api/game/duel` y PvP | rutas | corregido (previa) · test 96 |
| 4 | Textos internos en 5xx de `/api/game/competitive` (historial/detalle de partida) | ruta competitiva | **corregido aquí** · test 96b |
| 5 | El HUD heredado (con línea de turnos dentro) sacaba **la mano del pliegue** a 1440×900 y ocupaba ~180 px en móvil | `MatchHud`, `arenaVars` | **corregido aquí** (barra + `TurnTimeline` fuera + 344 px) · capturas |
| 6 | `navigator.vibrate` sin gesto previo → error de consola en revelación PvP por sondeo y resultado al reconectar | `lib/haptics.ts` | **corregido aquí** · 11 → 0 errores en QA |
| 7 | Final PvP saltaba directamente a una tabla (sin transición ni último turno) | `PvpOutcome` | **corregido aquí** (`MatchEndHero`) |
| 8 | `derivePhase` existía y estaba testado pero **ninguna pantalla lo usaba** | `MatchBoard` | **conectado aquí** |
| 9 | Contrato «sin doble sondeo» daba falso positivo | `experience.contract.test.ts` | **corregido aquí** |

## 45. P2 reales

- **DB-backed sin ejecutar**: `pvp-arena:verify`, `pvp-sync:verify`, `duel:e2e`, `duel:shots` — **NO EJECUTADO — REQUIERE BD DE PRUEBAS** (Supabase local no existe; Docker prohibido).
- En móvil la mesa conserva las filas de cartas jugadas (Fase 8): para llegar a la mano hay scroll; un modo
  «solo enfrentamiento» en móvil cambiaría la arena de las Fases 8/26 y sus verificadores.
- La revelación del **último** turno PvP no se enseña como `DuelMoment` (la página pasa a resultado en cuanto
  el servidor dice terminal y la página PvP no admite temporizadores por contrato); se cuenta en `MatchEndHero`.
- Lista de repeticiones (`listReplays`) sigue siendo solo PvE del jugador A; las PvP se abren desde historial
  competitivo, resultado o detalle.
- Telemetría de la experiencia no-op hasta aplicar 0046 y abrir `FLOWS`.
- `duels.ts`/`duelsPvp.ts`/`competitive.ts` siguen construyendo `fail(500, error.message)` internamente; las
  tres rutas lo enmascaran, pero un consumidor futuro directo del servicio lo vería.
- La intro PvP muestra el nombre del amigo solo en privado; en ranked la identidad pública del rival no viaja
  en el snapshot (sería un cambio de contrato de la cola).

## 46. Migraciones creadas/no aplicadas

**Ninguna creada** (no hay 0051; test lo fija). 0046, 0047, 0048, 0049, 0050 siguen **sin aplicar** (tests
121–125 leen la cabecera «NO APLICADA»). No se tocó `schema_migrations`. Sin Supabase local, sin Docker, sin VPS.

## 47. Archivos creados/modificados

(«previa» = sesión anterior de la fase, verificada aquí; sin marca = esta sesión.)

**Creados**
- `src/lib/duel/experience.ts` (previa; + `PHASE_LABEL`, `matchEndPresentation`, `mode` opcional)
- `src/lib/duel/experience.test.ts` (previa; + 5 tests) · `src/lib/duel/experience.contract.test.ts` (previa; regex corregida + 4 tests)
- `src/lib/duel/experienceTelemetry.ts` (previa) · `src/lib/duel/qaSimulation.ts` (previa) · `src/lib/haptics.ts` (previa; + activación de usuario)
- `src/components/duel/experience/MatchHud.tsx` (previa; rehecho: barra + `TurnTimeline`)
- `src/components/duel/experience/TurnDetailSheet.tsx` (previa) · `ResultStory.tsx` (previa; + pasos escalonados) · `PreMatchVersus.tsx` (previa; + `compact`)
- `src/components/duel/experience/MatchEndHero.tsx`
- `src/server/services/duelsReplay.service.test.ts` (previa)
- `src/app/design-system/fase33/page.tsx`
- `scripts/_fase33-visual-qa.ts`
- `docs/product/qa/fase33/` (145 PNG + `README.md`)
- `docs/product/fase-33-match-experience-3-report.md`

**Modificados**
- `src/lib/duel/matchView.ts` (previa: perspectiva de `toTurnView`) · `src/lib/duel/types.ts` (previa: `DuelReplay.mode/rivalName`, doc) · `src/lib/duel/duel.test.ts` (UI_FILES)
- `src/server/services/duels.ts` (previa: `getReplay`) · `src/server/services/duelsPvp.ts` (previa: rechazos humanizados)
- `src/app/api/game/duel/route.ts`, `src/app/api/game/duel/pvp/route.ts` (previa: 5xx genéricos) · `src/app/api/game/competitive/route.ts` (5xx genéricos)
- `src/app/duelos/jugar/page.tsx` (`revealing`) · `src/app/duelos/replay/[matchId]/page.tsx` (previa: 404/409 como estados)
- `src/components/duel/MatchBoard.tsx` (previa: HUD; aquí: `derivePhase`, `sync`, `revealing`, `TurnTimeline`)
- `src/components/duel/DuelMoment.tsx` (previa: titular/explicación; aquí: tamaño y sin duplicado) · `MatchIntro.tsx` (previa) · `ResultScreen.tsx` (previa) · `MatchSummary.tsx` (previa) · `PreMatch.tsx` (previa) · `ReplayViewer.tsx` (previa)
- `src/components/duel/arena/HandFan.tsx` (énfasis de selección) · `src/components/duel/arena/ArenaSurface.tsx` (presupuesto 344 px)
- `src/components/duel/pvp/PvpArena.tsx` (previa: intro/revelación/avisos; aquí: `sync`/`revealing`) · `PvpLobby.tsx` (previa) · `PvpOutcome.tsx` (`MatchEndHero`, rating Antes/Después)
- `src/components/social/ChallengeSheet.tsx` (pre-partida privada) · `src/components/competitive/MatchDetailView.tsx` (previa: «Ver la partida»)

Motor, reglas, bots, matchmaking, rating, liquidación, recompensas, mazos, colección, perfil, social (servicios),
Pick'ems, Live Events, progresión, sobres, marketplace, worker y migraciones: **sin tocar** (tests 97–125).

---

**FASE 33 — CERRADA** (con los P2 de la sección 45; las verificaciones con base de datos quedan NO EJECUTADAS por requerir BD de pruebas).
