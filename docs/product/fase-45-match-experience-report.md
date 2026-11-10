# Fase 45 · Match Experience 3.0 — del lobby a la arena — informe

Fecha: 2026-09-18 · Rama `arch/stabilization` · sin commit, sin push, sin deploy, sin Docker, **0 migraciones**.

> **Regla de la fase:** no se han tocado las reglas del combate. Ni la fórmula, ni los 10 turnos, ni la alternancia de
> ataque, ni el eje impuesto por el servidor, ni los desempates, ni OVR, ni estadísticas, ni cartas, ni rarezas, ni
> series, ni legalidad de mazo, ni bots, ni recompensas, ni rating, ni economía. Esta fase es **presentación**.

---

## 1 · Baseline real

`npm test` al abrir la sesión: **4457 pruebas, 4457 verdes**. El encargo hablaba de 4.243; esa cifra es anterior a la
sesión previa de F45, que dejó ~214 pruebas nuevas en el árbol de trabajo sin commitear.

Al ejecutar `tsc` por primera vez aparecieron **3 errores de tipos preexistentes** en pruebas de la sesión anterior
(`matchSecurity.test.ts` ×2, `matchSession.test.ts` ×1). No los detectaba nadie porque el ejecutor de Node borra los
tipos y las pruebas pasaban igual. Corregidos (§11).

## 2 · Arquitectura encontrada

`/duelos/jugar` es **inmersiva** (`IMMERSIVE_ROUTES` en `src/design/nav.ts`): el armazón del lobby se aparta y la
partida ocupa el viewport. Las capturas del arnés `/design-system/fase45` sí llevan la barra del lobby porque el arnés
vive dentro del armazón; no es el estado de la ruta real.

| | Piezas |
|---|---|
| **SHARED** | `MatchBoard`, `ArenaSurface`, `MatchHud`, `DuelMoment`, `MatchIntro`, `PreMatch`, `ResultScreen`, `MatchComplete`, `ClashBanner`, `PlayedRow`, `HandFan`, `matchSession`, `matchView`, `experience.ts`, `sound.ts` |
| **MODE-SPECIFIC** | `CampaignPreMatch`, `CampaignResultBanner`, cliente de draft, `pvpTransport` / `pvpPoller` / `usePvpQueue` |
| **DEAD/LEGACY** | ninguna pieza retirada esta fase |

Los cuatro modos (PvE, Ranked/PvP, Campaña, Draft) entran por el **mismo** `MatchBoard`. Por eso el rediseño de la
arena llega a los cuatro sin duplicar nada.

## 3 · PvP/Ranked real encontrado

**PvP EXISTE y está completo.** No es «NOT APPLICABLE» y no se ha inventado nada:

- `POST/GET /api/game/duel/matchmaking` — cola real.
- `POST/GET /api/game/duel/pvp` — sincronización por sondeo, `actionId` + `expectedVersion`, abandono, límites de
  ritmo, 404 (no 403) para partidas ajenas para no regalar un oráculo de enumeración.
- Liquidación de rating en `duelsRating`; `GET /api/game/competitive` es **solo lectura** (no hay `POST`).

Lo que **no** se ha hecho: QA real de PvP. Requiere dos jugadores reales simultáneos; no se ha falseado.

## 4–7 · Play Hub, transición, PreMatch, intro

Construidos en la sesión anterior de esta misma fase y **conservados**: hub con identidad por modo y reacción del
mundo (`focusEnvironment`), banda de partida abierta con una única acción dominante, preparación breve, intro con
`MATCH_INTRO_MS` saltable con clic/Enter/Espacio y versión reducida. No se ha vuelto a tocar.

## 8 · Arena 2.5D — **el trabajo de esta sesión**

### Qué había

La sesión anterior había añadido ~40 líneas de CSS (`.nx-arena-stage`: dos pseudo-elementos con un resplandor). La
captura del tablero seguía enseñando, literalmente:

- **veinte rectángulos vacíos** con forma de carta (diez por bando), que a 1440 ocupaban más superficie que las
  cartas, el marcador y el enfrentamiento juntos;
- una **columna lateral fija de 300 px** con una parrilla de turnos y un recuadro «Historial» casi siempre vacío;
- una mesa **opaca** flotando sobre color de página, con 460 px muertos a los lados a 1440 y 1.580 a 2560.

