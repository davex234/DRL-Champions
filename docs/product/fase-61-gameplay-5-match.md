# FASE 61 — GAMEPLAY 5.0 · THE MATCH

Fecha: 2026-09-25 · Rama `arch/stabilization` · sin commit, sin push, sin deploy · 0 migraciones.
Evidencia: `docs/product/qa/fase61-match/` (JSON + `screenshots/{before,after,live}`).

**Qué hace esta fase:** la partida de cartas (PvE contra bot, campaña, draft, ranked y duelo privado) pasa a tener
ritmo de videojuego —entrada en tres tiempos, rol del turno en grande, eje revelado antes que las cifras, clímax
de los últimos turnos, desempate en escena, golpe final, recompensas como fichas, «Jugar otra»— y salidas seguras
(diálogo con la consecuencia real, botón Atrás protegido, F5 sobre el resultado vuelve al resultado). Es
**presentación pura**: el motor, las reglas, el servidor, la economía y la BD no se tocan. La secuencia vive en un
módulo puro nuevo, `src/lib/duel/matchFlow.ts`, que no recibe semillas, no compara valores de combate y no produce puntos.

---

## 1. Baseline (medido antes de editar)

| | |
|---|---|
| git | `arch/stabilization`, HEAD `48dac2a`, 1.290 líneas en `git status` (trabajo sin commitear de fases previas) |
| tests | `npm test` **5144 / 5144** |
| migración head | `0057_admin_cms.sql` |
| cartas / agentes | **331** / **29** |
| marketplace / pagos | `GLOBAL_MARKET_ENABLED = false` / `PAYMENTS_ENABLED = false` |
| :3005 / túnel | nada escuchando / cerrado |

No medidos antes del primer cambio: `tsc`, `eslint`, `next build` (el lint final coincide con el valor documentado
tras F60: 27 avisos, 0 errores). Detalle: `baseline.json`.

**Reglas REALES leídas del código** (no del resumen del encargo, que resultó correcto):
`duel-turns-2`, 10 turnos (uno por carta), el atacante **alterna** (`attacker = other(attacker)` en el orquestador);
el atacante elige carta y estadística, el defensor elige carta y la estadística la **impone el servidor** con la tabla
SH↔EF, GS↔GS (`requiredDefenderStat`; el cliente ni la envía); turno empatado = **nadie puntúa** (`NO_POINT`);
final `duel-combat-2`: marcador → **suma de OVR (+1 punto)** → **total de estadística declarada (sin punto)** →
**empate explícito** (`DRAW`, `decidedBy: NONE`). Bots: Fácil / Normal / Difícil.

## 2. Flujo anterior

`/duelos/jugar` (inmersiva): pre-partida → intro «VS» de 1,6 s (0,5 s en reducido) → tablero F50 → revelación del
turno → golpe final (1,2 s; 0,42 s en reducido) → resultado. `/duelos/pvp` **no** inmersiva: cola → «Rival encontrado»
(F55) → arena → resultado dentro del armazón con la barra de secciones.

## 3. Problemas encontrados (lo que lo hacía parecer una web)

1. **Entrada plana** (`before/fase50-intro-*`): dos nombres, una fila de 10 dorsos y otra de 10 miniaturas de 54 px.
   Nada de «rival encontrado» ni presentación del equipo. En reducido (lo que ve el usuario) duraba 0,5 s.
2. **Quién ataca** era una etiqueta de 9 px bajo el turno de la barra.
3. **Sin revelación del eje**: estadística, cifras y veredicto entraban casi a la vez; en reducido todo a la vez.
4. **Desempate silencioso**: un 5–5 terminaba en «VICTORIA 6–5» y el porqué quedaba en un panel bajo el pliegue.
5. **Resultado de cajas dentro de cajas** (recompensa en una fila con borde), acción principal «Revancha».
6. **«Salir» borraba la partida de un clic** (`abandonDuel` sin confirmar) y **Atrás** sacaba de la arena sin avisar.
7. **PvP dentro del armazón** (barra de secciones durante la partida) y **el último turno PvP no se veía**: la página
   saltaba al resultado en cuanto el servidor declaraba la partida terminada.
