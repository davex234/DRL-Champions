# FASE 24.3 — PICK'EMS BRACKET EXPERIENCE · Eliminatorias visuales

**Estado:** completada (validación viva pendiente de entorno, documentada) · **Fecha:** 2026-09-13
**Rama:** `arch/stabilization` · **Sin commit/push/deploy** (cambios en el árbol de trabajo)

> Regla de la fase: liga → la experiencia 24.2 tal cual; eliminatoria → cuadro visual construido
> **solo** con datos reales. Nada de 24.1/24.2 se rehace: mismo hook (`usePickem`), misma API
> (`/api/pickems` → `app_submit_pick`), mismo dominio de estados/progreso, mismo scoring,
> mismas recompensas, mismo leaderboard. El cuadro es otra UI sobre las mismas preguntas.

---

## 1. Detección liga vs bracket

**Qué hay en los datos reales** (mapeado antes de escribir): el modelo NO guarda cuadros — no
existe `next_match_id`, `slot` ni `bracket`. Lo que hay es `stages.kind`
(`group|swiss|playoff|bracket|showmatch`, lo pone el importador VLR por la etiqueta de la fase),
`matches.round` (el texto de la serie tal como lo publica VLR: «Quarterfinal», «Upper
Semifinal», «Lower Round 2», «Grand Final», «Opening (A)», «Winners (B)», «Decider», «Week 3»;
la demo usa «Cuartos/Semifinal/Final»), `matches.stage_id`, `match_order`, `start_time`, los dos
equipos y el ganador REAL (`winner_team_id`/`winner_team`). `events.type` es un texto libre del
origen y no se usa para decidir.

**`getTournamentFormat({ stages, matches })`** (`domain/pickems/bracket.ts`, pura):
- Con fases: `playoff|bracket` → eliminatoria; `group|swiss` → liga; las dos → `GROUP_PLAYOFF`.
  Excepción con datos: una fase `group` cuyas rondas son todas de eliminatoria
  (Opening/Winners/Elimination/Decider = grupos GSL) se trata como cuadro.
- Sin fases: la forma de las etiquetas de ronda. Mayoría de eliminatoria → `SINGLE_ELIMINATION`
  o `DOUBLE_ELIMINATION` (si hay rama «Lower»); etiquetas de liga (week/jornada/matchday/group) →
  `LEAGUE`; sin etiquetas útiles → `UNKNOWN`.
- Nunca por el nombre del torneo (prueba de contrato sobre el código).

`isBracketFormat` = `SINGLE_ELIMINATION | DOUBLE_ELIMINATION | GROUP_PLAYOFF`. La pantalla usa el
cuadro solo si además el modelo es **fiable** (`model.reliable`) y tiene rondas.

## 2. Tipos de bracket encontrados

En el repositorio no hay snapshots VLR con partidos guardados (solo `players-vct-2026.json`);
las estructuras reales disponibles son: el **seed de demo** (fase `playoff`, «Cuartos» ×4 →
«Semifinal» ×2 → «Final» ×1, con partidos jugados/en juego/futuros) y el **mock del
sincronizador** (fase `playoffs`, «Gran Final»). El importador VLR produce las etiquetas
inglesas oficiales (`importer-vlr-verify` usa «Semifinal» y «Grand Final» con `stageId
st-playoffs`). Los formatos soportados por el normalizador: simple, doble (upper/lower/grand
final), GSL (opening/winners/elimination/decider), grupos + playoffs, liga (sin cuadro).

## 3. BracketModel

```
BracketModel { format, stages[], rounds[], matches{}, edges[], reliable }
BracketStage { id, name, kind, bracket, roundIds[] }
BracketRound { id, stageId, label, side: upper|lower|single|grand, order, matchIds[] }
BracketMatch { id, roundId, stageId, teamA, teamB, scoreA, scoreB, winner: a|b|null, status,
               startsAt, order, questionId, optionA, optionB, points, locksAt, selectedOption,
               correctOption, lockState: open|locked|resolved|none, pickState, pointsAward }
BracketEdge  { from, to, source: WINNER|LOSER, slot: a|b }
```
`buildBracketModel` es pura y determinista (prueba). `winner` sale de `winner_team_id`/`winner_team`,
**nunca** del marcador (prueba: el backend manda aunque contradiga el marcador).

## 4. Rondas

