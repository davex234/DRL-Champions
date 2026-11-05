# FASE 26 — CORE GAMEPLAY 2.0 · Duel Arena + Match Flow + experiencia de juego de cartas táctico

**Estado:** completada (con deudas documentadas) · **Fecha:** 2026-09-14 · **Rama:** `arch/stabilization` · **Sin commit/push/deploy** · **Sin VPS, cron, worker, 0045, Pick'ems, Team Packs, OVR, economía, XP, importador VLR ni RNG de sobres** · **Marketplace OFF (`GLOBAL_MARKET_ENABLED=false`)** · **Motor, balance y reglas INTACTOS** · **Datos reales; fixtures solo QA SYNTHETIC en el arnés**.

> Regla de la fase: el servidor decide (turno, carta rival, veredicto, marcador, desempate, timeout,
> resultado, recompensa, rating); el cliente presenta. Todo lo que aquí se añade son capas de
> PRESENTACIÓN sobre los DTO que ya viajaban (`DuelMatchView`, `PvpSyncResponse`) y ayudantes
> puros que los traducen. No hay motor nuevo, ni reglas nuevas, ni balance nuevo.

## 1. Estado inicial encontrado

- **Motor** (`domain/cardgame`): `duel-turns-2`, 10 turnos, atacante alterna; atacante elige carta+eje,
  defensor responde con el eje que impone la tabla (`requiredDefenderStat`, nunca lo manda el
  cliente); reglas `duel-combat-2`: SCORE → OVR_TIEBREAK (otorga un punto) → STAT_MARGIN (sin punto)
  → DRAW. Empate de turno = `TIE`, nadie puntúa. Bots EASY 0 / NORMAL 0.5 / HARD 0.85 de heurística,
  ninguno con información perfecta. Sin racha ni momentum en ningún sitio.
- **Servidor**: `POST /api/game/duel` (`start|play|state|active|replay|replays|abandon`), proyección
  `toPublicView → buildMatchView` (solo cartas jugadas del rival + recuento + la declarada), recompensa
  PvE por `awardMatchOutcome` con ref `duel:<matchId>` y tope diario; PvP: `/api/game/duel/pvp` con
  `actionId` idempotente, `expectedVersion` (409 `STALE_VERSION`), `PVP_TURN_MS=90 s` con vencimiento
  decidido por Postgres (`duel_pvp_expire_turn`), liquidación de rating una sola vez, `outcome=1`
  para leer el delta; matchmaking por rating con ventana creciente. **Sin acción de revancha PvP.**
- **Interfaz**: `/duelos` (hub con tres puertas y «Continuar»), `/duelos/jugar` (una página con
  `Lobby` interno que SOLO listaba mazos legales, sin intro, `MatchBoard` con mesa/zonas/mano/
  `ClashBanner`, `DuelMoment` de cuatro tiempos, `ResultScreen` con recompensa del servidor,
  `TurnHistory`), `/duelos/pvp` (`PvpLobby` → `PvpArena` reutilizando `MatchBoard` → `PvpOutcome`),
  `FullscreenToggle`, `MotionConfig reducedMotion="user"`. **Sin ayuda «?», sin silencio, sin intro,
  sin explicación del mazo inválido, sin carta destacada, sin nivel, sin historial en miniatura, sin
  estado de conexión en PvP, sin telemetría de partida.**
- **Audio**: `lib/sound.ts` (Web Audio, `isMuted/setMuted` sin interruptor en ninguna pantalla).
- **Telemetría**: taxonomía CERRADA por `CHECK` (0029): 4 eventos, 4 flujos; **no existe flujo de duelo**.
- **Verificadores que fijan textos**: `duel:e2e`, `duel:shots`, `duel:playtest`, `pvp-arena:verify`
  leen «Preparación», «Fácil/Normal/Difícil», «Comenzar duelo», «Continuar», `SH|GS|EF`,
  «Resolviendo…», `aria-live={apremia && tuTurno ? "assertive" : "off"}`, `snap?.isYourTurn`,
  `no decide nada`, `<FullscreenToggle`, `min-h-[52px]`. Ninguno cambia.

## 2. Qué se reutilizó