8. **F5 sobre el resultado** (PvE) volvía a la pre-partida (la partida terminada ya no es «activa»). Encontrado en la
   QA real; no duplicaba nada, pero no recuperaba.
9. El golpe final en reducido (0,42 s) era un parpadeo.

## 4. Flujo final

JUGAR / Comenzar duelo → **RIVAL PREPARADO** (bot) o **RIVAL ENCONTRADO** (persona) → **VS** → **TU EQUIPO SALTA A LA
MESA** (10 cartas reales) → campo con **ATACAS / DEFIENDES / ESPERANDO AL RIVAL** → cada turno: cartas → **eje** →
valores → comparación → veredicto → marcador → **recta final** (8–9) y **último turno** (10) → **desempate en escena**
(solo si hizo falta) → **VICTORIA / DERROTA / EMPATE** → resultado con **recompensas** o **Elo** → **JUGAR OTRA** /
Cambiar rival o mazo / Volver al lobby. Una sola experiencia para bot, campaña, draft, ranked y privado
(adaptadores: rótulo del primer tiempo, salida y acción final por modo).

## 5. Match Found

`MatchIntro` tiempo **FOUND** (~0,85 s): modo, titular y rival. Contra el bot dice «Rival preparado · Bot · Dificultad
Normal» (no se «encuentra» a nadie ni se inventa un nombre); en ranked/privado «Rival encontrado · Jugador real» con
el avatar público si el servidor lo dio. Ranked conserva su «Rival encontrado» de F55 (con rating y puesto reales) y
la entrada continúa desde el equipo (`from="LINEUP"`). Sonido `match.vs`/`match.lineup` (sintetizados).

## 6. VS

Tiempo **VERSUS** (~1,25 s): tu equipo a la izquierda (cian), el rival a la derecha (rojo), sello VS grande, fuerza
Σ OVR **de la vista** y quién abre («Abres tú: atacas en el turno 1» / «Abre el rival: defiendes…»). Sin rangos ni
estadísticas inventadas (test `F61 UI 02/03`).

## 7. Team intro

Tiempo **LINEUP** (~1,4 s): tus 10 cartas con **CardArt real** (`DuelCard` pinta la imagen impresa del catálogo),
ordenadas por rol y OVR, las tres de más OVR destacadas, recuento por rol y Σ. El rival: solo **cuántas** cartas tiene,
boca abajo (su mazo no está en la vista; en PvP llega redactado). En móvil, dos filas de cinco sin el trío superpuesto.

## 8. Battlefield

Se conserva el tablero F50 (rival arriba, duelo en el centro, tú abajo, marcador en los flancos, mano en abanico) y se
añade lo que faltaba de jerarquía: el **cartel del rol** encima del VS y el **tramo** (`data-climax`) en el escenario.
PvP pasa a **modo partida enfocado** (ruta inmersiva, sin barra de secciones).

## 9. Attacker / defender

`roleBanner` (desde `youAreAttacker`, `pendingRival`, `requiredStat` del servidor): **ATACAS · Elige carta y
estadística**, **DEFIENDES · Respondes con Stronghold**, **ESPERANDO AL RIVAL**. Icono propio (espada / escudo /
reloj) + texto; el color acompaña, nunca sustituye. En móvil lo dice la cinta del turno con el mismo icono.

## 10. Stat reveal

En la revelación del turno, entre las cartas y **antes de las cifras**: «Declaras / Declara el rival · STRONGHOLD ·
responde con ENTRYFRAG», con los ejes tal como los guardó el servidor en el turno (`statReveal`). Sonido `stat.reveal`.

## 11. Combat sequence

