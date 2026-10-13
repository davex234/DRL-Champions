# FASE 40 — PLAYER JOURNEY 3.0 · PRIMERA SESIÓN

Fecha: 2026-09-16. Contrato: `docs/product/player-journey-contract.md`. QA: `docs/product/qa/fase40/README.md`.
Sin migración; no se toca el alta ni la economía (decisión del usuario sobre el starter, §29).

## 1. Estado inicial
Fase 39 GO; 2801/2801 tests; sin código de recorrido. Había un FTUE derivado previo (`ftueState`, 3 pasos en el héroe del
vestíbulo y 4 en /progresion) y una regla `open-first` en el motor del vestíbulo.

## 2. Arquitectura FTUE encontrada
Un solo motor: `dailyCandidates` (domain/dailyLoop) → `orderToday` (meta.ts), con `ftue:true` = rango 0.5. `ftueState`
calculado sin estado persistido. Home = `GET /api/game/daily-loop` sin escrituras. Sin banderas de onboarding en BD ni en
localStorage. Telemetría con FLOWS cerrados (4).

## 3. Fresh account contract
Trigger `handle_new_user` (0001 ampliado en 0011): perfil (6.000 créditos por defecto, nivel 1, XP 0, puntos 0),
`user_game` (packs_opened 0), `user_packs` inicial×3 + estandar×1, asiento `starter_grant` 6.000. Sin cartas, equipo,
pase, rating, campaña ni draft. Confirmado en real (cuenta nueva `64ee0e54`).

## 4. Starter credits
6.000 (default de `profiles.credits`) + asiento `starter_grant:6000` con ref única `starter:<id>`.

## 5. Starter packs
3 × Sobre Inicial (5 cartas, precio 0) + 1 × Sobre Estándar (5 cartas). Aleatorios, sin garantía de rol.

## 6. Starter cards
Ninguna.

## 7. Starter deck
Ninguno.

## 8. Fresh detection
Derivada de hechos: cartas, `user_game.packs_opened`, sobres sin abrir, equipos guardados/legales y partidas terminadas
(sin Draft). No usa `created_at` ni `obtained_at` (tests J04/T04).

## 9. Legacy detection
≥ 1 partida terminada = COMPLETA (también con partidas sin equipo). Cuenta veterana → sin recorrido (JS09, JS10).

## 10. Journey domain
`src/domain/journey/index.ts`: `buildPlayerJourney(facts)` → `status, steps, currentStep, completedSteps, progress,
isComplete, welcome, canSkip, justCompleted, nextAction, context`; `deckReadiness`, `firstPackOf`, `DISCOVERY`,
`FIRST_MATCH_RULES`. Puro (sin reloj, red ni azar).

## 11. Journey states
1 ABRE · 2 COLECCIONA (la colección ya forma equipo legal) · 3 CONSTRUYE (equipo guardado y legal) · 4 JUEGA (≥ 1 partida
terminada) · COMPLETA. Bienvenida = nada hecho. `justCompleted` = exactamente 1 partida.

## 12. Persistence decision
Todo derivado. Única preferencia: «Explorar por mi cuenta», de PRESENTACIÓN y por dispositivo, en el adaptador KV de la
plataforma (`journey-explore-<usuario>`). No cambia pasos, prioridad ni economía.

## 13. Migración 0054 sí/no
**No.** La última migración sigue siendo 0053 (test T100/JC10).

## 14. Priority integration
El recorrido entra en `dailyCandidates` como `journey-open|collect|build|play` con `ftue:true` (rango 0.5). Durante la
primera sesión se omiten las sugerencias de equipo y modos (evita duplicados). Nuevo `resume-draft`. Verificador
combinatorio: 2.304 estados.

## 15. Active-match priority
Partida a medias SIEMPRE primero (ranked > privada > campaña > PvE > combate de Draft); el recorrido baja a una tira.
Real: con la partida del primer combate abierta, la home propuso «Continuar partida» y la guía quedó en la tira.

