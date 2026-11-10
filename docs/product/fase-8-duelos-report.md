# FASE 8 — DUELOS · THE COMPETITIVE ARENA

Informe de cierre. Todo lo que sigue está **medido**, no estimado: capturas en
`docs/product/qa/fase8/` (53 «antes» + 53 «después» + 2 de movimiento) y salidas de las
verificaciones reproducibles con el servidor de producción en `http://127.0.0.1:3005`.

**El motor NO se ha tocado.** Ni un fichero de `src/domain/cardgame`, `src/combat2`,
`src/server/services/duels.ts`, `src/domain/progression/duelRewards.ts` ni de las rutas
`/api/game/duel*` aparece en el diff de esta fase. Se puede comprobar en la sección 28.

---

## 1 · AUDITORÍA

### Instrumento

Dos scripts de auditoría, marcados con `_` porque **no son de CI**: existen para mirar, no
para bloquear una entrega.

| script | qué hace |
|---|---|
| `scripts/_fase8-audit.ts` | Recorre Duelos en los **seis anchos** pedidos, juega partidas reales con clics reales y guarda un PNG de cada estado. Además saca la radiografía vertical (qué ocupa la pantalla), el desglose por bloques y las métricas de coste visual. |
| `scripts/_fase8-a11y.ts` | Teclado, `prefers-reduced-motion` (comparando `reduce` contra `no-preference`) y zonas táctiles a 390. **Nuevo en esta fase.** |

Ejecución:

```
npm run build && npx next start -p 3005
E2E_BASE_URL=http://127.0.0.1:3005 SHOT_DIR=docs/product/qa/fase8 DESGLOSE=1 EXP=1 \
  npx tsx scripts/_fase8-audit.ts antes
E2E_BASE_URL=http://127.0.0.1:3005 npx tsx scripts/_fase8-a11y.ts
```

### Cobertura

Seis anchos — 1440×900, 1366×768, 1280×720, 1024×768, 768×1024, 390×844 — y catorce
estados: entrada sin mazos, lobby sin mazo, mazo incompleto, mis mazos, hub con mazo,
preparación, turno 1, carta elegida, estadística declarada, clash, tras el clash,
defendiendo, resultado y recompensa. Empate de turno reproducido; derrota y victoria
reproducidas en las dos direcciones.

### Radiografía vertical — el estado de partida (turno 1)

| ancho | página / viewport | exceso | overflow-X | mano visible | botón |
|---|---|---|---|---|---|
| 1440×900 | 900 / 900 | 0 | 0 | 10/10 | visible |
| 1366×768 | 768 / 768 | 0 | 0 | 10/10 | visible |
| 1280×720 | 728 / 720 | 8 px | 0 | 10/10 | visible |
| 1024×768 | 768 / 768 | 0 | 0 | 10/10 | visible |
| 768×1024 | 1024 / 1024 | 0 | 0 | 10/10 | visible |
| 390×844 | 846 / 844 | 2 px | 0 | 10/10 | visible |

Reparto a 390×844, bloque a bloque:

```
   0– 71  barra de la arena
  71–596  la mesa (525 px)
 603–708  controles (105 px)
 715–832  la mano (117 px · cartas de 58×87)
          → 12 px de holgura sobre 844
```

---

## 2 · PROBLEMAS ENCONTRADOS

### El fallo que traía la fase NO se reproduce

El encargo decía: `ux:scroll → 37/38`, con el fallo en la mano de Duelos a 390×844,
documentado como PREEXISTENTE, y pedía **auditarlo antes de tocarlo**. Eso es lo primero
que se hizo, y el resultado es que **no se reproduce**:

```
✓ 390×844 (móvil): TODAS las cartas de la mano se ven sin desplazar — 10/10
✓ 390×844 (móvil): el botón de jugar está a la vista
✓ 390×844 (móvil): sin desbordamiento horizontal
✓ 390×844 (móvil): la mano del rival sigue oculta — 50 reversos, 0 con texto

✅ LA RUEDA DESPLAZA Y LA MANO SE VE — 38/38
```