`MOMENT_BEATS` (s): cartas 0 → **eje 0,34** → valores 0,72 → comparación 1,08 → veredicto 1,28 (reducido: 0 · 0,22 ·
0,48 · 0,72 · 0,86, solo fundidos). Se queda 3 s (3,2 s recta final, 3,5 s último turno); Intro/Espacio/Escape o clic
pasan. La animación consume estado: la jugada ya está resuelta y aplicada cuando se monta.

## 12. Score

Marcador en la barra y en los flancos (F50); en la revelación, el marcador tras el turno (`scoreAfterYou/Rival`).
«TURNO N DE 10» en la cabecera de la revelación.

## 13. Timeline

La pista de los diez turnos (F33/F50, `buildTimeline`) en la barra y, en móvil, bajo la mano (ganado/perdido/empate/
en juego/pendiente, tocable para el detalle). Sin cambios de fondo en F61; cubierta por `F61 UI 09`.

## 14. Tiebreak

`TiebreakReveal` entre el último turno y el golpe final, **solo si `decidedBy !== "SCORE"`** y **solo si el final se
vio en directo** (`endSequence`). Pasos reales de `decisionSteps`: Turnos ganados 5–5 (empate) → Suma de OVR 939–932
(para ti, **+1 punto**) → [Total de estadísticas (sin punto)] → [Empate total]. ~1,15 s por paso, saltable.
Semillas reales: 11 de 120 partidas del motor puro se deciden por OVR; `STAT_MARGIN`/`NONE` aparecen en espejos.

## 15. Victory

`MatchComplete` «VICTORIA» + marcador (1,2 s; **1 s en reducido**, antes 0,42) → `ResultScreen` en el estadio.

## 16. Defeat

Misma calidad, sin barrido de celebración (F44), «El rango solo sube ganando» en la ficha de puntos. Verificado en
partidas reales (`live/pve-09-end-complete-loss.png`, `pve-10-result.png`).

## 17. Draw

Pantalla propia (`data-verdict="DRAW"`), y si fue empate total, el desempate lo explica («Empate total»).

## 18. Rewards

Las cifras de `result.award` (servidor), como **fichas** que entran una detrás de otra; ninguna se suma aquí. PvE real:
**+40 créditos, +25 XP** en derrota (3590 → 3630) y **una sola vez** (recarga y abandono no pagan). Draft y PvP no
muestran recompensa (no la hay).

## 19. Ranked / Elo

PvP: «Rating PvP · antes 980 → después 962 · −18» (evento real de la liquidación, provisional señalado), puesto en la
escalera; sin rangos con nombre (contrato F28/F55). Verificado con dos cuentas: 980/1020 → 962/1038 → 946/1054.

## 20. Play Again

PvE: **JUGAR OTRA** («Revancha · mismo equipo y rival»): el servidor crea una partida NUEVA con el mismo equipo y la
misma dificultad (no hay backend de revancha que finja otra cosa). Secundarias: Cambiar rival o mazo, Ver la partida,
Mis mazos, Volver al lobby, Salir a Duelos. Ranked: «Buscar otro rival» vuelve a la cola (F55). Privado: su revancha
social real (F29).

## 21. Bots

Fácil / Normal / Difícil sin cambios (el servidor decide y juega al bot). Misma presentación que ranked. PvE real
jugado contra Normal: 3 partidas completas (3 pagos de +40, uno por partida: 3510→3550→3590→3630) y 4 abandonadas
(QA: descartadas, sin pago).

## 22. Human multiplayer

Mismo `MatchIntro` (desde LINEUP tras «Rival encontrado»), mismo tablero y revelación, **final vivido** (`MatchEnding`:
último turno → desempate → golpe final encima del resultado). Ver §41.

## 23. Refresh / recovery

- Pre-partida: F5 → pre-partida.
- A mitad de partida: F5 → **mismo turno 5 y marcador que el servidor**, sin entrada, con «Partida recuperada».
- Tras un turno: la revelación ya estaba aplicada; se vuelve al turno siguiente (no se re-reproduce).
- Resultado: F5 → **el mismo resultado** (`?resultado=<id>` + `getMatch` del propietario), sin golpe final ni desempate
  y **sin pago** (créditos 3630 = 3630). `recovery.json`.