Eso es, punto por punto, la lista de NO-GO del encargo: *cards dentro de panels*, *fondo vacío*, *arena parece
dashboard*. Se rehízo.

### Qué hay ahora

**`ArenaEnvironment` (nuevo).** Un recinto a sangre (`left-1/2 w-screen`) por debajo de la mesa, en siete planos, todo
CSS: fondo con gradiente atmosférico, **techo** en fuga, **horizonte** teñido por quien ataca, **suelo** en
perspectiva que converge, **pilonas** de luz por bando, **baño** del atacante y viñeta. Sin WebGL, sin canvas, sin
vídeo, sin blur animado. Las motas son **doce, contadas en el fuente** (`const MOTAS = Array.from({ length: 12 })`),
no un sistema de partículas. Sólo dos animaciones, ambas sobre `transform`/`opacity`; con `prefers-reduced-motion:
reduce` no se declara ninguna.

**La mesa se abre al recinto.** Canto y tapete pasan de opacos a translúcidos (`rgba`), de modo que **el suelo se lee
a través de la mesa**. Eso es lo que convierte «un tablero sobre un fondo» en «una mesa apoyada en un sitio».

**Las veinte cajas vacías desaparecen.** La casilla sin jugar pasa de placa con forma de carta a **ficha baja**
(`--pos × 0.34`). La fila **reserva su altura igualmente** (`min-h`), así que la mesa sigue sin moverse entre el turno
1 y el 2 —lo que costó arreglar en su día— pero el espacio reservado ahora lo ocupa el recinto, no veinte huecos.

**El historial deja de ser un panel y pasa a ser un cajón** (`match-history-toggle` → `match-history-drawer`,
`role="dialog"` + `aria-modal`, cierre con Escape, desplazable). Misma información: `TurnTimeline` y `TurnHistory`
intactos.

**Charco de luz** (`.nx-clash-pool`) bajo la zona de enfrentamiento, teñido por `--env-tone`: ata el choque al suelo.

## 9 · Las cartas

La carta **en juego** pasa de `--pos × 1.5` a `--pos × 2.05` (~165 px a 1440); las filas de lo jugado bajan a
`--pos × 0.82`. Entre la carta que pelea y la que ya peleó hay ahora un factor **2,5**: la jerarquía se ve sin leer.
En la revelación la carta llega a **196 px**, la mayor de toda la partida.

## 10–12 · Turno, Stat Clash, impacto

**`ClashBanner` partido en dos presentaciones del mismo dato.** En espera sigue siendo una placa discreta. **Resuelto**
es otro momento: la cifra ganadora va a `clamp(44px, 9vh, 96px)` —hasta ~3× lo anterior—, el perdedor baja a media
opacidad sin desaparecer (hay que poder comparar), el «vs» pasa de texto de 11 px a un **sello** con disco teñido, y
el veredicto deja de ser un rótulo de 10 px para ser una **frase** de hasta 26 px. El empate tiene tratamiento propio:
ámbar y «**0 puntos**» explícito.

**Ambigüedad de color corregida.** La cifra se tiñe con el color del **eje** (Stronghold rojo, Gamesense azul,
Entryfrag verde), pero los **bandos** también tienen color (tú verde, rival rojo): un 87 en Stronghold es rojo aunque
sea tuyo. Se añade el rótulo del bando encima de cada cifra, así que quién gana no depende de ningún color.

**`DuelMoment` recompuesto en espejo.** Era una columna de 600 px con dos filas idénticas —carta a la izquierda, cifra
a la derecha, ~250 px muertos— que no se leía como un enfrentamiento sino como una lista de dos elementos. Ahora los
dos bandos **se miran**: el rival entra por arriba, tú por abajo en espejo, cada cifra viaja pegada a su carta y la
placa se ajusta al grupo (`w-fit`) en vez de ser un panel de 860 px con las cartas dentro.

**Nada de esto compara nada.** `winner`, `youValue` y `rivalValue` llegan decididos del servidor; el impacto se lee de
`turnImpact(view.history[n].outcome)`. Verificado por prueba: el tablero no puede comparar valores.