`MatchBoard`, `ArenaSurface`/`HandFan`/`PlayedRow`/`ClashBanner`, `DuelCard`, `DuelMoment`,
`TurnHistory`, `TurnTrack`, `FullscreenToggle`, `ResultScreen` (ampliado), `PvpArena`/`PvpLobby`/
`PvpOutcome` (ampliados), `usePvpSync`/`usePvpQueue`/`pvpPoller` (sin tocar), `buildMatchView`,
`lib/sound`, `levelFromXp` (progresión), `fetchGameState` (XP total del servidor), taxonomía de
telemetría (sin ampliar), `scripts/lib/cdp.ts`, patrón de arnés QA de la Fase 25.

## 3. Qué se construyó

| Pieza | Fichero | Qué hace |
|---|---|---|
| Ayudantes puros | `src/lib/duel/gameplayUx.ts` | `deckReadiness`, `pickStartableDeck`, `roundVerdict`, `lockCopy`, `decisionCopy`, `featuredCard`, `roundTally`, `introCopy/introDuration`, `connectionCopy`, `mmss` |
| Telemetría | `src/lib/duel/telemetry.ts` | 7 contextos (`match_start`…`reconnect`), `trackDuel` con puerta `isFlow` (no-op mientras la taxonomía no tenga flujo de duelo) |
| Pre-partida | `src/components/duel/PreMatch.tsx` | todos los mazos con estado del servidor, roles que faltan, «Completar equipo», rival, reglas, «?» |
| Intro | `src/components/duel/MatchIntro.tsx` | VS con nombres y Σ OVR, quién abre, tu mano; saltable; 1,6 s / 0,5 s con reduced-motion |
| Ayuda | `src/components/duel/HelpSheet.tsx` | hoja inferior en móvil / diálogo en escritorio; reglas, tres estadísticas, PvE/PvP; Escape |
| Silencio | `src/components/duel/SoundToggle.tsx` | interruptor de `setMuted/isMuted` en el cromo (PvE y PvP) |
| Final | `src/components/duel/MatchSummary.tsx` | `FeaturedCardPanel` («CARTA DESTACADA»), `DecisionPanel` (desempate), `RoundStrip` (miniaturas), `LevelProgressPanel` (XP servidor + curva) |
| Arena | `MatchBoard.tsx` | cerrojo de jugada (`lockCopy`): mano, ejes y botón bloqueados en vuelo / turno rival; `waitingRival`; telemetría |
| Revelación | `DuelMoment.tsx` | veredicto con nombres reales («Stronghold 78 contra Gamesense 71»), nota de empate |
| Resultado | `ResultScreen.tsx` | carta destacada, desempate explicado, historial en miniatura, nivel, REVANCHA / cambiar / ver / salir |
| Página PvE | `src/app/duelos/jugar/page.tsx` | etapas `prematch → intro → match → result`; reconexión con aviso; revancha directa; XP del servidor; «?» y silencio en la barra |
| PvP | `PvpArena.tsx`, `PvpOutcome.tsx`, `pvp/page.tsx` | estado de conexión, «Esperando al rival…», ayuda, silencio, carta destacada, desempate, miniaturas, telemetría |
| Entrada | `src/app/page.tsx`, `src/app/duelos/page.tsx` | CTA «Jugar» / «Completar equipo» según mazos reales; copy del hub |
| QA | `src/app/design-system/fase26/page.tsx` + `scripts/_fase26-visual-qa.ts` | arnés QA SYNTHETIC (motor real en navegador sobre cartas reales, `buildMatchView`) + capturas 1440/1024/390 |
| Tests | `gameplayUx.test.ts` (16), `telemetry.test.ts` (4), `gameplay.contract.test.ts` (34), `duel.test.ts` (UI_FILES +5) | dominio de pantalla, flujo, PvP, UX, regresión |
| Corrección real | `src/lib/duel/matchView.ts` | `rivalRemaining` en PvP: el snapshot rival llega redactado y la mesa decía «Rival · 1 carta» con un solo reverso; ahora `DUEL_DECK_SIZE − jugadas` (encontrado en el arnés, test D6) |