Medido ANTES de tocar ni una línea, sobre una build limpia del árbol actual. El trabajo que
ya vivía en el árbol de trabajo —la mesa medida desde `--pos` en vez de desde la página, la
fila de posiciones que crece con la partida en móvil y los controles en una sola fila— es lo
que lo cerró. **No se ha «arreglado» nada: se ha comprobado que ya estaba resuelto.** El
`37/38` del encargo corresponde a un estado anterior del árbol.

Queda una holgura de 12 px a 390 y de 8 px de exceso de página a 1280×720 —relleno del
contenedor por debajo de la mano, no contenido fuera de vista: la mano acaba en 717 y el
viewport mide 720—. No rompen nada, pero son el margen real, y conviene saberlo antes de
añadir alto a esa pantalla.

### Lo que sí estaba mal

| # | problema | dónde | estado |
|---|---|---|---|
| P1 | `/duelos/mazos` seguía en el lenguaje visual anterior: 9 `rounded-*` (tarjetas `rounded-2xl`, píldoras `rounded-full`), 4 botones escritos a mano, 0 primitivas del sistema. Es **el paso justo anterior a la arena**: el modo cambiaba de idioma en la última puerta. | `src/app/duelos/mazos/page.tsx` | **resuelto** |
| P2 | La pantalla de resultado cerraba la partida con tres `rounded-xl` a mano y tres encabezados `text-[10px]` ad-hoc, justo después de una pantalla hecha de chaflanes. | `ResultScreen.tsx` | **resuelto** |
| P3 | **Sin salida a `/duelos` desde el resultado.** La ruta es inmersiva (sin barra de navegación) y la barra de la arena solo existe mientras se juega: desde el resultado no había ni un camino de vuelta al modo. | `ResultScreen.tsx` | **resuelto** |
| P4 | El cromo de la partida —marcador y salida— era la última pieza con geometría `rounded-control` y un botón a mano. | `ArenaBar` | **resuelto** |
| P5 | **`Salir` medía 51×34 a 390**: el único control de la arena por debajo del objetivo táctil de 44 px. Y es la única salida de una pantalla a pantalla completa. | `ArenaBar` | **resuelto** |
| P6 | Con `prefers-reduced-motion` activo, el abanico de la mano **seguía animándose**: `MotionConfig reducedMotion="user"` cubre framer-motion, pero la separación y el levantamiento de las cartas son transiciones CSS y no pasan por ahí. | `HandFan.tsx` | **resuelto** |
| P7 | Las dos puertas del hub pesaban lo mismo: en una captura no se distinguía cuál lleva a jugar. | `src/app/duelos/page.tsx` | **resuelto** |
| P8 | `export function Scoreboard` en `src/components/duel/Scoreboard.tsx` es **código muerto** (solo se usan `TurnTrack` y `turnLabel`), y comparte nombre con el `Scoreboard` de retransmisión. | — | **documentado, no tocado** (§29) |
| P9 | **No existe control de silencio en todo el producto**: `setMuted` / `isMuted` de `src/lib/sound.ts` no los llama nadie. | — | **documentado, no tocado** (§20/§29) |

---

## 3 · CONCEPTO ARENA

El concepto ya estaba construido y esta fase lo **audita y lo completa**, no lo sustituye.
No se ha creado ninguna segunda arquitectura: siguen siendo las mismas ocho piezas —
`ArenaSurface`, `PlayedRow`, `HandFan`, `ClashBanner`, `DuelCard`, `DuelMoment`,
`MatchBoard`, `ResultScreen`— y no se ha añadido ni un `DuelButton2`.

La idea que las ordena: **la mesa se mide desde el juego, no desde la página.** Hay una sola
variable libre, `--pos` (el ancho de una posición de carta), y de ella salen el ancho de la
mesa, el tamaño de la carta del centro y el alto de cada banda. Como el ancho de la mesa sale
de las diez posiciones, las diez posiciones llenan la mesa por construcción: el hueco muerto
no se reduce, deja de poder existir.

---

## 4 · MESA

Cuatro planos de luminancia reales — página → canto → tapete → placa hundida — con retícula
en perspectiva, emblema grabado y tornillos en el canto. Tres zonas: banda del rival arriba,
zona de enfrentamiento en medio, banda del jugador abajo, separadas por raíles con su
etiqueta incrustada. Los controles y la bandeja de la mano heredan `--arena-w`, así que las
tres piezas comparten borde izquierdo y derecho y se leen como un mismo objeto.