## 16. Welcome
Mission Control en el héroe: NEXUS, «Colecciona. Construye. Compite.» con una línea cada uno, tres cartas REALES del
catálogo (estáticas; miniaturas en móvil), la línea de 4 pasos con estado en texto y el CTA «Abrir mi primer sobre».

## 17. Copy
Español de España, corto: «Tu colección empieza aquí.» / «Cada carta representa un jugador real.» / «Forma una plantilla
legal de diez cartas.» / «Pon tu plantilla a prueba.»; «Ya conoces el núcleo de NEXUS. Ahora elige cómo seguir.»

## 18. Skip
«Explorar por mi cuenta» baja la guía a una tira con «Ver la guía». Sin recompensa ni cambios de estado (JL05, T08).

## 19. Resume
El paso se recalcula en cada lectura. Real: vuelta tras abrir (COLECCIONA sin bienvenida), logout/login (sigue en
COLECCIONA), 4 vueltas más entre ejecuciones.

## 20. First Pack
CTA a `/abrir/<sobre que posee>`; nunca se concede un sobre. Sin sobres ni cartas: «Conseguir Sobre Inicial gratis».

## 21. Pack selection
Determinista entre los poseídos: inicial > estándar > orden alfabético (`firstPackOf`).

## 22. Pack Opening integration
Pack Opening 3.0 real, sin variante de tutorial. Real: ceremonia completa y resumen del Sobre Inicial.

## 23. Pack completion detection
Por hechos del servidor (`user_game.packs_opened` / cartas); ninguna bandera de animación (J12, T24). Real:
packs_opened 0→1 y 5 cartas `origin=pack`.

## 24. First Cards
El resumen de la ceremonia (existente) enseña las cartas; el vestíbulo pasa a COLECCIONA con «Ver mi colección».

## 25. Collection integration
«Ver mi colección» → `/coleccion?tener=owned` (filtro existente). Un único coach arriba de la colección mientras no hay
equipo guardado: qué es una carta (rol, OVR, Stronghold, Gamesense, Entryfrag), jugadores distintos por rol con
denominador, «Ver solo mis cartas» y el siguiente paso real.

## 26. Card Detail learning
El coach invita a tocar una carta («Toca una carta para ver su ficha»); no es obligatorio.

## 27. Deck readiness
`deckReadiness`: ≥ 2 jugadores distintos por rol con combate en una misma versión de datos. Igual que `autocomplete`
del constructor: 0 discrepancias en 7.962 colecciones (starter + aleatorias).

## 28. Starter solvability before
**34,19 %** de 100.000 cuentas pueden formar equipo legal con los 4 sobres de bienvenida. Faltan sobre todo Flex
(38,8 %) y Centinela (33,9 %).

## 29. Starter correction sí/no
**No.** Decisión del usuario: la ruta garantizada es el Sobre Inicial gratis y repetible (precio 0, compra real en
servidor). Sin cambios en alta, sobres, odds ni economía. Riesgo documentado: depende de que siga siendo gratis
(el verificador comprueba el precio).

## 30. Starter idempotency
Trigger una vez por alta; PK; `on conflict do nothing`; `credit_tx_ref_uniq`. Ninguna ruta de la app concede starter.
Real: un único `starter_grant:6000`.

## 31. 100k starter simulation
100.000 cuentas con el motor de sobres real: **100.000 / 100.000** llegan a un equipo legal gratis. Sobres Iniciales
extra: media 1,99 · p50 1 · p75 3 · p90 5 · p99 10 · p99,9 15 · máximo 24.

## 32. Starter strength
Equipo autocompletado de quien ya puede: OVR medio 79,1 (mín 73,4 · máx 84,5). Rareza de las cartas de bienvenida:
Plata 37 %, Bronce 29 %, regionales ~6 % cada una, Oro 3,6 %, resto < 1,4 %. Roles: Duelista 33 %, Controlador 23 %,
Iniciador 23 %, Centinela 11 %, Flex 10 %. Nada optimizado.

## 33. Deck step
«Construye tu primer equipo» / «Termina tu primer equipo» (si hay uno a medias) → «Ir al constructor».