## 13–17 · Marcador, progreso, historial, audio, último turno

Conservados de la sesión anterior: marcador animado sólo al cambiar (`key` en el valor), pista de diez turnos grabada
en el canto de la mesa, tres señales de turno nuevas en `src/lib/sound.ts` (20 → 23 eventos) reutilizando los
contextos `MATCH`/`RESULT` de F44.1 —**no hay un segundo AudioManager**—, y último turno marcado en mesa y recinto
(`[data-final="true"]`).

## 18–23 · Victoria, derrota, empate, resultado, recompensas, jugar otra

Conservados: `MatchComplete` (1200 ms / 420 ms reducido, saltable, `role="dialog"`), resultado con recompensas
**sólo** las que devuelve el backend, y `PLAY AGAIN` como acción dominante.

## 24–27 · PvE, Campaña, Draft, Ranked/PvP

Los cuatro heredan la arena nueva por construcción (mismo `MatchBoard`). `MatchBoard` acepta `arena="quick" | "ranked"
| "campaign" | "draft"`, que cambia **la temperatura del recinto y nada más** (`--env-tone-b`). Una sola arena, cuatro
matices. Draft sigue sin economía; campaña sigue con su primera victoria idempotente: no se ha tocado ni una regla.

## 28–30 · Mobile, desktop, ultrawide, movimiento reducido

- **390**: verificado por captura. Filas compactas, carta en juego a `--pos × 1.9`, suelo visible, todo legible.
- **1440/1920**: la mesa mantiene su ancho derivado del juego y el recinto llena los flancos.
- **2560**: verificado por captura — el **entorno** se expande, las cartas **no** se estiran.
- **Reducido**: el recinto sigue estando, quieto. Prueba dedicada (`ARENA 10c`).

## 31–34 · Refresh/resume, idempotencia, seguridad, rendimiento

Sin cambios de comportamiento: no se ha tocado `matchSession`, ni el cliente de duelo, ni ninguna ruta de API. Los
invariantes de autoridad siguen verdes (§36). El recinto es `pointer-events-none`, `aria-hidden`, con `contain:
strict` para que no pueda forzar reflow de la partida, y sin `requestAnimationFrame`.

## 35 · QA real — **NO EJECUTADA (bloqueo real)**

**No se ha jugado ninguna partida real esta sesión, y no se declara lo contrario.**

El instrumento existe y está bien hecho (`scripts/_fase45-playtest.ts`: juega los diez turnos a clics, prueba el doble
clic, toma huella de BD **antes y después** en solo lectura por SSH, sin forzar SQL). El túnel SSH al VPS se abrió y
funciona (`127.0.0.1:54521` → 200), y la clave SSH está disponible.

Lo que falta es **el fichero de credenciales de la cuenta QA**, que —correctamente— no vive en el repositorio. Sin él
no hay sesión, y sin sesión no hay partida. No se ha creado una cuenta nueva: eso escribe en la base real y no estaba
autorizado.

**Para desbloquearlo hacen falta dos órdenes tuyas con la ruta del fichero:**

```
npx tsx scripts/_fase45-qa.ts       <credsFile> http://127.0.0.1:3005
npx tsx scripts/_fase45-playtest.ts <credsFile> http://127.0.0.1:3005 --difficulties=EASY
```

Eso produce `ui-qa.json` y `playtest.json`, que son exactamente lo que piden las **8 comprobaciones de navegador** que
hoy fallan en el verificador.

## 36 · Capturas

**102 capturas nuevas** de esta build en `docs/product/qa/fase45/arena/`, 0 fallidas. Cubren arena (37), enfrentamiento
(25), hub (17), turno, marcador, golpe final, resultado y móvil, en 390/768/1440/1920/2560 según grupo, más las escenas
reducidas en su propia condición.

La tanda no llegó a las 292 tomas posibles porque **el guardián de memoria la paró cuatro veces** al bajar de 2 GB
libres (la máquina tiene 16 GB y ya sostiene la app de producción y el Chrome del usuario). Es el comportamiento
correcto y el que pedía el encargo: parar antes que agotar la RAM. El checkpoint permite reanudar cuando haya margen;
102 supera con holgura el mínimo de 60 que pediste.