Sin cambios en esta fase: se auditó y se dejó como estaba.

## 5 · IDENTIDAD DEL JUGADOR · 6 · IDENTIDAD DEL RIVAL

En `lg` y por encima, cada bando tiene su marcador de flanco junto a su carta: el rival con
la **dificultad real** (`DIFFICULTY_INFO[view.difficulty].label`) y la **fuerza de su mazo**
(`view.rivalSumOvr`), tú con el **nombre de tu mazo** y `view.yourSumOvr`. Por debajo de `lg`
los flancos no caben y esos mismos datos viajan a la línea de la banda del rival y a la
bandeja de la mano.

Las dos cifras llegan calculadas del servidor. **No revelan ni una carta**: dicen lo fuerte
que es el mazo rival, que es lo que hace falta para saber a qué te enfrentas. No se ha
inventado ningún nombre ni ningún emblema, y no se ha creado ningún sistema de perfil
paralelo.

## 7 · MANO

Abanico corto (±5° con diez cartas), solapado, con la carta bajo el cursor separándose de sus
vecinas y la elegida quedándose arriba con su anillo verde —el color del jugador—. Lo que se
toca sigue siendo un `<button>` por carta con su `aria-label` acabado en «OVR n».

**A 390 no caben diez cartas completas y eso es aritmética, no diseño**: diez cartas de 58 px
son 580 px en un carril de 374. El reparto elegido —todas visibles, solapadas 22 px— es el
único que cumple «ver la mano entera sin desplazar». El coste está medido y documentado en
§29: de cada carta se ve el 62 % izquierdo, así que el tercer eje (EF) queda tapado hasta que
se elige la carta. Elegirla la separa y la levanta, que es el gesto de «coger la carta para
mirarla».

## 8 · CARTA SELECCIONADA

Elevación (−14 px), escala 1,05, anillo `ring-ok` **independiente de hover y de foco** —una
carta elegida sigue diciéndolo cuando el puntero se va— y la carta aparece a la vez en su
hueco de la mesa con su animación de colocación. Sin halo exagerado.

## 9 · ESTADÍSTICA COMPARADA

Las tres reales y solo esas: Stronghold, Gamesense, Entryfrag. **Cada bando tiene su eje** y
el rótulo central lo dice por separado; solo cuando los dos coinciden se enseña un título
único, porque solo entonces es una comparación directa. Defendiendo, el eje lo impone
`requiredStat` (lo calcula el dominio) y se resalta **en todas las cartas de la mano**, para
que la comparación sea de un vistazo.

## 10 · CARTA JUGADA

Sale de la mano, entra en la mesa y **se queda**: `PlayedRow` mantiene todas las cartas
jugadas de los dos bandos, boca arriba, con el filo de resultado teñido y su marca G/P/E. La
última jugada se distingue con un filo y una sombra que desaparecen cuando llega la
siguiente. El tablero del turno 7 no se parece al del turno 1.

## 11 · TURNO

Cuatro señales a la vez, no solo texto: el **número cambia con reemplazo** (el viejo sube y
se va, el nuevo entra desde abajo), la **pista de turnos** marca el actual en cian, el rótulo
del canto dice «Atacas tú» / «Ataca el rival» **con el color del bando** y la posición que
toca se enciende en la fila.

## 12 · CLASH

`DuelMoment`, en vertical y con **el mismo mapa que la mesa** —rival arriba, tú abajo— para
que las cartas caigan desde donde estaban. Cuatro tiempos: cartas (0 ms) → cifras (260) →
comparación, el perdedor se apaga y el ganador se afirma (520) → veredicto y marcador (760).
El halo tiñe la sala con el color de quien ha ganado.

**Ritmo medido** (`duel:playtest`, 6 partidas / 60 turnos): turno medio **866 ms**, el más
lento 1.055 ms, partida completa **15,8 s**. Ni se atropella ni se hace pesado.

## 13 · GANADOR

Inequívoco y **con el color de su bando**: verde el jugador, rojo el rival, oro el empate. El
perdedor pierde presencia (opacidad 0,55, cifra al 50 %), el ganador la gana (escala 1,05,
sombra de color y sello «Gana» pegado a su cifra). El rojo **no** es el color de ganar: es el
del rival.