## 4. Entrada al modo (home y hub)

Home: `Jugar` (mazo legal) · `Completar equipo` → `/duelos/mazos?deck=<id>` (hay mazos, ninguno
legal) · `Construir mi mazo` (sin mazos) · `Entrar para jugar` (sin sesión) · `Abrir tus sobres`
(sin cartas y con sobres). Hub `/duelos`: la puerta «Nuevo duelo» dice «Completa tu equipo…» cuando
no hay mazo listo. Todo sale de `fetchDuelDecks` (`valid` del servidor).

## 5. Pre-partida

`PreMatch`: lista TODOS los mazos (antes se ocultaban los ilegales), cada uno con `Listo`/
`Incompleto`, huecos punteados hasta 10 y la frase de `deckReadiness` («Faltan 1 Duelista y 2
Centinelas», del `missingByRole` del servidor, en el orden de `DUEL_ROLES`). Con un mazo inválido
elegido: aviso «No puedes empezar con «X»», chips por rol, botón **Completar equipo** y «Comenzar
duelo» deshabilitado (`canStart`). Rival: Fácil/Normal/Difícil con `DIFFICULTY_INFO` (sin
porcentajes), nota «ningún nivel ve tus cartas». Reglas en tres placas con los nombres reales de las
estadísticas. «?» abre la ayuda. Sin sesión: `NeedsAccount`. Sin mazos: «No tienes ningún mazo
listo» → constructor.

## 6. Matchmaking (PvP) y estados

Sin cambios de protocolo. `PvpLobby` sigue con «Buscar rival», reloj mm:ss, posición y rating del
servidor, «Cancelar búsqueda». La cola se apaga al emparejar (`usePvpQueue`), el poller de partida
solo se monta con `matchId`.

## 7. Intro de partida

`MatchIntro` se monta DESPUÉS de que `start` devuelva la vista: «Tú · <mazo> Σ» VS «Rival · <nivel>
Σ», «Abres tú el primer turno» / «Abre el rival», tu mano en miniatura. Se cierra sola a 1,6 s
(0,5 s con reduced-motion, sin desplazamientos), o con «Saltar», clic, Escape/Enter/Espacio. La mesa
está bloqueada mientras dura (`stage === "intro"`). Los verificadores que esperan ~2,8 s tras
«Comenzar duelo» siguen llegando a la arena.

## 8. Arena 2.0

La mesa de la Fase 22.2 (fullscreen inmersiva, fondo premium, zonas rival/duelo/jugador, mano en
abanico, historial en columna reservada a partir de `xl`) se conserva. Cromo: marcador, «?»,
silencio, pantalla completa, «Salir». Aviso «Partida recuperada desde el servidor: turno N de 10,
marcador X–Y» al retomar. Ancho 1320.

## 9. Mano y selección → confirmación

Clic en carta (`aria-label «nick, rol, OVR n»`), si atacas tres ejes `SH/GS/EF` con la cifra
grande; botón único que es la máquina de estados: «Elige una carta» → «Elige una estadística» →
«Declarar y atacar» / «Responder». Defendiendo, la mano resalta el eje obligado (`requiredStat` del
servidor).

## 10. Cerrojo de jugada (no hay doble envío)

`lockCopy` decide en un solo sitio: `busy` (jugada en vuelo) o `waitingRival` (PvP, no es tu turno)
→ `locked`. Bloqueados: `PlayerHand disabled`, los tres ejes `disabled`, el botón `disabled` con
`aria-busy`, y `confirm()`/`pickCard()` no reentran. Texto del botón «Resolviendo…» (el que leen
los scripts) y línea de estado «Jugada enviada y bloqueada: el servidor resuelve el turno» con
`aria-live`. La página añade su cerrojo de red (`inFlight`) y bloquea también durante intro,
asentamiento y revelación.

## 11. Revelación del rival y de la estadística

La carta rival solo aparece cuando la vista trae `pendingRival` (ya declaró) o en `rivalUsed`
(ya jugada); la mano rival son reversos por `rivalRemaining`. `DuelMoment` (cuatro tiempos) enseña
ahora «Stronghold 78 contra Gamesense 71» (`roundVerdict`, nombres reales de `STAT_INFO`) y en
empate «Valores idénticos: nadie recibe punto…». Veredicto de `outcome`, nunca comparando valores.