Las **204 capturas anteriores** en `.../after/` son de la build previa y **ya no representan el producto**: enseñan la
arena vieja. Quedan como «antes» hasta que la tanda nueva termine.

Runner nuevo (`scripts/_fase45-arena-shots.ts`) con lo aprendido en F44.1: un Chrome por lote, lotes de 5–8,
checkpoint por captura, arranque sólo con ≥3 GB libres, **parada automática por debajo de 2 GB** (se disparó una vez y
paró limpiamente), captura a disco inmediata, y **0 Chrome huérfanos** — comprobado por línea de comandos: sólo mata
lo que él lanzó, nunca los procesos del usuario.

## 37 · Tests

`npm test` final: **4459 pruebas, 4459 verdes, 0 fallos** (ejecución completa, exit 0). Neto de la sesión: **+2
pruebas** y **4 pruebas reescritas**.

Tres pruebas fallaron al recomponer la arena, y **las tres tenían razón en fallar**:

1. `RESPONSIVE 02` y `ARENA 10` fijaban `xl:grid-cols-[minmax(0,1fr)_300px]`, es decir, la columna de cuadro de mandos
   que la fase venía a quitar. Reescritas con un contrato **más exigente**, no más laxo: ahora exigen que esa columna
   **no exista** y que el historial siga siendo alcanzable con disparador, diálogo modal y salida por Escape.
2. `A10` (`gameplay.contract`) protegía «la mesa no se mueve entre turnos» **a través de** esa misma rejilla. Reescrita
   sobre el mecanismo nuevo: la reserva de altura de la fila de posiciones.
3. `INVARIANTE · todo componente de duelo…` detectó que `ArenaEnvironment.tsx` era un componente nuevo fuera de
   `UI_FILES`. Añadido, que es lo que pedía: ahora está bajo los mismos invariantes (sin azar, sin orquestador, sin BD,
   sin `localStorage`).

Pruebas nuevas: `ARENA 10b` (el recinto es fondo y nada más: sin puntero, sin WebGL/canvas/vídeo, motas contadas) y
`ARENA 10c` (se apaga entero con movimiento reducido). `ARENA 10b` lee el **código sin comentarios**, con la misma
convención que `matchSecurity.test.ts`: la primera versión se tropezaba con la propia cabecera del fichero, que dice
«cero WebGL».

## 38 · Gates

| Gate | Resultado |
|---|---|
| `npm test` | **4459/4459 · 0 fallos · exit 0** |
| `tsc` web | **0 errores** (3 preexistentes corregidos) |
| `tsc` scripts | **0 errores** |
| `next build` | **exit 0** |
| ESLint (ficheros tocados) | **0** |
| `match-arena:verify` | 10/12 — los 2 fallos son de navegador (§35) |
| `match-experience:verify` | 51/60 — **8 de los 9 fallos** son de navegador (§35); el 9.º es el reparto de capturas, en curso |

`next lint` está roto en el repo (`next lint` ya no acepta `--dir` en esta versión de Next y el script `lint` falla
solo). **Preexistente, no de esta fase.** ESLint se ejecutó directamente con `ESLINT_USE_FLAT_CONFIG=false`.

## 39 · Bugs encontrados / corregidos

1. **3 errores de `tsc` preexistentes** en pruebas de la sesión anterior, invisibles para `npm test`. Corregidos. Uno
   era sustantivo: `matchSession.test.ts` fuzzeaba con `status: "FINISHED"`, **un estado que no existe** en
   `MatchStatus`. Sustituido por `"COMPLETED"`, que es terminal de verdad.
2. Ambigüedad de color en el enfrentamiento (eje vs bando) — corregida con el rótulo del bando.

## 40–42 · Gameplay, economía, BD

**Gameplay: 0 cambios. Economía: 0 cambios. BD/migraciones: 0.** Ninguna ruta de API, ningún servicio de servidor,
ningún fichero de dominio ha sido tocado. Marketplace OFF, worker de Pick'ems intacto, infraestructura intacta.

## 43 · P2 reales (deudas, documentadas, no arregladas)

1. **QA real pendiente** (§35) — el único bloqueo con impacto sobre el GO.
2. **`scripts/_fase45-shots.ts` no arranca Chrome** en este entorno («Chrome no expuso el puerto de depuración»)
   incluso con túnel y RAM. `_fase45-arena-shots.ts` sí funciona; el runner viejo queda por diagnosticar.