## 14 · EMPATE

Distinto de las dos cosas. Oro, sin corona radial, sin fanfarria ni lamento (cue neutro), y
con su propia frase: «Valores idénticos: nadie recibe punto, y las dos cartas se gastan
igual». En el resultado final, `Empate` con su tono propio.

Reproducido a nivel de turno en el playtest. **Un empate de PARTIDA completa
(`decidedBy: "NONE"`) no se ha llegado a reproducir**; sí el desempate por suma de medias
(`OVR_TIEBREAK`), que recorre el mismo camino de presentación.

## 15 · RESULTADO · 16 · RECOMPENSA

Orden: **impacto → resultado → recompensa → progreso → siguiente acción**. Titular que entra
un 35 % más grande y se cierra sobre su tamaño, marcador enorme, el motivo tal y como lo
redacta el Combat Resolver, y la banda de recompensa medio segundo después.

Las cifras son las reales de `result.award`, calculadas en el servidor: en la partida
capturada, victoria a Difícil → **+22 puntos de rango · +350 créditos · +180 XP**; derrota →
**rango «—» · +60 créditos · +40 XP**, con la línea «El rango solo sube ganando» en vez de
esconder la fila. Aquí no se suma nada.

**Cambiado en esta fase:** los tres botones pasan a `NxButton` (una sola acción rellena:
«Volver a jugar»), los encabezados a `SectionTitle`, la nota de desempate a `Recessed`, y se
añade **«Salir a Duelos»** —ruta existente— porque no había ninguna.

## 17 · ENTRADA AL MAZO

`/duelos/mazos` pasa al lenguaje del sistema. **Ni una regla cambia**: los diez huecos, los
dos por rol y la validez siguen llegando calculados del servidor (`d.valid`, `d.status`,
`d.roleCounts`, `d.errors`).

- Un mazo **listo** es un `Stage` con tinte `success`; uno a medias, un `Plate`. La jerarquía
  la pone la superficie, no un color de texto.
- La tira de diez reparte el ancho (`flex-1`) en vez de envolver a una segunda línea, y los
  huecos que faltan son `Recessed`, no rectángulos punteados.
- `Jugar` es la acción principal cuando el mazo puede jugar; cuando no, lo es `Editar`.
- `Eliminar` usa el papel `danger` de la familia.

El **constructor** (`DeckBuilder`) se auditó y **no se ha rediseñado**: ya explica bien qué
falta («FALTAN 4 CARTAS · Te falta Iniciador, Centinela, Centinela, Flex») con contadores por
rol. Queda anotado en §29.

## 18 · MÓVIL (390×844)

Diseñado explícitamente, no escalado. Prioridades cumplidas: rival → carta rival →
estadística → tu carta → mano → marcador.

- La fila de posiciones **crece con la partida**: reserva lo jugado más la siguiente (mínimo
  cuatro), no las diez. Reservar las diez costaba 366 px de los 645 de la mesa enseñando
  veinte casillas vacías, y empujaba la mano entera bajo el pliegue.
- La carta del enfrentamiento mide **×1,9 `--pos`** (95 px) frente a los 58 de la mano: la
  jerarquía se ve sin leer nada.
- Los controles van en una fila; la comparación de ejes baja bajo la zona de duelo.
- **0 desbordamiento horizontal** en los seis anchos, antes y después.

## 19 · MOVIMIENTO

`ENTER ARENA` (aparición del tablero) · `DRAW` (abanico) · `SELECT` (elevación + anillo) ·
`PLACE` (la carta sale de la mano, se posa y el hueco devuelve el golpe, 440 ms) · `CLASH`
(cuatro tiempos) · `VERDICT` · `TURN CHANGE` (reemplazo del número) · `VICTORY` (corona
radial, una vez) · `DEFEAT` (sin corona: celebrarla sería mentir).

**Cero bucles infinitos**, comprobado en el navegador:

```
✓ ninguna animación en bucle infinito en la arena
```

Todo es `transform` / `opacity` / `filter`. Ninguna animación supera 1,1 s.

## 20 · AUDIO