Se agrupan por (fase, etiqueta normalizada). `parseRound` reconoce las etiquetas oficiales
(inglés y español), su rama y su rango (R16 < QF < SF < F < GF; opening < winners/elimination <
decider; round N). Orden de columna: fase → rama (single/upper, lower, grand) → rango → primera
hora real de inicio → etiqueta. Dentro de la ronda, por `match_order` y hora. Si una ronda no
tiene ni hora ni rango, o si dos rondas con rango se contradicen con sus horas («semifinal»
antes que sus «cuartos»), el modelo se marca **no fiable** y la pantalla vuelve a la vista
normal (§35). Las etiquetas oficiales reconocibles se conservan («Upper Semifinal»); solo se
traduce cuando hay que componer («Apertura», «Ganadores», «Decisivo», «Gran Final»).

## 5. Edges

Una arista existe **solo si el backend ya la muestra**: el partido origen está `finished` con
ganador real, y ese equipo (por id o por nombre normalizado) aparece en un partido de una ronda
**posterior** de la misma fase. Se toma el más cercano (menor orden de ronda, luego menor hora).
El hueco (`slot`) es el lado donde aparece. Un partido en juego, futuro o «TBD» no genera ni
recibe aristas: no se sabe de dónde vendrán sus equipos. Una liga no genera ninguna.

## 6. Winner progression

`WINNER`: del partido terminado al siguiente en el que aparece su ganador. Línea continua cian
con brillo suave, del lado derecho de la caja al lado izquierdo de la siguiente, con codo a mitad
de camino, entrando por la fila del hueco. El equipo aparece en la siguiente ronda porque el
backend ya lo tiene ahí (§18): el cliente no mueve ningún equipo.

## 7. Loser progression

`LOSER`: del partido terminado al siguiente en el que aparece su perdedor (cuadro bajo o
«Elimination» en GSL). Línea discontinua apagada; cuando el destino está en la fila inferior en
la misma columna, sale por debajo y entra por arriba. En eliminación simple no hay perdedor que
siga, así que no hay aristas LOSER.

## 8. Predicciones

Cada caja lleva su pregunta `match_winner` real (`questionId`, opciones = lados `a`/`b`, puntos
`q.points`, `locks_at`). Las dos filas son `<button aria-pressed>` cuando hay pregunta abierta y
equipos definidos; pulsar llama a `onPick(match, opción)` → `BracketPickemView` lo traduce a
`pick(question, option)` del hook (misma función que el tablero) → `/api/pickems` →
`app_submit_pick`. Sin API nueva, sin tabla nueva. La caja muestra: elige un ganador · +N pts /
Tu pick: X (puedes cambiarlo) / Bloqueada · Tu pick / ✓ Acertada · +N (de `points_award`) /
✕ Fallada · +0 / Sin predicción · Cerrada. Todo con texto y marca dibujada.

## 9. Locks

Intactos. `lockState` sale de `locks_at`/`locked`/`correct_option` de la pregunta (como en 24.2);
la cuenta atrás de cada caja usa el reloj compartido `useNow`; al llegar a cero recarga el lote y
el servidor decide. Un 409 del servidor revierte y marca «Cerrada» (lógica del hook, sin cambios).

## 10. Champion

La pregunta `champion` de 24.2 se muestra **encima del cuadro** como predicción destacada, con
la misma `PickQuestion`, la misma respuesta y el mismo cierre (prueba: aparece exactamente una
vez). No hay segunda submission.

## 11. TBD

Un partido sin los dos equipos pinta «Por definir» en cada hueco, sin botones, con el pie «Por
definir · sin predicción hasta que haya equipos». `canPickMatch` exige equipos + pregunta abierta.
No se inventan participantes ni emparejamientos futuros (§21: sin simulador de bracket).

## 12. Fallbacks

1. `UNKNOWN`/`LEAGUE`/`GROUP_STAGE`/`SWISS` → vista 24.2 (`data-view="league"`).
2. Formato eliminatorio pero `reliable = false` → vista 24.2.
3. Formato eliminatorio fiable pero sin aristas verificables → **cuadro sin líneas**: rondas en
   columnas, texto «las conexiones se dibujan cuando el backend confirma quién avanza» (§34).
4. Partidos sin pregunta → caja informativa («Sin predicción disponible»), sin botones.

## 13. Desktop