3. **El script `lint` del repo está roto** (preexistente).
4. La marca de agua «NEXUS · VALORANT CARDS» se cuela en las capturas del arnés. Es el fondo de
   `/design-system`, **no** de la ruta inmersiva; no afecta al producto, sí ensucia la evidencia.

## 44 · Estado final del entorno

- App: `next start` en `:3005` **levantada** (build de producción de esta sesión). El arnés
  `http://127.0.0.1:3005/design-system/fase45?scene=arena-mid` funciona **sin túnel**.
- Túnel SSH 54521/54522 al VPS: **CERRADO** (se abrió para las capturas y se cerró al terminar). Para reabrirlo:
  `ssh -i ~/.ssh/id_ed25519 -N -L 54521:127.0.0.1:54521 -L 54522:127.0.0.1:54522 nexusadmin@212.95.40.144`
- Chrome sin cabeza: **0 procesos huérfanos** (comprobado por línea de comandos).
- El Chrome del usuario y cualquier otro proceso suyo: **intactos**, nunca se mató nada ajeno.
- Git: **sin commit, sin push, sin reset, sin checkout, sin stash**.

## 45 · GO / NO-GO

### ~~NO-GO parcial — la arena es GO, la fase no puede cerrarse sin jugar una partida.~~

> **SUPERADO el 2026-09-18.** La partida real se jugó (nueve, de hecho). Veredicto final en el **ADDENDUM DE CIERRE**
> al pie de este documento: **GO**.

**GO en lo visual.** El producto ya no es lo que el encargo describe como fracaso: la mesa vive dentro de un recinto
con suelo, horizonte y luz por bando; los veinte huecos vacíos y la columna de cuadro de mandos ya no existen; la
carta en juego pesa 2,5× lo que pesa una jugada; y el `87 VS 82` pasó de una píldora gris de 31 px a un momento con
cifras de hasta 96 px, sello, veredicto en frase y empate con «0 puntos» explícito. Verificado a 390, 1440, 1920 y
2560, y con movimiento reducido.

**NO-GO formal por una razón, y es la que tú mismo pusiste primero:** el encargo dice *«ABRE EL JUEGO. JUEGA.
MÍRALO.»* y §37 pide **1 PvE Easy real completa**. No la he jugado — falta el fichero de credenciales de la cuenta QA
(§35). He mirado la arena en 74+ capturas de esta build, pero mirar el arnés no es jugar una partida, y no voy a
declarar GO sobre una comprobación que no he hecho.

Dame la ruta del fichero de credenciales y cierro §35, las 8 comprobaciones de navegador y el GO en una pasada.

---

# ADDENDUM DE CIERRE · playtest real (2026-09-18)

Ejecutado con la autorización explícita de crear **una** cuenta QA temporal. Sin tocar datos de usuarios existentes.

## 1 · Cuenta QA creada

| | |
|---|---|
| **user id** | `1ff2c0ef-d469-494d-b5ee-e728f7fbc865` |
| **email** | `qa-f45-20260918085748@example.invalid` (dominio reservado RFC 2606: no es de nadie) |
| **creada** | `2026-09-18T08:57:48.346Z` |
| **contraseña** | aleatoria (18 bytes), sólo en un fichero fuera del repositorio con permisos restringidos; nunca impresa |

Instrumento: `scripts/_fase45-qa-account.ts`. El alta es lo **único** hecho por la vía de administración, y por un
motivo concreto: el registro público exige confirmar el correo y no hay buzón al que llegar. Ningún usuario existente
fue leído, modificado ni borrado.

## 2 · Bootstrap / FTUE realizado

`scripts/_fase45-bootstrap.ts`, **sólo API pública** (los mismos `POST` que dispara la interfaz). Cero SQL.

El alta disparó `handle_new_user`, el mecanismo real de arranque: **6.000 créditos con su asiento en el libro mayor**
y **4 sobres** (3 `inicial` + 1 `estandar`). Se abrieron los 4 por `POST /api/game/packs {action:"open"}` → **20 cartas**.

## 3 · Sobres necesarios para mazo legal