Se usan los cues **que ya existen** en `src/lib/sound.ts`, sin crear ningún sistema paralelo:
`ui` al elegir carta y al elegir eje, `whoosh` al colocar, `round_win`/`round_lose` en el
veredicto (disparados **cuando suena el veredicto**, no al montar, para no destriparlo),
`victory`/`defeat`/`ui` en el resultado. `primeAudio()` se llama en el primer gesto, por la
política de autoplay.

**Cero errores de consola** en toda la fase: `duel:e2e`, `duel:playtest` y las 106 capturas.

**No existe control de silencio en el producto** (`setMuted`/`isMuted` no los llama nadie).
Siguiendo la regla 24, **no se ha construido**: queda documentado en §29.

## 21 · ACCESIBILIDAD

`scripts/_fase8-a11y.ts` → **14/14**.

```
## 1 · TECLADO
  ✓ las diez cartas de la mano son tabulables — 10
  ✓ confirmar no es tabulable mientras está deshabilitado
  ✓ la salida está en el recorrido
  ✓ ningún control del recorrido está sin nombre accesible — 0
  ✓ la carta enfocada se selecciona y lo dice (`aria-pressed`)
  ✓ los tres ejes aparecen como controles
  ✓ con la jugada completa, confirmar entra en el recorrido — «Responder»

## 2 · MOVIMIENTO REDUCIDO
  ✓ la mano entera sigue estando sin movimiento — 10 vs 10
  ✓ las posiciones de la mesa siguen estando sin movimiento — 21+1 vs 21+1
  ✓ no se pierde texto: se reduce MOVIMIENTO, no INFORMACIÓN — 896 vs 896 caracteres
  ✓ ninguna animación en bucle infinito en la arena

## 3 · ZONAS TÁCTILES A 390
   11 interactivos · 0 por debajo de 44 px de alto
```

**Dato importante para leer las capturas:** Chrome sin cabeza declara
`prefers-reduced-motion: reduce` por defecto, así que **las 106 capturas de esta fase son ya
la versión sin movimiento**. Que el clash, el veredicto y el resultado se lean completos en
ellas es la prueba de que la preferencia reduce movimiento y no información. Para comparar,
`motion-con-movimiento-1440.png` y `motion-reducido-1440.png` fuerzan cada modo: 896
caracteres y 932 nodos en los dos.

El foco es visible en todo el recorrido: hay una regla global
`:where(a, button, [role="button"], …):focus-visible` en `globals.css`, y las primitivas
añaden su propio anillo.

## 22 · RENDIMIENTO

Medido en el navegador, arena a 1440 y a 390 (idle · clash · resultado):

| | DOM | animaciones CSS | sombras | filtros | capas | mix-blend | z arbitrarios | errores |
|---|---|---|---|---|---|---|---|---|
| arena idle | 875–933 | **0** | 41–51 | 20–21 | 33–36 | **0** | **0** | **0** |
| clash | 1031–1087 | **0** | 48–58 | 21–22 | 39–42 | **0** | **0** | **0** |
| resultado | 940 | **0** | 4–5 | 0 | 20 | **0** | **0** | **0** |

Peticiones: **1,38 por turno** (83 para 60 turnos + 6 partidas). Sin sondeo ni
temporizadores: cada petición nace de una acción del jugador. `duel:e2e` confirma «sin
ráfagas de peticiones a la API de duelos — 30 peticiones».

## 23 · QA FUNCIONAL

`duel:playtest` — seis partidas completas con clics reales, dos mazos y tres dificultades:

```
  Fácil    buena       → VICTORIA  9–0    Fácil    descuidada → DERROTA  2–8
  Normal   buena       → VICTORIA  6–3    Normal   descuidada → DERROTA  2–8
  Difícil  buena       → VICTORIA  6–5    Difícil  descuidada → DERROTA  0–10

  turnos analizados: 60
  ✓ todos los turnos muestran una instrucción explícita (0 sin ella)
  ✓ defendiendo siempre se dice con qué estadística responder (0 sin ella)
  ✓ errores de consola: 0
```

`duel:e2e` recorre entrada → constructor → preparación → los diez turnos → resultado →
recompensa → repetición → vuelta a Duelos, todo con clics reales: **TODAS LAS COMPROBACIONES
PASAN**.