## 24. Disconnect

PvP: el poller existente (F26/F33) muestra «resincronizando»/error con reintento; «ESPERANDO AL RIVAL» con el reloj del
turno; al agotarse el tiempo el servidor cierra (`EXPIRED`). PvE no sondea: un fallo de red se ve como error con
reintento. **No se forzó una desconexión en esta QA** (limitación).

## 25. Idempotence

Doble clic en confirmar → **1 turno** (0 → 1). Intro + clic sobre «Continuar» → un solo cierre (`matchId:turno`).
Respuesta repetida tras el final → **409 antes de pagar**; pago con `ref duel:<matchId>`. Recarga del resultado → sin
pago. PvP: `actionId` + `expectedVersion`; recargar el resultado no mueve el rating (946 = 946). `idempotence.json`.

## 26. Audio

Sistema existente (`lib/sound`, sintetizado, silencio/volumen/música de F44.1). Cuatro eventos nuevos, sin ficheros:
`match.vs`, `match.lineup`, `stat.reveal`, `tiebreak.step`. Silencio sin gesto previo (política de autoplay).

## 27. Motion

Primitivas: **entrar** (cartas/bandos), **revelar** (eje, cifras), **impacto** (onda F50 + sello «Gana»), **marcador**,
**celebrar** (corona/barrido solo en victoria), **salir** (fundidos). Solo `transform`/`opacity`/sombras; sin blur ni
grano. CSS nuevo al final de `game-experience.css` (sección F61), todo bajo `no-preference`.

## 28. Reduced motion

El PC del usuario reporta `reduce`: la entrada conserva sus **tres tiempos** (2,9 s, fundidos), la revelación conserva
el orden eje → cifras → veredicto, el golpe final dura 1 s. Capturas `*-reduced.png` (1440 y 390).

## 29. Desktop (1440)

Entrada a pantalla completa, equipo en una fila de 10 cartas grandes, tablero a 1320 px, revelación con cartas de
hasta 250 px, resultado a 896 px con fichas.

## 30. Tablet (1024)

Mismas escenas, sin desbordes (`after/*-1024x768.png`).

## 31. Mobile (390)

Equipo en 2×5, rol en la cinta del turno con icono, revelación vertical (rival arriba, tú abajo) con eje en medio,
botones ≥44 px, resultado en una columna. 0 desbordes con la medición refinada.

## 32. Performance

Solo las cartas de la partida: ~24 imágenes por escena (1.680 en 69 capturas), `loading="lazy"`; nada del catálogo
entero. Sin WebGL, blur ni grano. Build de producción OK.

## 33. Accessibility

Rol con icono + texto; diálogos con `role="dialog"/"alertdialog"`, nombre y foco en «Seguir jugando»; Intro/Espacio/
Escape en entrada, revelación, desempate y golpe final; `aria-live` en el desempate; contraste de textos sobre velo.

## 34. Engine changed: **NO**

Ficheros del motor con fecha 2026-09-03 (resolver, rules, orchestrator) y servicios 08–21/09. Huella dorada de 120
partidas medida antes de editar y fijada en `F61 MOTOR 01` (`590d2997…`).

## 35. Gameplay rules changed: **NO**
## 36. Economy changed: **NO**
## 37. Cards changed: **NO** (331)
## 38. Agents changed: **NO** (29)

## 39. Admin affected

No. Ningún fichero de `/admin` ni del CMS.

## 40. DB migrations

Ninguna. Head sigue en `0057`.

## 41. Two-account QA

Cuentas QA `1ff2c0ef` (A, Chrome) y `8c326e52` (B, API). Dos partidas ranked reales (`multiplayer.json`):
cola → «Rival encontrado» → equipo → 10 turnos → último turno → DERROTA → resultado con Elo. En **21 sondeos por
partida, 0 discrepancias**: mismo turno, mismo marcador absoluto y nunca los dos con el turno. Final idéntico en los
dos lados (gana B 3–7, `SCORE`). Rating 980→962→946 (A) / 1020→1038→1054 (B). No se usó la cuenta del usuario.
Límite: B jugó por API (se verificó su vista, no su pantalla).