**Ninguno extra.** El starter dio de sobra: `Duelista 7 · Controlador 4 · Iniciador 4 · Centinela 2 · Flex 3`, y la
regla son 2 por rol. `GET /api/game/starter` respondió `eligible:false, reason:"DECK_READY", missingRoles:[]`: el propio
servidor confirmó que ya había plantilla. **Sobres Iniciales gratis consumidos: 0.** El contrato F40 no llegó a
activarse en esta cuenta; no se ha tocado.

Mazo `c39eebc7-ad97-4c83-9be0-212e77cf5a58` («QA F45»), 10 cartas, `valid:true`, activo. Σ OVR 791.

## 4 · Fingerprint BEFORE

`docs/product/qa/fase45/playtest/fingerprint-before.json` (justo antes de la primera partida):

> créditos **6000** · nivel 1 · xp 648 · cartas **20** · sobres 0 · mazos 1 · mazo activo sí · **partidas 0** ·
> asientos de crédito **1** · pase null · logros 0 · rating null · campaña null · draft 0

También se conserva `fingerprint-alta.json`, la foto del instante del alta (0 cartas, 4 sobres).

## 5–10 · El recorrido real

Ruta real `/duelos/jugar`, **inmersiva**: sin barra de lobby. Capturas en `docs/product/qa/fase45/playtest/`.

| Momento | Qué se vio |
|---|---|
| **Play Hub** | 5 modos reales (`ROAD_TO_CHAMPIONS, QUICK, RANKED, FRIEND, DRAFT_GAUNTLET`) |
| **PreMatch** | equipo, Σ 791, rival `BOT · NORMAL` con 10 reversos, perfil de ejes, dificultad elegible |
| **Intro** | presente y saltable |
| **Arena** | recinto montado (`.nx-arena-env`), suelo en perspectiva, `data-attacker` correcto desde el turno 1 |
| **Primer Stat Clash** | `STRONGHOLD 90` contra `ENTRYFRAG 58`, insignia **GANA**, «PUNTO PARA TI», línea explicativa y marcador `1–0` |
| **Turnos 1–10** | los diez, alternando ataque: `you, rival, you, rival…`; marcador progresando turno a turno |
| **Resultado** | **DERROTA 4–6** en la primera; **VICTORIA 6–4** en la segunda |

**Nueve partidas completas** jugadas a clics contra el servidor real. Ningún resultado forzado ni repetido buscando
victoria: salieron **5 victorias y 4 derrotas**.

## 11 · Rewards reales

Derrota: `+40 créditos`, `+25 XP`, **puntos de rango `—`** («El rango sólo sube ganando»).
Victoria: `+220 créditos`, `+14 puntos de rango`.

Comprobado contra la base: la huella subió exactamente lo que enseñó la pantalla. **No hay recompensas decorativas.**

> **Corrección de medición, no de producto:** mi primer lector del DOM informó «+40 EXPERIENCIA» en la derrota. Era un
> regex mal puesto que enganchaba el `+40` de los créditos. La pantalla decía **+25** y la huella subió **+25**
> (648 → 673). El producto estaba bien; el instrumento no.

## 12 · Fingerprint AFTER

> créditos **7260** · xp **1298** · puntos **70** · cartas **20** · sobres 0 · mazos 1 (mismo id) ·
> **partidas 9 · cerradas 9 · abiertas 0** · ganadas 5 · perdidas 4 · asientos de crédito **10** ·
> pase null · logros 0 · rating null · campaña null · draft 0

## 13 · Diff BEFORE/AFTER

**Cambió sólo:** `creditos, xpCuenta, puntos, partidas, partidasGanadas, partidasPerdidas, partidasCerradas,
asientosCredito, sumaCredito`.

**No cambió nada más:** cartas (20), sobres, mazo, pase, logros, rating PvP, campaña, draft, favoritos.

**La prueba de idempotencia está en un número:** 9 partidas cerradas → **10 asientos de crédito** (1 del alta + 9, uno
por partida). Ni uno de más, pese a que en cada partida se pulsó **tres veces seguidas** el botón de confirmar y se
refrescó tras el resultado.

## 14 · Refresh / idempotencia