## 34. Deck Builder integration
Deck Builder 2.0 real con un coach del primer equipo. Real: coach visible y visible de nuevo tras recargar.

## 35. Autocomplete
«Autocompletar equipo» existente (backtracking determinista, solo cartas poseídas, 2 por rol, sin duplicados, una
versión; T30–T36). Sin texto de «mejor equipo». Real: autocompletó con sus 35 cartas.

## 36. Manual build
Sigue igual; el coach lo dice («Elige tú o pulsa…»).

## 37. Canonical validation
Solo cuenta un equipo guardado y legal según el servidor (`valid`, `validateDuelDeck`). Real: 10 cartas propias sin
duplicadas.

## 38. Active deck
Si el guardado deja el PRIMER equipo legal y no hay activo, se activa con `set_active` y se dice («Plantilla lista: equipo
guardado y activado…»). Real: activo = el guardado.

## 39. First deck moment
Vestíbulo en JUEGA: «PLANTILLA LISTA» con las 10 cartas reales (miniaturas) y «equipo activo». Sin recompensa.

## 40. First Match
«Jugar mi primer combate» → `/duelos/jugar?dificultad=EASY&primera=1` (partida rápida PvE).

## 41. Difficulty
Fácil PRESELECCIONADO (`?dificultad`, solo EASY/NORMAL/HARD; se puede cambiar; el servidor valida). Bot canónico.

## 42. Match learning
Coach en la PRE-PARTIDA (nunca sobre el tablero): 10 turnos, ataca/defiende, gana el valor mayor, final. `HelpSheet`
canónico enlazado.

## 43. Combat semantics
Textos = `duel-combat-2`: turno empatado sin punto; turnos → suma de OVR (+1 punto) → total de estadística declarada (sin
punto) → empate. `HelpSheet` corregido: «(no otorga punto)».

## 44. Match result
Ganar, perder o empatar completan la sesión. Real: victoria 7-3, 10 turnos por la interfaz, PVE · EASY · duel-combat-2 ·
duel-turns-2.

## 45. PvE reward
Solo la existente. Real: `duel_win:120` (6.000 → 6.120 créditos) y 8 puntos.

## 46. FTUE rewards
Ninguna. Real: la capa del recorrido concede 0 créditos, 0 sobres, 0 cartas y 0 XP.

## 47. Journey completion
COMPLETA con 1 partida terminada. Real: sesión completada y vestíbulo con «Primera sesión completada».

## 48. Discovery
Road to Champions, Draft Gauntlet, Competitivo, Colección y Temporada, con una línea cada uno y rutas que existen. El
evento solo aparece con un partido en directo real que no sea demo.

## 49. Road to Champions
«Avanza por una campaña de combates contra equipos reales.» → `/jugar/road-to-champions`.

## 50. Draft Gauntlet
«Construye una plantilla temporal carta a carta.» → `/jugar/draft-gauntlet`.

## 51. Competitive
«Juega contra personas y construye tu rating.» → `/duelos/competitivo`. Sin bloqueo nuevo.

## 52. Collection
«Completa jugadores, variantes y sets.» → `/coleccion`.

## 53. Season
«Consulta objetivos, pase y progreso.» → `/temporada`.

## 54. Home after FTUE
Real: acción principal normal («4 objetivos por reclamar») y el bloque de destinos. Con 2+ partidas el recorrido
desaparece.

## 55. Returning player
Real: vuelve tras abrir → COLECCIONA; tras construir → JUEGA; con partida a medias → «Continuar partida».

## 56. Legacy player
Sin FTUE retroactivo (JS09, JS10, T03, T62).

## 57. Edge cases
- Cartas sin sobres: se salta el sobre.
- Equipo sin partidas: JUEGA.
- Partidas sin equipo: COMPLETA.
- Sin sobres ni cartas: Sobre Inicial gratis.
- Equipo a medias: se vuelve a ese equipo.
- Draft solo DRAFTING: no se toca ni se propone.
- Campaña: no se toca.

## 58. Offline
Última foto, CTA desactivado y «Sin conexión · tu progreso sigue guardado en el servidor». Nada avanza en local.