## 24 · ANTES / DESPUÉS

`docs/product/qa/fase8/` — 53 `antes-*` y 53 `despues-*`, mismos nombres, mismos anchos,
mismos momentos. Los más elocuentes:

| par | qué enseña |
|---|---|
| `*-04-mis-mazos-1440.png` | El cambio de idioma: píldoras y tarjetas → chaflanes, `Badge`, `NxButton`, tira de diez en una fila |
| `*-05-hub-con-mazo-1440.png` | Las dos puertas dejan de pesar lo mismo |
| `*-13-resultado-1440.png` | Botones de la casa y la salida que no existía |
| `*-07-turno1-390.png` | La mesa entera, los controles y las diez cartas en 844 px |

## 25 · MÉTRICAS

Geometría, contando **solo `className`** (los `rounded-*` que quedan en los ficheros están
dentro de comentarios que explican el cambio):

| fichero | antes | después |
|---|---|---|
| `duelos/mazos/page.tsx` | **9** `rounded-*` · 4 botones a mano · 0 primitivas | **1** (`rounded-control`, el enlace de vuelta compartido del producto) · **0** botones a mano · 6 `NxButton` + `Stage`/`Plate`/`Recessed`/`Badge`/`Readout`/`SectionTitle` |
| `ResultScreen.tsx` | 4 `rounded-xl` · 3 botones a mano · 3 encabezados ad-hoc | **0** · **0** · 4 `NxButton`, 3 `SectionTitle`, 1 `Recessed` |
| `ArenaBar` (`jugar/page.tsx`) | 2 `rounded-control` · 1 botón a mano | **0** · 1 `NxButton` + 1 `Recessed` |
| `duelos/page.tsx` | 0 | **0** |

Coste visual y salud (§22): animaciones CSS **0**, `mix-blend` **0**, `z-[n]` arbitrarios
**0**, errores de consola **0** en las tres pantallas y en los dos anchos.

Otros movimientos medidos:

- Exceso de página a 390, turno 1: **2 px → 0 px**. (A 1280×720 quedan 8 px, que son el
  relleno inferior del contenedor por debajo de la mano, no contenido fuera de vista: la mano
  termina en 717 y el viewport en 720.)
- Controles por debajo de 44 px a 390: **1 → 0**.
- `rounded-full` en el resultado: **0** antes y después.

## 26 · TESTS

Todo ejecutado sobre la build de producción con el servidor en `:3005`.

| comprobación | resultado |
|---|---|
| `npm test` | ✅ **696 / 696** |
| `npm run typecheck` | ✅ limpio (app + scripts) |
| `npm run build` | ✅ compila |
| `npm run lint` | ⚠️ **1 error + 8 avisos — PREEXISTENTE** (§28) |
| `npm run security:verify` | ✅ todas |
| `npm run collection:verify` | ✅ todas |
| `npm run pack:verify` | ✅ todas |
| `npm run card-generator:verify` | ✅ **50 / 50** |
| `npm run materializer:verify` | ✅ **42 / 42** |
| `npm run catalog-builder:verify` | ✅ **44 / 44** |
| `npm run duel-gameplay:verify` | ✅ todas |
| `npm run duel:e2e` | ✅ todas |
| `npm run duel:playtest` | ✅ 6 partidas · 60 turnos · 0 errores |
| `npm run ux:scroll` | ✅ **38 / 38** |
| `npm run audit:stability` | ✅ **105 comprobaciones · P0 0 · P1 0 · P2 0** |
| `npm run launcher:verify` | ✅ **33 / 33** (con `BASE_URL`, ver §28) |
| `scripts/_fase8-a11y.ts` | ✅ **14 / 14** |
| `npm run ux:verify` | ⚠️ **4 fallos — PREEXISTENTES, fuera de Duelos** (§28) |

## 27 · ESTABILIDAD

```
Comprobaciones: 105 · P0: 0 · P1: 0 · P2: 0
✅ SIN FALLOS BLOQUEANTES NI IMPORTANTES
```

25 saltos de navegación, ida y vuelta seis pasos, segunda vuelta con el router caliente: **0
pantallas vacías**.

## 28 · CLASIFICACIÓN DE FALLOS

Ninguno **INTRODUCIDO**.