## 12. Ganar / perder / empatar el turno

`roundVerdict`: `A` → «Ganas el turno» (verde), `B` → «Pierdes el turno» (rojo), `TIE` → «Empate»
(oro) con nota. Cues `round_win`/`round_lose`/`ui` a los 760 ms (0 con reduced-motion).

## 13. Desempate por OVR, explicado cuando ocurre

`decisionCopy(result)`: SCORE → nada; OVR_TIEBREAK → «Desempate por suma de OVR: los diez turnos
acabaron igualados (N empatados); decidió la suma de OVR 812 contra 798; el desempate otorga un
punto, por eso el marcador final es 6–5»; STAT_MARGIN → «…no otorga punto»; NONE → «Empate total».
`DecisionPanel` se pinta en `ResultScreen` y `PvpOutcome` solo con `tiebreak`.

## 14. Marcador e historial

Marcador en barra, flancos y canto de mesa (móvil); `TurnTrack` con un pip por turno; columna
«Historial» (`TurnHistory` desplegable); en el final `RoundStrip` (T1…T10: carta rival / G-P-E /
tu carta, desplazable en horizontal) y «Los diez turnos».

## 15. Bots (presentación)

Fácil / Normal / Difícil con `DIFFICULTY_INFO` (etiqueta, lema, detalle, 3 pips). Sin porcentajes.
`DIFFICULTY_PROFILE` intacto (0 / 0.5 / 0.85, `perfectInformation: false`), asegurado por test D2.

## 16. PvP (presentación)

Mazo rival oculto: la vista PvP nace de `projectMatchFor` (servidor) y `buildMatchView`. Turno del
rival: `waitingRival` → mesa cerrada, «Esperando al rival…» / «El rival está decidiendo…», cuenta
atrás `mm:ss` del servidor que **no decide nada**. Timeout: lo cierra Postgres; la pantalla lee
`lifecycle` (`EXPIRED`) y `PvpOutcome` dice «Tiempo agotado». Doble envío: `actionId` único por
gesto + `expectedVersion`; respuesta tardía / `STALE_VERSION` → «La partida avanzó mientras
decidías. Vuelve a intentarlo.» + `syncNow()`. Estado de conexión (`connectionCopy`): «Recuperando
la partida…» (sin snapshot), «Reconectando… la partida sigue en el servidor» (STALE), «Sin
conexión. Se reintenta solo; tu turno no se pierde por esto» (ERROR); silencio en SYNCED.

## 17. Reconexión

PvE: al entrar, `fetchActiveDuel()` manda sobre la pre-partida; se retoma en el turno exacto con el
aviso «Partida recuperada desde el servidor…» y `trackDuel("reconnect")`. PvP: sin `localStorage`;
la cola devuelve `MATCHED` con el `matchId`, `usePvpSync` reconstruye; `?match=` como atajo;
telemetría `reconnect` si la partida ya tenía turnos o vino por URL.

## 18. Final de partida

`ResultScreen`: Victoria/Derrota/Empate (impacto, corona solo en victoria), marcador del resolver,
`reason`, desempate explicado (si lo hubo), **CARTA DESTACADA** (`featuredCard`: tu carta que ganó
por más margen; a igualdad, mayor valor; si ninguna ganó, tu valor más alto; nunca «MVP»),
recompensa del servidor (`award`: puntos de rango, créditos, XP), **nivel** (`LevelProgressPanel`
con la XP TOTAL de `/api/game/state` y `levelFromXp`, marcando «+N hoy»), cifras, historial en
miniatura, cartas, diez turnos. PvP: rating `old → new (+delta)` leído con `outcome=1` o
«Calculando el rating…».

## 19. Post-partida

PvE: **Revancha** (mismo mazo, mismo rival: nueva partida en el servidor, sin pasar por la
pre-partida) · **Cambiar rival o mazo** (pre-partida con mazos frescos) · **Ver la partida** ·
**Mis mazos** · **Salir a Duelos**. PvP: **Buscar otro rival** (el backend no tiene revancha; no se
promete) · **Volver a Duelos**.