## 42. Tests before / after

**5144 → 5180**, 0 fallos. Nuevos: `src/lib/duel/f61.match.test.tsx` (32: motor, UI, salida, autoridad, idempotencia,
recuperación, audio) + 4 generados por `immersion.contract` (uno por evento de sonido nuevo). Pins reescritos (no debilitados) porque fijaban lo que F61 cambia:
`INTRO 02` (1–3 s / ≤0,8 s → 2–5 s / ≥1,5 s), `A4` (temporizador de la entrada), `COMPLETE 04` (≤0,5 s → 0,8 s–1,2 s),
`AUDIO 46` (catálogo +4), `UI_FILES` (+6), modelo de pantallas (`/duelos/pvp` inmersiva).

## 43. tsc web — OK · 44. tsc scripts — OK · 45. lint — 0 errores, 27 avisos (los de base, ninguno en F61)

## 46. build — `npm run build` exit 0, `prerender-manifest.json` presente.

## 47. :3005

`next start -p 3005` de la build nueva (lanzado por WMI, independiente), HTTP 200. Antes de cada parada se comprobó
que el proceso que escuchaba era el lanzado en esta sesión.

## 48. Tunnel

SSH a la BD del VPS abierto (54521/54522) y **se deja abierto**: sin él la app responde 401 a los ~38 s (F51.3.1).

## 49. Files

Modificados (parches quirúrgicos sobre trabajo previo sin commitear): `components/duel/{MatchIntro,DuelMoment,
MatchBoard,ResultScreen,MatchComplete}.tsx`, `components/duel/experience/MatchHud.tsx`, `components/duel/pvp/PvpArena.tsx`,
`app/duelos/{jugar,pvp}/page.tsx`, `app/game-experience.css`, `lib/sound.ts`, `lib/duel/gameplayUx.ts`, `design/nav.ts`,
`design/gameShell.ts`; tests `lib/duel/duel.test.ts`, `lib/audio/audio.test.tsx`, `components/duel/{gameplay.contract,
matchExperience.render}.test.*`.
Nuevos: `lib/duel/{matchFlow.ts,useLeaveGuard.ts,f61.match.test.tsx}`, `components/duel/experience/{RoleIcon,
TiebreakReveal,LeaveMatchDialog,MatchEnding}.tsx`, arnés `app/design-system/fase61/page.tsx`, instrumentos
`scripts/_fase61-{shots,live,digest,apiturn,evidence}.ts`, este informe y `docs/product/qa/fase61-match/**`.

## 50. Limitations

- Desconexión forzada no probada; PvE no tiene «reconectando» (no sondea).
- La cuenta B del QA PvP jugó por API: su pantalla no se fotografió.
- F5 sobre el resultado de una partida de **campaña** vuelve a la pre-partida del nodo (el banner de campaña necesita
  su propio contexto); la recompensa no se repite.
- El desempate STAT_MARGIN/NONE solo aparece con mazos espejo en el motor puro: en real no se vio (sí OVR en arnés).
- Victoria real no se dio (el bot Normal ganó las partidas de QA): la victoria se validó en arnés con partidas del motor.
- `/api/telemetry` da 503 en el arnés de desarrollo (sin Supabase); en la app real, 0 errores de consola.

## 51. GO

**GO.** Se puede pulsar JUGAR y vivir RIVAL → VS → EQUIPO → PARTIDA → TURNOS → RESULTADO → RECOMPENSAS → JUGAR OTRA como
una experiencia coherente, con el motor, la autoridad del servidor, la idempotencia, el competitivo, los bots, las 331
cartas, los 29 agentes, la economía y el Admin intactos, marketplace y pagos apagados, tests y build en verde.

FASE 61 — CERRADA