## 59. Error isolation
Temporada, social o eventos caídos: la guía sigue (JS15, JR10). Progresión, sobres o equipos caídos: `journey = null`,
sin adivinar (JS16).

## 60. Journey API/read model
Sin endpoint nuevo: el campo `journey` de `GET /api/game/daily-loop`.

## 61. Zero-write reads
Probado en memoria (JS02, verificador) y en real: leer el vestíbulo dos veces antes y después de la partida no cambió
nada. Lecturas nuevas: `pack_id` en la consulta existente, `ownedCardIds` de la misma lectura de progresión y
`draft_runs` IN_MATCH.

## 62. Performance
Sin peticiones nuevas en la home. Número de consultas independiente del tamaño de la colección (JS18). Una lectura
extra del vestíbulo al terminar una partida, solo en el primer combate o si se retomó.

## 63. Security
- Usuario del token; el recorrido es privado (JS17).
- Sin mutaciones: el cliente no puede marcar pasos, completar ni conceder.
- El recorrido no llama a compras, aperturas ni RPC (JC02).
- Mercado OFF.

## 64. Rate limit
Cubeta existente `daily_loop_read` (40/min); sin endpoint nuevo, sin cubeta nueva.

## 65. Telemetry
No-op honesto: FLOWS sigue en 4 (CHECK de 0029) y el vestíbulo no emite. Sin migración.

## 66. Accessibility
- Pasos con `aria-current` y estado en texto (Hecho/Ahora/Después).
- Secciones con nombre y botones del sistema con foco visible.
- 0 controles de menos de 44 px en 151 capturas.
- Nada se indica solo con color.

## 67. Reduced motion
`MotionConfig reducedMotion="user"` y `useReducedMotion`; sin parallax ni confeti; 30 capturas con `reduce`.

## 68. Responsive
Capturas en 390, 768, 1024, 1440 y apaisado: 0 desbordamientos y 0 elementos recortados. En móvil las cartas de
bienvenida son miniaturas.

## 69. Real fresh QA account
`64ee0e54`, creada por el formulario real de registro (GoTrue con autoconfirmación), no admin, credenciales aleatorias
fuera del repo.

## 70. Real starter fingerprint
- Créditos 6.000, XP 0, puntos 0.
- Sobres: estandar=1, inicial=3. 0 cartas, 0 equipos, 0 partidas, packs_opened 0.
- Asiento único `starter_grant:6000`.
- Ficha ranked 1000/0 y pase vacío creados por `/cuenta` al leer (deuda previa; ver P2).

## 71. Real Welcome
Mission Control con bienvenida en ABRE → `/abrir/inicial`; recarga igual; capturas 1440/390/1024.

## 72. Real First Pack
Ceremonia completa; packs_opened +1; 5 cartas de sobre; créditos sin cambios.

## 73. Real Collection
«Ver mi colección» → colección real con el coach (captura previa a mover el coach arriba).

## 74. Real First Deck
7 sobres (4 de bienvenida + 3 Sobres Iniciales gratis a 0) → CONSTRUYE → constructor con coach → recarga →
«Autocompletar equipo» → guardar.

## 75. Real Active Deck
Aviso «equipo guardado y activado»; BD: activo = guardado; 10 cartas propias, sin duplicadas.

## 76. Real First Match
PvE Fácil real, retomado con «Continuar partida», 10 turnos por la interfaz, victoria 7-3, motor canónico.

## 77. Real Journey Complete
El vestíbulo muestra «Primera sesión completada» con los destinos. En la arena NO se mostró porque la partida se retomó
sin `?primera`; corregido después, sin reverificar en real (P2).

## 78. Real Home
Daily Loop normal (reclamar objetivos) sin guía; tras recargar, sin volver a la guía.

## 79. Real refresh
Probado en la bienvenida, tras el sobre, durante el equipo y tras la partida: siempre el paso correcto.

## 80. Real logout/login
Tras el primer sobre: cerrar sesión, entrar por el formulario y seguir en COLECCIONA.