`TournamentBracket`: área desplazable propia (`overflow-x-auto`, fundidos laterales, scroll-snap
por ronda), fila alta (rama única/upper + gran final centrada) y fila «Cuadro bajo» debajo;
columnas de 280 px con `justify-around` para que cada ronda quede centrada respecto a la
anterior; navegación por rondas (botones `aria-pressed`) que desplaza a la columna; líneas SVG
medidas del DOM (`ResizeObserver`, sin bucle). La página nunca desborda (medido).

## 14. Mobile

Opción B: selector de ronda (botones ≥ 44 px) + tarjetas verticales a ancho completo; sin
líneas; una sola ronda montada (no dos versiones escondidas con CSS — un lector leería el cuadro
dos veces). Decide `useIsNarrow()` (`matchMedia (max-width: 767px)`). Botones y filas ≥ 44 px
(medido: 0 por debajo a 390).

## 15. Accesibilidad

`section` + `h3` por ronda («Cuartos · 4 partidos»), `article` por partido con
`aria-label="Cuartos: Team Heretics contra Fnatic"`, filas `<button>` con
`aria-label="Seleccionar X como ganador frente a Y"` y `aria-pressed`, foco visible
(`nx-focus`), pie con `role="status" aria-live="polite"`, conectores `aria-hidden`. Estados con
palabra + marca dibujada + insignia; el marcador con `aria-label`. Animaciones: entrada
escalonada por columna y pulso de selección, ambas bajo la regla global
`prefers-reduced-motion` (0,01 ms); las líneas no se mueven.

## 16. Performance

Partidos y fases se cargan en el **mismo lote** de `usePickem` (dos lecturas más, en paralelo
con las demás; el evento se lee primero para conocer `event_id`). Ni una petición por caja,
logo, conector o segundo. El modelo se reconstruye por minuto (`nowMinute`) y solo cambia de
identidad cuando cambia el lote; las líneas se recalculan por `ResizeObserver`.

## 17. Tests

**41 pruebas nuevas** (1087/1087 en verde; 1046 previas intactas, ninguna modificada):

- `domain/pickems/bracket.test.ts` (20): liga → no bracket (1); simple (2); doble upper/lower
  (3); grupos + playoff y GSL (4); unknown → fallback (5); no por nombre; etiquetas y orden de
  rondas (6); datos reales del partido y marcador (7-8); no fiable → fallback; layout doble;
  ganador del backend; TBD y TBD sin predicción (9-10); caja con pregunta/opciones/puntos del
  servidor (11, 18); seleccionada/bloqueada/acertada/fallada/sin pick (13-17); arista WINNER
  (19); arista LOSER (20); no se inventan (21); modelo válido sin aristas (22); grupos+playoff
  separan fases; determinismo.
- `components/pickems/bracket/bracket.test.tsx` (21): marcador real y ganador sin deducir (8);
  en juego / próximo; TBD sin botones (9-10); abierto con botones y aria-labels (11, 26);
  seleccionada; bloqueada no editable (14); correct/incorrect/no pick (15-17); solo lectura
  (33); la selección llama a `onPick` → mismo `pick` del hook, sin API propia (12-13);
  conectores solo desde aristas, sin SVG si no hay (21-22); desktop scroll + navegación (23-24);
  móvil selector + una ronda (25); teclado (26); estructura para lector (27); reduced motion
  (28); sin N+1 (29); vista bracket con campeón único y liga por su vista (30, 19); historial
  solo lectura (33); progreso 24.2 compartido (31); «Guardando…» fantasma; modo forzado.
- Regresión 24.1/24.2 (leaderboard, hub, progreso, servidor): las 1046 previas siguen en verde (32).

**Gates:** `npm test` 1087/1087 ✓ · `typecheck` ✓ (web + scripts) · `build` ✓ · `security:verify`
✓ · `pack:verify` ✓ · `content:verify` ✓ · `distribution:verify` 30/0 ✓ · lint de los ficheros
tocados 0/0. `test:pickems`: no ejecutable (requiere Supabase vivo).

## 18. QA visual

`scripts/_fase24-3-qa.ts` (fuera de CI), **91/91 ✓**, capturas en `docs/product/qa/fase24-3/`:
- **App real** (`next start`, sin backend): `/pickems`, `/pickems/historial`, `/ranking`,
  `/torneos`, `/coleccion`, `/inventario`, `/packs`, `/duelos`, `/progresion`, `/tienda`,
  `/mercado` a **1440 / 1024 / 390**: cargan, 0 excepciones de la app, 0 px de desbordamiento.