## 20. Onboarding y ayuda

Reglas en la pre-partida (tres placas), botón «?» en pre-partida, barra PvE y barra PvP →
`HelpSheet`: cinco pasos (diez turnos, declarar/responder, gana el mayor, el final con los tres
desempates, bot/PvP), las tres estadísticas con abreviatura, nombre y lema, y la frase «todo lo
decide el servidor». No copia la tabla de enfrentamientos: explica que existe y que la arena la
enseña. Sin persistencia de «visto» (los componentes de duelo no pueden usar `localStorage`).

## 21. Móvil (390)

Hoja de ayuda inferior con asa y `safe-area`; intro con retícula 1fr/auto/1fr; historial en
miniatura desplazable; cromo con «?» + pantalla completa + Salir (silencio a partir de `sm` para no
robar espacio al marcador); mesa y mano de la Fase 22.2 (carta en juego ×1,9). Sin anchos fijos
≥ 1000 px (test C2).

## 22. Game feel y sonido

Cues existentes en selección (`ui`), confirmación (`whoosh`), veredicto (`round_win/lose/ui`),
intro (`whoosh`), final (`victory/defeat/ui`). Silencio con `SoundToggle` (`setMuted`), respetado
por `playCue` (`if (!ac || muted) return`). Sin haptics (no hay API fiable en escritorio; deuda).

## 23. Movimiento reducido

`MotionConfig reducedMotion="user"` en la arena PvE; `useReducedMotion` en intro (fundido corto,
sin desplazamientos), revelación (cuatro tiempos → uno), resultado (sin escala ni corona).
Capturas `21-*` y `22-*` con `prefers-reduced-motion: reduce`.

## 24. Sistema visual

`DuelCard` en todos los tamaños (mano `sm`, choque `md`, miniaturas `xs`, destacada `sm` con halo
oro), `DuelCardBack` para la mano rival. `Card3D`/`CardRenderer` siguen sin usarse en la arena: son
más pesados que `DuelCard` y la mano necesita diez a la vez (deuda P3 si se quiere el tilt en la
carta destacada).

## 25. Telemetría

Siete momentos cableados: `match_start` (start), `card_selected` (pick), `card_locked` (confirm),
`round_resolved` (historial crece), `match_completed` (resultado), `rematch`, `reconnect` (PvE al
retomar; PvP por turnos previos o URL). **La taxonomía no tiene flujo de duelo** (CHECK 0029:
4 flujos); `trackDuel` emite SOLO si `isFlow("duel_play")` — hoy es un no-op honesto, sin eventos
inventados ni flujo prestado. Test `telemetry.test.ts` lo afirma. Deuda: migración que añada
`duel_play` al CHECK y a `FLOWS` (+ `contract.test.ts` `FLOWS.length`).

## 26. Seguridad

- El cliente solo envía `action/deckId/difficulty/matchId/cardUid/stat` (PvE) y `actionId/
  expectedVersion/cardUid/stat` (PvP); nunca `winner/score/result/award/xp/seed` (tests D4, B6).
- Ninguna carta oculta del rival viaja: `pendingRival` + `rivalUsed` + `rivalRemaining` (PvE),
  `projectMatchFor` (PvP). Tests de `duel.test.ts` intactos (SEGURIDAD ×4) y UI_FILES ampliado.
- Sin `Math.random`, sin `localStorage`, sin importar orquestador/resolver/bots en componentes
  nuevos (D3 + invariantes recursivos de `duel.test.ts`).
- Recompensa/XP/nivel: `award` del servidor sin retoque (`!/award\.(credits|xp|points)\s*[+\-*\/]/`),
  XP total de `/api/game/state`, nivel por curva del dominio.
- Mazo inválido: la pre-partida no envía `start` (y el servidor respondería 409 igualmente).

## 27. Estados de fallo

Sin sesión (`NeedsAccount`), sin mazos, mazo incompleto (roles que faltan), error de `start`
(`role="alert"` en pre-partida), error de `play` (aviso cerrable en los controles), fallo al cargar
(`ErrorState` + reintentar), PvP: `STALE_VERSION`, sin conexión (banner), partida recuperándose,
rating pendiente («Calculando el rating…»), abandono con confirmación.