## 81. Economy fingerprint
Ledger final: `starter_grant:6000, buy_pack:inicial:0 ×3, duel_win:120` → créditos 6.120. XP de cuenta (1.090) por
aperturas de sobres (RPC existente) y la partida PvE. XP de pase 0, logros 0, campaña 0, draft 0. Capa del recorrido: 0.

## 82. Collection integrity
35 cartas = 5 × 7 aperturas, todas `origin=pack`; el recorrido no crea cartas (T96).

## 83. Deck integrity
Sin atajo del validador (T97); equipo legal según el servidor.

## 84. Match integrity
Motor canónico y sin bot tutorial (T98, T43); partida real `duel-combat-2` / `duel-turns-2`.

## 85. Visual QA
174 escenas: 151 sintéticas (32 escenas × 1440/1024/390, más 768, apaisado, 30 con movimiento reducido y 4 de
interacción) y 23 reales.

## 86. Tests nuevos
**3000/3000** (2801 → +199):
- `journey.test.ts`: 35
- `journey.matrix.test.ts`: 100 (matriz T01–T100)
- `journey.service.test.ts`: 18
- `journey.lib.test.ts`: 15
- `journey.render.test.tsx`: 27
- `openRecovery.test.ts`: 3
- recuperación de sobres: 1

Tests previos actualizados a propósito: `dailyLoop.test.ts` (5), `dailyLoop.contract.test.tsx` (2),
`packCounter.service.test.ts` (1), `packOpening.behavior.test.ts` (1).

## 87. Verifiers
- `player-journey:verify`: 41 OK
- `player-journey-starter:verify`: 14 OK (100.000 cuentas)
- `player-journey-priority:verify`: 8 OK (2.304 estados)
- `player-journey-security:verify`: 15 OK

Todos con 0 fallos. `daily-loop:verify` actualizado: 47 ✓.

## 88. Gates finales
- `npm test`: 3000/3000
- `tsc` web y scripts: exit 0
- `next build`: exit 0
- ESLint sobre los ficheros de la fase: exit 0
- 38 verificadores existentes, 4 nuevos y `draft-gauntlet` completo: todos en verde

Túnel y app cerrados durante los gates.

## 89. Bugs encontrados
1. Solo el 34 % de las cuentas nuevas puede formar equipo con los sobres de bienvenida (medido; decisión en §29).
2. `/abrir/<sobre>` volvía a mostrar durante 10 minutos el resumen del sobre anterior en vez de un sobre nuevo; rompía «Abrir el siguiente sobre» (encontrado en real).
3. Los destinos de la primera sesión anunciaban como «en directo» un evento de demostración (encontrado en real).
4. El resultado del primer combate no mostraba el cierre si la partida se retomó (encontrado en real).
5. En 390 px las cartas de bienvenida se solapaban y recortaban.
6. El coach de la colección quedaba abajo y el álbum mostraba el catálogo entero en vez de las cartas del jugador.
7. El vestíbulo con partida abierta repetía el CTA del recorrido en la tira y en «Después».
8. `HelpSheet` no decía que el desempate por estadística total no da punto.
9. Una prueba previa (A3) se rompió porque la edición en Windows pasó `PreMatch.tsx` de LF a CRLF.
10. Bugs de mis propios instrumentos: selector de ejes que confundía la carta «Shr1mp» con el eje «SH», navegación con recarga y reanudación.

## 90. Bugs corregidos
Todos menos el 1, que no se corrige por decisión del producto y queda con ruta garantizada:
- **2:** un revelado ya visto solo se recupera al recargar esa misma pantalla, y se borra al salir.
- **3:** los eventos demo quedan fuera de los destinos.
- **4:** la arena relee el vestíbulo también si retomó una partida.
- **5:** miniaturas en móvil.
- **6:** coach arriba, «Ver solo mis cartas» y `?tener=owned`.
- **7:** la tira no repite el botón.
- **8:** texto corregido.
- **9:** `PreMatch.tsx` vuelve a LF.
- **10:** instrumentos arreglados.

## 91. Migración/DB changes
Ninguna. Sin cambios de esquema, datos ni configuración en el VPS. Solo lecturas por SSH y la cuenta QA creada por el
registro real.