- **Render estático con fixtures etiquetados** (CSS de la build + logos servidos por la app;
  el conector se hidrata con un script que reproduce la misma geometría): eliminación simple
  (forma del seed de demo), doble eliminación (14 partidos, 8 rondas, 12 aristas), GSL
  (Opening → Winners/Elimination → Decider, 6 aristas), grupos + playoffs (pestañas de fase) e
  historial solo lectura, a 1440 / 1024 / 390. Comprobado: líneas dibujadas = aristas del
  modelo, página sin desbordar (el cuadro se desplaza en su área), botones ≥ 44 px, reparto
  móvil sin versión de escritorio, textos de estado (cuartos/semifinal/final, por definir, en
  juego, acertada, fallada, tu pick, campeón, +pts), solo 4 filas seleccionables en el fixture
  simple (los dos partidos abiertos con equipos).

## 19. Prueba real

**No realizada, y no se finge**: `.env.local` apunta al Supabase local (54521) que no existe y
no hay vía autorizada al de la VPS. No se pudo verificar en vivo: evento liga real → vista
normal; evento eliminatorio real → cuadro; pick desde una caja persistido tras refresh. Lo
verificable sin backend (render, estructura, aristas, estados, responsive, accesibilidad,
regresión de rutas) está verificado. El primer torneo real con fase `playoff` importado por VLR
activará el cuadro sin cambios de código; las líneas aparecerán con los primeros resultados.

## 20. Limitaciones reales

1. Sin flujo vivo ni `test:pickems` (entorno).
2. **Las líneas dependen de resultados**: antes del primer partido terminado el cuadro se
   enseña sin conexiones (por diseño: no se infiere el emparejamiento futuro). Un cuadro
   «completo» con todas las líneas de antemano exigiría `next_match_id`/slots en el modelo.
3. Las etiquetas de ronda no reconocidas («Serie 7») dan `UNKNOWN` → vista normal.
4. Doble eliminación: la gran final se coloca en la fila alta; la arista Lower Final → Grand
   Final se dibuja hacia la derecha y arriba (codo a mitad), sin línea de «reset» de gran final.
5. `Qualified` (GSL) no existe como nodo: no hay dato de clasificados en el origen real
   (`standings.status` no lo rellena el importador VLR); se muestran las rondas reales.
6. El render estático de QA muestra el `alt` de los logos que no existen como PNG (en la app
   corre el `onError` de `TeamLogo` y cae al monograma).
7. `PickemPanel` de `/torneos/[id]` mantiene el tablero de liga; la ficha del torneo ya tiene su
   propia escalera (`RoundLadder`, Fase 9) sin conectores. Unificarla con el cuadro es P2.

**P2:** unificar `RoundLadder` con `TournamentBracket`; drag-to-scroll (no hay helper en el
repo); línea de «reset» en gran final; cuando el modelo tenga `next_match_id`, dibujar el cuadro
completo antes de los resultados; contador de pendientes por fase en las pestañas.

## Archivos

**Creados:** `src/domain/pickems/bracket.ts`, `bracket.test.ts`;
`src/components/pickems/bracket/BracketMatch.tsx`, `BracketRound.tsx`, `BracketConnector.tsx`,
`TournamentBracket.tsx`, `BracketStageTabs.tsx`, `BracketPickemView.tsx`, `bracket.test.tsx`;
`src/lib/useMediaQuery.ts`; `scripts/_fase24-3-qa.ts`; `docs/product/qa/fase24-3/*`; este informe.

**Modificados:** `src/lib/game/client.ts` (`MatchRow.stage_id`/`winner_team`, `fetchStages`),
`src/lib/usePickem.ts` (partidos y fases en el lote), `src/app/pickems/page.tsx` (rama
liga/cuadro), `src/app/pickems/historial/[id]/page.tsx` (cuadro solo lectura),
`src/app/globals.css` (entrada escalonada, scroll-snap).

**No tocados:** Marketplace, packs/RNG/minting, colección, inventario, Duelos/PvP/rating,
Trainer, `teamIdentities`, Team Packs, rosters, economía, XP/levels, reward engine, migraciones,
`app_submit_pick`, `app_score_pickem_event`.

Sin `git commit`, sin `push`, sin `deploy`. Servidor de la app detenido al terminar.

**FASE 24.3 — CERRADA** (validación viva pendiente de entorno, documentada).