## 28. QA · escenarios ejecutados

| # | Escenario | Cómo | Resultado |
|---|---|---|---|
| 1 | Sin sesión → `/duelos/jugar` | captura 23 | `NeedsAccount` |
| 2 | Sin mazos | pre-partida | «No tienes ningún mazo listo» → constructor |
| 3 | Mazo incompleto elegido | `02-prematch-invalid` | roles que faltan, «Completar equipo», CTA deshabilitado |
| 4 | Mazo legal → Comenzar | `01-prematch` | CTA activo, Σ OVR |
| 5 | Intro | `03-match-intro` | VS, quién abre, «Saltar» |
| 6 | Arena turno 4 atacando | `04-arena` (1440/1024/390) | mesa, mano, «Elige tu carta» |
| 7 | Carta + eje elegidos | `05-card-selected` | eje resaltado, «Declarar y atacar» |
| 8 | Defendiendo con eje obligado | `06-defending-required` | «Obligado a responder con …», carta rival en su hueco |
| 9 | Revelación | `07-stat-reveal` | cuatro tiempos, nombres reales |
| 10–12 | Turno ganado / perdido / empatado | `08/09/10-round-*` | verde/rojo/oro, nota de empate |
| 13 | Historial | `11-history` | columna + miniaturas |
| 14 | PvP buscando | `12-pvp-searching` | reloj, posición, cancelar |
| 15 | PvP turno del rival | `13-pvp-waiting` | mesa cerrada, «Esperando al rival…», cuenta atrás |
| 16 | PvP reconectando | `14-reconnect` | banner STALE, partida intacta |
| 17 | Victoria | `15-match-win` | corona, destacada, recompensa, nivel |
| 18 | Derrota | `16-match-loss` | sin corona, destacada, «el rango solo sube ganando» |
| 19 | Post-partida | `17-post-match` | Revancha / Cambiar / Ver / Mis mazos / Salir |
| 20 | PvP resultado | `18-pvp-outcome` | rating pendiente, «Buscar otro rival» |
| 21 | Ayuda | `19-help-sheet` | diálogo / hoja inferior |
| 22 | Móvil arena con selección | `20-mobile-arena` | 390 usable |
| 23–24 | Movimiento reducido | `21/22-reduced-motion-*` | sin desplazamientos |
| 25 | Home CTA | `24-home-cta` | la escalera real: la captura (sin sesión, con 4 sobres QA sembrados en el perfil de Chrome y 0 cartas) enseña «Abrir tus sobres»; con sesión: «Jugar» (mazo legal) / «Completar equipo» (mazos sin legalizar) / «Construir mi mazo» (sin mazos), afirmado por test C6 |

Escenarios que exigen base de datos (doble envío real, timeout PvP real, reconexión con recarga,
recompensa concedida una sola vez) están cubiertos por los verificadores existentes
(`duel-gameplay:verify`, `pvp-timeout:verify`, `pvp-arena:verify`, `pvp-rating-settlement:verify`),
que **no se han ejecutado en esta fase** por falta de Supabase local (Docker desinstalado) y por la
regla de no usar la base de producción para QA. Sus contratos sobre el código (textos, selectores,
invariantes) se conservan y están afirmados por tests.

## 29. Capturas

`docs/product/qa/fase26/` — 45 PNG a 1440/1024/390 + `README.md` (índice generado por el script).

## 30. Tests

- Nuevos: `gameplayUx.test.ts` 16 · `telemetry.test.ts` 4 · `gameplay.contract.test.ts` 34 = **54**
  (dominio de pantalla 16 · flujo de partida 14 · PvP 7 · UX 7 · regresión 6 · telemetría 4).
- Modificados: `duel.test.ts` (UI_FILES +5, sin tocar aserciones).
- Suite completa: **1328 / 1328** (1274 previos + 54 nuevos), `npm test`, 0 fallos.

## 31. Gates