## 92. Archivos creados
- `src/domain/journey/index.ts`, `journey.test.ts`, `journey.matrix.test.ts`
- `src/lib/journey/{presentation,arena,deck,preference}.ts` y `journey.lib.test.ts`
- `src/components/journey/{JourneyMissionControl,JourneyDiscovery,JourneyCoach,FirstMatchCoach,CollectionCoach}.tsx` y `journey.render.test.tsx`
- `src/server/services/journey.service.test.ts`
- `src/app/design-system/fase40/{page.tsx,fixtures.ts}`
- `scripts/player-journey-verify.ts`, `scripts/_fase40-real-e2e.ts`, `scripts/_fase40-visual-qa.ts`
- `docs/product/player-journey-contract.md`, este informe y `docs/product/qa/fase40/**`

## 93. Archivos modificados
- Vestíbulo y servicios: `src/domain/dailyLoop/index.ts` (+ test), `src/server/services/dailyLoop.ts`, `progression.ts` (`ownedCardIds`), `src/lib/dailyLoop/presentation.ts`, `DailyHero.tsx`, `DailyLobby.tsx` (+ contract test), `src/app/page.tsx`.
- Arena y constructor: `src/app/duelos/jugar/page.tsx`, `PreMatch.tsx`, `HelpSheet.tsx`, `src/app/duelos/mazos/page.tsx`, `DeckBuilder.tsx`.
- Colección: `CollectionRoomScreen.tsx`, `src/domain/collection/room.ts`.
- Progresión y sobres: `FtueSteps.tsx`, `PackOpeningExperience.tsx`, `src/lib/game/openRecovery.ts` (+ test), `packOpening.recovery.test.ts`, `packOpening.behavior.test.ts`, `packCounter.service.test.ts`.
- Verificación y scripts: `scripts/daily-loop-verify.ts`, `package.json` (4 scripts).

## 94. P2 restantes
1. `GET /api/game/competitive` escribe al leer (crea la ficha ranked y el pase), y lo dispara `/cuenta` justo tras registrarse. Deuda previa, fuera del recorrido.
2. La garantía de equipo legal depende de que el Sobre Inicial siga siendo gratis y repetible. Hasta p99 hacen falta 10 sobres extra y el peor caso fue 24.
3. «Primera sesión completada» en la arena tras retomar la partida está arreglado pero no reverificado en real.
4. La captura real del coach de la colección es anterior a moverlo arriba, y la del vestíbulo final es anterior al filtro de demos.
5. `/progresion` conserva su checklist antiguo (`FtueSteps`), ahora con enlace a la guía del vestíbulo. No decide prioridad.
6. Sin telemetría de embudo del recorrido (FLOWS cerrados y sin migración).
7. `_fase39-real-e2e.ts` tiene el mismo selector de ejes frágil («Shr1mp»).

## 95. Marketplace/worker/infra
Marketplace OFF. No se tocó el worker de Pick'ems, cron, importador VLR, Caddy, Cloudflare, Kong, Auth, Storage,
Realtime, firewall ni SSH. Sin Docker local, deploy, commit ni push. Túnel y app cerrados al final.

## 96. GO / NO-GO
**GO.**

Se cumplen los requisitos de GO:
- Recorrido real y derivado dentro del único motor de prioridad.
- Alta no duplicada.
- 100.000 / 100.000 cuentas con ruta gratuita a un equipo legal (sin tocar odds ni economía, por decisión del usuario).
- Primer sobre, colección, equipo, equipo activo y partida PvE Fácil reales con una cuenta nueva registrada por el flujo real.
- Recompensa solo la PvE existente; capa del recorrido 0.
- Lecturas sin escrituras.
- Legado sin FTUE; vuelta, recarga y logout/login correctos.
- 3000/3000 y todos los gates en verde.

Salvedad declarada: el cierre en la pantalla de resultado tras retomar la partida se corrigió y está cubierto por test,
pero no se reverificó en real (el vestíbulo sí mostró el cierre en real).

**FASE 40 — CERRADA.** No se empieza la Fase 41.