### PREEXISTENTE

1. **`npm run lint` — 1 error.** `src/app/admin/torneos/page.tsx:190` · «React Hook "useMemo"
   is called conditionally». El fichero **no está modificado en el árbol de trabajo**
   (`git diff` vacío): viene de la build congelada. Fuera de Duelos. La regla 23 de la fase
   dice explícitamente que no se arregle el lint global salvo que la fase lo exija; no lo
   exige.
2. **`npm run ux:verify` — 4 fallos.** Zonas táctiles por debajo de 32 px en **inicio** y
   **tienda**, a 768 y a 390:
   - `Ver todo` 41×12 (`src/components/lobby/LobbyCircuit.tsx`, ×2)
   - `Centro de eventos →` 97×12 (`src/app/tienda/page.tsx`)

   Ninguno de los dos ficheros se ha tocado en esta fase. Son enlaces de texto de 12 px de
   alto que arrastra el trabajo de fases anteriores. **No se han arreglado** porque la
   regla 53 prohíbe rediseñar Home y Store en esta fase; quedan como deuda anotada.

### ENTORNO

3. **`npm run launcher:verify` falló en el primer intento.** El script usa `BASE_URL`
   (por defecto `http://localhost:3000`), no `E2E_BASE_URL`. Apuntado al servidor real:
   **33/33**. No es un fallo del producto.
4. Supabase local y Docker estaban parados al empezar la sesión; hubo que arrancarlos para
   poder medir. Sin efecto sobre el código.

## 29 · DEUDAS

| # | deuda | por qué no se toca ahora |
|---|---|---|
| D1 | **No hay control de silencio.** `setMuted`/`isMuted` existen en `src/lib/sound.ts` y no los llama nadie: el audio de Duelos no se puede apagar desde el producto. | La regla 24 dice que si no existe, **no** se construya un sistema de ajustes de audio en esta fase. Es trabajo de una fase de Ajustes/Cuenta. |
| D2 | **A 390, el tercer eje de cada carta de la mano queda tapado.** Solapado de 22 px sobre 58: se ve el 62 % izquierdo. Elegir la carta la separa y la descubre. | Diez cartas completas son 580 px en un carril de 374: **no cabe**. Cualquier alternativa rompe «ver la mano entera sin desplazar» (`ux:scroll`) o convierte las cartas en cuadrados de color. Es un compromiso consciente, no un descuido. |
| D3 | **Holgura vertical mínima**: 12 px a 390×844 y 8 px de exceso de página a 1280×720. | No rompe nada hoy. Es el margen real: cualquier alto que se añada a esa pantalla hay que medirlo. |
| D4 | **`export function Scoreboard`** en `src/components/duel/Scoreboard.tsx` es código muerto (solo se usan `TurnTrack` y `turnLabel`) y colisiona de nombre con el de retransmisión. | Borrarlo no arregla nada visible y la fase es de presentación. Anotado para una limpieza. |
| D5 | **El constructor (`DeckBuilder`) conserva píldoras `rounded-full`** en sus filtros y orden. | La regla 32 prohíbe convertir esta fase en un rediseño del Deck Builder. Se auditó: explica bien qué falta y por qué. |
| D6 | **`ux:verify`: enlaces de 12 px en inicio y tienda** (§28.2). | Regla 53: no se rediseñan esas pantallas aquí. |
| D7 | **Empate de partida completa (`decidedBy: "NONE"`) no reproducido.** Sí el desempate por suma de medias. | Depende del azar del bot; no se ha forzado porque forzarlo tocaría el motor. La presentación del empate sí está verificada a nivel de turno y en el código del resultado. |

## 30 · QUÉ NO SE HA TOCADO

**Nada del motor ni del dominio.** El diff de esta fase son cinco ficheros:

```
src/app/duelos/page.tsx              (las dos puertas del hub)
src/app/duelos/mazos/page.tsx        (la lista de mazos)
src/app/duelos/jugar/page.tsx        (el cromo de la arena)
src/components/duel/ResultScreen.tsx (botones, encabezados, salida)
src/components/duel/arena/HandFan.tsx (motion-reduce)
scripts/_fase8-a11y.ts               (nuevo, auditoría)
```

Intactos, sin una línea modificada:

- **Motor y reglas** — `src/domain/cardgame/*`, `src/combat2/*`, `src/lib/duel/duel.test.ts`
- **Resolución, stats, OVR, tabla de enfrentamientos, desempates, turnos, tamaño de mazo**
- **Bot** — `src/domain/cardgame/opponent`, EASY/NORMAL/HARD
- **Recompensas y economía** — `src/domain/progression/duelRewards.ts`
- **Servidor y contratos** — `src/server/services/duels.ts`, `src/app/api/game/duel*`,
  `src/lib/duel/types.ts`, `src/lib/duel/client.ts`
- **Base de datos** — `supabase/*`
- **Sistema de cartas** — `CardRenderer`, `CardEffects`, `VariantIdentity`, `DuelCard`
- **La mesa** — `ArenaSurface`, `PlayedRow`, `ClashBanner`, `MatchBoard`, `DuelMoment`
- **Otras secciones** — Home, Colección, Tienda, Mercado, Entrenador, Perfil, Torneos,
  Pick'ems, Eventos

Ni un texto de los que leen las verificaciones ha cambiado: «Comenzar duelo», «Elige una
carta», «Elige una estadística», «Declarar y atacar», «Responder», «Guardar mazo», «Crear mi
primer mazo», «+ Nuevo mazo», «Listo para duelo», «Volver a jugar», «Ver la partida», «Mis
mazos», «Fácil», «Normal», «Difícil».

---

## LA PRUEBA DE 3 SEGUNDOS

Mirando `despues-12-defendiendo-1440.png`:

- **¿Contra quién juego?** «BOT · DIFÍCIL · Σ 894», en el flanco rojo, junto a su carta —
  vo0kashu, ya sobre la mesa, con su SH 99 resaltado.
- **¿Qué tengo?** Ocho cartas en abanico en su bandeja: «TU MANO · 8 CARTAS · MAZO 1 · Σ 901».
- **¿Qué estoy comparando?** La placa central: «ENTRYFRAG — vs STRONGHOLD 99», y debajo, en
  los controles, «Obligado a responder con Entryfrag».
- **¿Quién ganó?** Las dos filas de posiciones llevan sus marcas: P roja en mi carta del
  turno 1, G verde en la del turno 2, y las contrarias en el lado del rival. Marcador **1–1**
  en el canto de la mesa y en la barra; el historial lo desglosa turno a turno
  («T1 vo0kashu 70 ‹ 99 azury · 0–1», «T2 xenom 98 › 45 trexx · 1–1»).

Mirando `despues-13-resultado-1440.png`:

- **¿Gané?** VICTORIA, 6–5, en verde, a 86 px.
- **¿Qué recibí?** +22 puntos de rango · +350 créditos · +180 XP.
- **¿Qué hago ahora?** VOLVER A JUGAR (la única acción rellena), y tres salidas más.

---

## CRITERIO DE ÉXITO

| # | criterio | |
|---|---|---|
| 1 | Parece un modo competitivo de videojuego | ✅ |
| 2 | La mesa es protagonista | ✅ |
| 3 | El rival es evidente | ✅ |
| 4 | Mi identidad es evidente | ✅ |
| 5 | Mi mano se entiende | ✅ (con D2 a 390) |
| 6 | La carta seleccionada se entiende | ✅ |
| 7 | La estadística comparada es evidente | ✅ |
| 8 | La carta jugada permanece visible | ✅ |
| 9 | El clash se siente importante | ✅ |
| 10 | El ganador es inequívoco | ✅ |
| 11 | El turno es inequívoco | ✅ |
| 12 | El resultado es claro | ✅ |
| 13 | La recompensa se entiende | ✅ |
| 14 | Puedo volver a jugar rápidamente | ✅ |
| 15 | Mobile funciona | ✅ 10/10 cartas, 0 scroll |
| 16 | No hay overflow-X | ✅ en los seis anchos |
| 17 | No se rompe accessibility | ✅ 14/14 |
| 18 | Reduced-motion funciona | ✅ mismo texto, mismos nodos |
| 19 | Performance es razonable | ✅ 0 animaciones CSS, 866 ms/turno |
| 20 | **El motor NO ha cambiado** | ✅ §30 |