| Gate | Resultado |
|---|---|
| `npm test` | 1328 / 1328 |
| `tsc -p tsconfig.json` | 0 errores |
| `tsc -p tsconfig.scripts.json` | 0 errores |
| `next build` | OK (`/duelos/*`, `/design-system/fase26` compilan) |
| `eslint` (21 ficheros de la fase) | 0 errores, 0 avisos |
| `security:verify` | exit 0 |
| `pack:verify` | exit 0 |
| `content:verify` | exit 0 |
| `distribution:verify` | exit 0 |
| `competitive:verify` | exit 0 |
| `importer-vlr:verify` | exit 0 |
| Tests de gameplay/PvP (`duel.test`, `pvpPoller.test`, `arena.behavior`, `gameplay.contract`, `gameplayUx`, `telemetry`) | 99 / 99 |
| `duel-gameplay:verify`, `pvp-*:verify`, `duel:e2e`, `duel:shots` | **no ejecutados** (exigen Supabase local; Docker desinstalado; no se usa la BD de producción para QA) |
| Capturas | 45 PNG (1440/1024/390) + README, 0 errores de consola propios (2 `ERR_CONNECTION_REFUSED` de Supabase ausente en `/duelos` y `/`) |

## 32. Deudas y decisiones

- **P2 · Telemetría sin flujo de duelo**: `trackDuel` es no-op hasta añadir `duel_play` al CHECK
  0029 + `FLOWS` (migración + `contract.test.ts`). Decidido no falsear con otro flujo.
- **P2 · Verificadores con BD no ejecutados** (ver §28). Requieren Supabase local.
- **P3 · Revancha PvP**: sin acción en el backend; la pantalla ofrece «Buscar otro rival».
- **P3 · Haptics**: sin API fiable; no se añade.
- **P3 · Card3D en la carta destacada**: se usa `DuelCard` por coherencia con la mesa.
- **P3 · Nivel en PvP**: PvP no mueve XP (por diseño); no se enseña nivel en `PvpOutcome`.
- Decisión: «Volver a jugar» pasa a **Revancha** (mismo mazo y rival, sin pre-partida) + «Cambiar
  rival o mazo». Ningún script dependía del texto anterior.
- Decisión: la pre-partida enseña mazos ilegales (antes se ocultaban) porque «por qué no puedo
  jugar» es la pregunta que el jugador hace.

## 33. Riesgos

- Los scripts de QA con BD esperan ~2,8 s tras «Comenzar duelo»; la intro dura 1,6 s: hay margen,
  pero una red lenta podría fotografiar la intro. Mitigación: saltable; `duel:shots` puede pulsar
  «Saltar».
- `LevelProgressPanel` depende de `/api/game/state`; si falla, no se enseña nivel (sin inventar).

## 34. Archivos creados / modificados

Creados: `src/lib/duel/gameplayUx.ts`, `src/lib/duel/telemetry.ts`, `src/components/duel/PreMatch.tsx`,
`MatchIntro.tsx`, `HelpSheet.tsx`, `SoundToggle.tsx`, `MatchSummary.tsx`, `src/lib/duel/gameplayUx.test.ts`,
`src/lib/duel/telemetry.test.ts`, `src/components/duel/gameplay.contract.test.ts`,
`src/app/design-system/fase26/page.tsx`, `scripts/_fase26-visual-qa.ts`, `docs/product/qa/fase26/*`,
este informe.

Modificados: `src/components/duel/MatchBoard.tsx`, `DuelMoment.tsx`, `ResultScreen.tsx`,
`pvp/PvpArena.tsx`, `pvp/PvpOutcome.tsx`, `src/app/duelos/jugar/page.tsx`, `src/app/duelos/pvp/page.tsx`,
`src/app/duelos/page.tsx`, `src/app/page.tsx`, `src/lib/duel/duel.test.ts` (UI_FILES), `src/lib/duel/matchView.ts`
(`rivalRemaining`).

No tocados: `domain/cardgame/**`, `server/**`, `supabase/migrations/**`, `lib/duel/pvpPoller.ts`,
`usePvpSync.ts`, `usePvpQueue.ts`, `client.ts`, `lib/telemetry/**`, `config/features.ts`.