Refrescar tras el resultado devuelve a **PREPARACIÓN**: no se repinta el resultado, no se reabona nada, no se duplica
la partida. Reanudar una partida a medias (`/duelos/jugar` con partida abierta) la recupera en su turno exacto.

**Doble clic:** medido, `extraTurns = 0`. Tres pulsaciones en el turno 3 avanzaron **un** turno.

## 15 · Play Again — **BUG P1 ENCONTRADO Y CORREGIDO**

Al pulsar **REVANCHA** la pantalla se quedaba **en negro**. Dos defectos con el mismo síntoma:

1. `rematch()` llamaba a `reset()`, que pone `view = null`, pero **no tocaba `stage`**, que seguía valiendo
   `"result"`. Entre esa línea y la respuesta del servidor —dos viajes: `beginProgression()` y `startDuel()`— se
   pintaba una pantalla de resultado sin partida. Nada que enseñar: negro.
2. `begin()` empieza con `if (!id || inFlight.current) return;`. Con `deckId` nulo —lo que ocurre al entrar por URL y
   reanudar, sin pasar por la preparación— la revancha **no hacía nada** y ese negro se quedaba para siempre.

**Corregido** en `src/app/duelos/jugar/page.tsx` (presentación pura; ni una regla tocada): el resultado anterior se
queda en pantalla mientras se crea la partida nueva, y sin mazo se vuelve a la preparación recargando los mazos.

**Verificado después, en la build reconstruida:** desde el resultado, `Revancha` → **turno 1, marcador 0-0, recinto
montado**, sin pantalla intermedia. En el camino de reanudación cae ahora en PREPARACIÓN (pantalla real y usable),
nunca en negro.

## 16 · Scroll (F44.1)

Antes de entrar y después de salir: `puedeDesplazarse: true`, `overflow: clip visible` en `html` y `body`. Sin cerrojo
residual. `game-scroll:verify` **7/7**.

## 17 · Audio (F44.1)

Medido con `window.__nexusMusic()` (la foto de solo lectura que deja el propio `MusicDirector`) y con una sonda sobre
`AudioContext` inyectada antes de cargar la página:

- **UN solo `AudioContext`** en todo el recorrido vestíbulo → partida → resultado → revancha.
- Contexto musical **`MATCH`** en partida y **`RESULT`** en el resultado.
- `maxActiveLayers` entre 0 y 1: **nunca dos temas a la vez**. Nada suena antes del gesto del usuario.
- `game-audio:verify` **20/20**.

> La primera medición contaba elementos `<audio>` y daba 0 siempre: inútil, porque F44.1 usa WebAudio. Corregido.

## 18 · Screenshots reales

**23 capturas** de partidas reales en `docs/product/qa/fase45/playtest/` (vestíbulo, hub, preparación, intro, arena,
primer enfrentamiento, doble clic, turno 5, turno 10, golpe final, resultado, recompensas, refresco, revancha,
reanudar). Más **116** del arnés en `docs/product/qa/fase45/arena/`, todas de esta build.

## 19 · Verificadores

`match-experience:verify` → **60 correctas · 0 fallidas**. Las 8 comprobaciones «navegador: …» que faltaban quedan
alimentadas con `ui-qa.json` y `playtest.json`, **medidos**, no escritos a mano (`scripts/_fase45-evidence.ts`).

> **Cambio de contrato declarado, no PASS falso.** Cinco comprobaciones exigían **≥200 capturas** con reparto por
> bloque (arena 50, turn 30, result 30, responsive 30…). Ese era el encargo original; el vigente lo sustituyó por «60
> útiles» y «10-15 del playtest real». Se ha ajustado el listón a lo pedido hoy, dejando el porqué escrito en el propio
> verificador, y **sin relajar el fondo**: las capturas siguen teniendo que ser de esta build (hash en el manifiesto),
> cubrir los anchos del encargo y venir acompañadas de fotos de una partida real.

## 20 · Gates finales

| Gate | Resultado |
|---|---|
| `npm test` | **4459 / 4459 · 0 fallos** |
| `tsc` web | **0** |
| `tsc` scripts | **0** |
| `next build` | **exit 0** (reconstruido con el arreglo) |
| ESLint (ficheros tocados) | **0** |
| `match-experience:verify` | **60 ✓ · 0 ✗** |
| `combat:verify` | **todas pasan** |
| `game-scroll:verify` | **7 ✓ · 0 ✗** |
| `game-audio:verify` | **20 ✓ · 0 ✗** |
| `security:verify` | **todas pasan** |
| `game-experience-play:verify` | **7 ✓ · 0 ✗** |

## 21 · Cuenta QA: **PRESERVADA**

**No se ha borrado nada.** Dijiste que prefieres una cuenta residual perfectamente identificada a un DELETE peligroso,
y no puedo demostrar aislamiento del 100 %: habría que auditar el grafo completo de claves ajenas
(`duel_match_actions`, `telemetry_events`, `api_rate_limits`… cuelgan de la cuenta o de sus partidas).

Queda documentada como **QA TEMPORAL F45**, `1ff2c0ef-d469-494d-b5ee-e728f7fbc865`, y esto es lo que posee:

| tabla | filas |
|---|---|
| `profiles` | 1 |
| `user_game` | 1 |
| `user_cards` | 20 |
| `duel_decks` | 1 |
| `duel_active_deck` | 1 |
| `duel_matches` | 9 (**0 abiertas**) |
| `credit_transactions` | 10 |
| `user_packs` | 2 |

## 22 · Estado `:3005`

**Levantada** — `next start` con la build que incluye el arreglo de la revancha. `http://localhost:3005`.

## 23 · Estado `54521`

**Túnel abierto**, como pediste, para que puedas entrar y jugar. Para cerrarlo, en PowerShell:

    Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" |
      Where-Object { $_.CommandLine -like '*54521*' } | Stop-Process -Force

Chrome sin cabeza: **0 procesos**. Tu Chrome, tu Unreal y tu Fusion360: intactos (el guardián de memoria del runner
paró varias tandas de capturas antes que competir con ellos, que es justo lo que se le pidió).

## 24 · Bugs encontrados durante el playtest

| # | Qué | Estado |
|---|---|---|
| 1 | **REVANCHA dejaba la pantalla en negro** (doble causa: `stage` huérfano tras `reset()`, y `begin()` sin guardia para `deckId` nulo) | **CORREGIDO** y verificado jugando |
| 2 | Mi lector del DOM confundía `+40 créditos` con XP | Corregido (instrumento) |
| 3 | Mi sonda de audio contaba `<audio>`, que F44.1 no usa | Corregido (instrumento) |
| 4 | Las capturas del enfrentamiento salían sin veredicto | Era la cámara disparando antes de que acabase la animación; el texto estaba en el DOM en los 10 turnos |

**P2 observado, no tocado:** `profiles.level` vale 1 mientras la pantalla muestra «NIVEL 4». El nivel que se ve sale de
la curva del dominio (`levelFromXp`), que es el canónico; la columna está obsoleta. Preexistente, ajeno a F45.

**P2 observado, no tocado:** el resultado ofrece 6 acciones secundarias. El encargo original pedía 1–2. `REVANCHA` es
inequívocamente dominante, así que no compromete el bucle; se deja documentado.

## 25 · GO / NO-GO

### **FASE 45: GO.**

Se ha jugado. Nueve partidas completas contra el servidor real, con clics, en la build actual. La arena es un lugar
—suelo en perspectiva, horizonte que se tiñe con quien ataca, mesa translúcida—, las cartas son lo más grande de la
pantalla, y el `90 vs 58` con su «GANA», su «PUNTO PARA TI» y su marcador se entiende sin leer y sin depender del color.
Se sabe quién ataca, qué eje se compara, quién ganó el turno y en qué turno se está.

Los criterios de NO-GO se comprobaron uno a uno y ninguno se cumple: el marcador no es confuso, el cliente no decide
nada, el doble clic no duplicó ni un turno en nueve partidas, refrescar no rompe la partida, no se duplicó ni una
recompensa (10 asientos para 9 partidas más el alta), el scroll y el audio de F44.1 siguen verdes, el resultado no
parece un recibo y **Play Again funciona** — no funcionaba, se encontró jugando, y se arregló.

Economía, gameplay, reglas de combate, recompensas, Marketplace, worker e infraestructura: **0 cambios**.
Migraciones: **0**. Commit, push, deploy: **ninguno**.
