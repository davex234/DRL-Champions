# Fase 47.1 — Tactical Coach: pasada visual y de UX

**Estado: GO.**
Sin lógica de juego nueva, sin sistemas nuevos, sin migraciones (cabeza sigue en **0054**), sin commit,
sin push, sin deploy.

La fase se hizo en dos pasadas del mismo día (la primera quedó cortada antes de informar; la segunda
la cierra). Las capturas `antes/` son de la build previa a la pasada, a las 19:15; las `despues/` son
de la build final. Todo lo que dice este informe está medido contra esa build final.

---

## 1 · Qué se veía mal ANTES

Las cinco pantallas compartían el mismo defecto: **eran formularios con un mapa dentro**, no una
herramienta táctica.

**Pizarra (`/entrenador/strats`).** El mapa empezaba a 275 px del borde superior —cabecera «PIZARRA»
más panel de nombre/bando/guardar, dos bloques apilados— y terminaba por debajo del pliegue: a
1440 × 900 había que desplazar la página para ver el mapa entero. El rail derecho era una retícula de
veintitantos rectángulos idénticos: nueve utilidades como nueve glifos blancos iguales y seis formas
como seis rótulos de texto. No había forma de saber qué herramienta estaba armada sin buscar un filo
dorado entre veinte botones. Las fichas de jugador no se veían en la captura porque no había ninguna
colocada, pero tampoco había secuencia de pasos visible ni indicación de en qué paso se estaba.

**Composiciones (`/entrenador/composiciones`).** Doce píldoras grises de texto para elegir mapa —una
lista, no una selección táctica—, cinco rectángulos vacíos enormes con «+ AGENTE», y el roster como
diez filas planas. Exactamente el «formulario empresarial» que había que quitar.

**Presentar / Tactical Theater.** El fallo grave: **PRESENTAR enseñaba el PNG del mapa y nada más.**
Ni las cinco fichas, ni las utilidades, ni las flechas, ni las zonas, ni las notas, ni la composición,
ni el nombre del paso. La pantalla que existe para explicar la jugada era la única que no la enseñaba.
Causa: un `MapCanvas` envolviendo a `StrategyBoard`, que ya monta su propio `MapCanvas` — un `<div>`
dentro de un `<svg>`, que el navegador acepta pero no dispone: el lienzo interior medía 0 × 0.

**Plan Táctico (`/entrenador/plan`).** Una línea gris de 12 px con equipo, rival, marcador y fecha,
todo del mismo tamaño y color. Tres botones idénticos por jugada. Y el bando sin jugadas simplemente
no se dibujaba.

---

## 2 · Qué se cambió

Solo presentación. **Cero cambios en servidor o dominio.**

- **Pizarra:** cabecera y barra de trabajo fundidas en una tira de mando; la caja del tablero toma la
  proporción del encuadre del mapa (se acabaron las franjas negras laterales); secuencia de pasos como
  tira vertical pegada a la mesa; rail agrupado por intención con color propio por utilidad e icono
  por forma; estado activo a plena opacidad; tira «qué herramienta está armada» junto al mapa, con
  salida «Soltar»; objetivo táctil de 44 px en los 67 controles de la pantalla; mapa y «mis
  estrategias» plegados en el rail; el panel de selección sube al principio cuando hay algo
  seleccionado; `PRESENTAR` sube a la barra de mando.
- **Composiciones:** selector de mapa con la planta real de los doce y contador de composiciones; los
  cinco puestos como fichas con glifo grande, nombre, clase y color; recuento por clase; roster
  escaneable con marca de elegido y atenuado para el resto; se abre en el mapa donde más trabajo hay.
- **Teatro:** arreglado el lienzo anidado (ahora se ve la jugada entera); cámara con `fitCamera` al
  abrir; composición a la izquierda, contador de paso grande a la derecha, línea de tiempo con relleno
  de progreso abajo; mando de cámara atenuado al 25 % para quitar ruido de edición.
- **Plan Táctico:** cabecera tipo briefing con planta del mapa, rival y marcador como cifra; dos
  bloques tácticos con canto de color; jerarquía de acciones (Abrir enlace discreto · Asignar
  contorno · **PRESENTAR** sólido).

### Lo que se arregló en esta segunda pasada

1. **`/entrenador/plan`: el bando sin jugadas ya no desaparece.** Había un `if (grupo.length === 0)
   return null` que borraba el bloque entero. Medido en vivo antes del arreglo: `ataque=true,
   defensa=false`. Ahora los dos bandos se dibujan siempre, y el vacío es honesto —«Ninguna jugada de
   defensa guardada en Ascent» más el camino para dibujarla—, sin inventar ni una jugada.
2. **Selector de mapa sin huérfano.** Doce tarjetas de 92 px no caben en los 1.168 px útiles del
   contenedor: entraban once y la doceava caía sola en una segunda fila. Ahora es una rejilla de
   4 · 6 · 12 columnas, con la miniatura en caja cuadrada para que los doce nombres queden a la misma
   altura. Efecto lateral medido: a 1440 el editor de composición entero cabe sin desplazar.
3. **El tope de altura de la mesa queda documentado, no subido.** Se probó subirlo de 1.000 a 1.240 px
   para aprovechar pantallas de 1440 px de alto. Medido a 2560 × 1440: el lienzo pasó a 950 × 1.224
   pero el mapa siguió en 998 × 1.042 —el ancho manda, porque el contenedor de la aplicación corta en
   1.480 px— y aparecieron ~180 px de franja negra arriba y abajo. **Revertido**, y escrito en el
   código por qué ese número está medido y no elegido.

---

## 3 · Archivos modificados

| Fichero | Qué |
|---|---|
| `src/app/entrenador/strats/page.tsx` | reparto, tira de mando, secuencia, rail agrupado, estado armado |
| `src/app/entrenador/composiciones/page.tsx` | selector de mapa en rejilla, cabecera |
| `src/app/entrenador/plan/page.tsx` | briefing, dos bandos siempre, jerarquía de acciones |
| `src/app/entrenador/partidos/page.tsx` | entrada al plan |
| `src/app/entrenador/page.tsx` | ajustes del hub para que Composiciones encaje |
| `src/components/tactics/StrategyBoard.tsx` | fichas con glifo y nombre, capas legibles |
| `src/components/tactics/TacticalTheater.tsx` | lienzo anidado, paneles, línea de tiempo |
| `src/components/tactics/MapCanvas.tsx` | mando de cámara 44 px y modo atenuado |
| `src/components/tactics/CompositionBuilder.tsx` | cinco puestos y roster |
| `src/components/tactics/MapPicker.tsx` | miniatura en caja cuadrada |
| `src/components/tactics/ToolGlyph.tsx` | iconos de las formas de dibujo |
| `scripts/_fase47-1-*.ts` | instrumentos de QA (`_`, fuera de CI); `_fase47-1-medir.ts` es nuevo |

Ni un fichero de `server/`, `domain/`, `supabase/` ni `config/`.

---

## 4 · Composition Manager — antes / después

`antes/06-composicion-editor-1440.png` → `despues/08-composicion-llena-1440.png`

Antes: doce píldoras de texto gris, cinco rectángulos vacíos de 300 px de alto, roster plano.
Después: doce plantas de mapa en una fila pareja con el activo en oro y su contador; cinco fichas con
el glifo original grande, nombre, clase y canto del color de la clase; recuento por clase
(`DUELISTA 1 · INICIADOR 1 · …`); roster con marca de elegido y atenuado para el resto — cinco clics y
la composición está montada. Todo el editor entra en una pantalla a 1440.

---

## 5 · Pizarra — antes / después

`antes/10-pizarra-strat-1440.png` → `despues/10-pizarra-strat-1440.png`

Antes: mapa cortado por el pliegue, rail de veintitantos rectángulos iguales, sin secuencia visible.
Después: tira de mando de una sola línea, secuencia vertical pegada a la mesa con el paso activo en
oro, mapa con proporción del encuadre, rail agrupado (Manejar · Jugadores · Utilidades · Dibujo ·
Color · Texto), tira de estado armado sobre la mesa y mando de zoom en la esquina.

Medido en vivo en la build final (alto del dibujo del mapa sobre el alto del viewport):

| Ancho | Mapa | % del alto de pantalla | Desborde |
|---|---|---|---|
| 390 × 844 | 404 × 422 | 50 % | 0 |
| 768 × 1024 | 640 × 668 | 65 % | 0 |
| 1024 × 1366 | 980 × 1023 | 75 % | 0 |
| 1440 × 900 | 680 × 709 | **79 %** | 0 |
| 1920 × 1080 | 858 × 896 | **83 %** | 0 |
| 2560 × 1440 | 998 × 1042 | 72 % | 0 |

---

## 6 · Tokens / agentes

Los diez agentes son los propios de NEXUS (`veil, haze, probe, pulse, spear, blitz, warden, tripwire,
specter, echo`). **No se ha introducido ningún agente de Riot, ni un asset suyo, ni un retrato.** Sobre
el mapa la ficha es glifo + anillo del color del rol, con el nombre del agente colgado debajo; en
paneles y listas va glifo + nombre + clase. En `despues/15b-pizarra-anotada-1440.png` conviven cinco
fichas, una utilidad, una flecha y una nota, y las cinco fichas siguen leyéndose.

---

## 7 · Toolbar

Mismas herramientas, ni una más ni una menos, agrupadas por intención. Cada utilidad lleva **su** color
—el mismo `UTILITY_COLOR` que tendrá sobre el mapa, así que elegir y reconocer usan el mismo dato— y
cada forma su icono. El estado activo va a filo pleno sobre fondo al 20 %, y la tira `tool-status`
junto a la mesa dice en texto qué está armado y qué hará el siguiente gesto, con botón «Soltar».

---

## 8 · Steps

La secuencia es una tira vertical de pasos a la izquierda de la mesa: pasado en gris, activo en oro,
futuro en contorno, `+ PASO` al final y `1 / 3` abajo. El modelo de datos no se ha tocado: los mismos
pasos, los mismos textos, el mismo formato `N. Nombre` que cuenta `trainer:verify`. El nombre y las
notas del paso se editan en el rail.

---

## 9 · Plan Táctico

`despues/20-plan-1440.png`. Comunica de un vistazo: planta del mapa, **ASCENT**, `__QA_F47__ vs
__QA_F47_RIVAL__`, fecha, marcador `13 - 9` como cifra, y la composición 5/5 con sus cinco glifos. A la
derecha, **▲ ATAQUE** (canto rojo, 3 jugadas) y **▼ DEFENSA** (canto cian, «sin jugadas») como dos
bloques distintos. Ningún dato inventado: rival, fecha y marcador salen de `coach_matches`; lo que no
existe no se pinta.

---

## 10 · Presentar / fullscreen

`despues/16-teatro-1440.png`, `17-teatro-1920.png`, `18-teatro-768.png`.

Fullscreen real por la Fullscreen API, con respaldo a modo foco si el navegador la rechaza. Arriba
mapa, lado y nombre de la jugada; a la izquierda quién juega; el mapa en el centro con la proporción
de su encuadre; a la derecha `01/03` y el nombre del paso en grande; abajo los mandos y la línea de
tiempo, cuyo tramo en curso se rellena con el progreso real de la transición. La interpolación de
520 ms **no se ha tocado**. Medido: el mapa ocupa el 71 % del alto a 390, 75 % a 768, 79 % a 1024 y
83 % del alto útil a 1920.

Decisión consciente: el mando de cámara sigue existiendo en presentación, atenuado al 25 % hasta que se
le acerca el puntero. Un entrenador querrá acercarse a un sitio mientras explica y «Ctrl + rueda» no es
evidente en una tele.

---

## 11 · Responsive y tablet

Barrido a 390 / 768 / 1024 / 1440 / 1920 / 2560 (`docs/product/qa/fase47-1/responsive.json`):
**0 desbordes horizontales en las tres pantallas, a los seis anchos**, y el mapa entero dentro del
lienzo en todos.

En tablet (768 y 1024) el mapa manda: 58 % y 68 % del viewport, con la secuencia debajo de la mesa y el
rail a continuación. El teatro llega al 75 % y 79 %. El selector de mapa cae en 6 × 2 a 768 y en 4 × 3 a
390, con los doce visibles a la vez.

---

## 12 · Prueba de coordenadas

`docs/product/qa/fase47-1/qa-informe.json`. Cinco fichas colocadas en coordenadas normalizadas
conocidas —`DUE 63,38 · CON 50,50 · INI 43,45 · CEN 29,41 · FLX 53,63`— guardadas, la página recargada
y la jugada reabierta. `fichasAntes` y `fichasDespues` son idénticas. Y las mismas cinco leídas a
**768, 1024, 1440 y 1920** devuelven exactamente los mismos valores: una coordenada normalizada sigue
significando el mismo punto táctico a cualquier ancho. Cambiar el reparto **no movió ninguna estrategia
guardada**.

---

## 13 · QA real realizada

Contra la base de datos real por túnel SSH, con la cuenta de QA `1ff2c0ef-…`, en la build de producción
en `:3005` — no en `next dev`:

- Entrenador → Composiciones → abrir composición existente → Pizarra → abrir strat → colocar los cinco
  → asignar agentes → dibujar flecha, zona, humo y nota → crear pasos → cambiar de paso → Guardar →
  recargar → reabrir → verificar posiciones.
- Presentar desde la pizarra → paso siguiente → salir.
- Partidos → Plan Táctico → strat asignada → Presentar.
- Barrido responsive a seis anchos y medida de geometría en vivo (`_fase47-1-medir.ts`).

---

## 14 · Screenshots

`docs/product/qa/fase47-1/`: **19 en `antes/` + 25 en `despues/`**, más `qa-01-montada.png` y
`qa-02-recargada.png` del recorrido. Cubren hub, composiciones vacío, composición 5/5, editor, pizarra
vacía, pizarra con strat, pizarra con selección, pizarra con anotaciones, teatro, teatro paso 2,
partidos, plan y plan presentando, a 390 / 768 / 1024 / 1440 / 1920.

---

## 15 · `npm test`

**4525 / 4525 PASS**, 0 fail, 0 skipped. Misma línea base que antes de empezar.

## 16 · `tsc`

`tsc --noEmit` **PASS** y `tsc -p tsconfig.scripts.json` **PASS**.

## 17 · `lint`

`npm run lint` → **exit 0**. 28 warnings, todos `Unused eslint-disable directive` ya documentados como
P2; ninguno nuevo y ninguno en ficheros de esta fase.

## 18 · `build`

`npm run build` **PASS**.

## 19 · Producción

`next start -p 3005` levantado contra la build final. `GET /api/game/state` → **401** (correcto sin
sesión), `GET /entrenador` → **200**. **No queda `next dev` como estado final.** El túnel a la base de
datos queda abierto para que la aplicación sea usable.

## 20 · Runtime

En las 25 escenas capturadas: **0 errores de hidratación, 0 errores de chunk, 0 assets 404 y 0 errores
de React**. Los únicos mensajes de consola son 74 respuestas `429` del limitador de la propia API,
provocadas por el arnés al pedir varias pantallas seguidas — no ocurren navegando a mano.

## 21 · Working-tree safety

Solo lectura primero (`git status`, `git diff --stat`), copia de seguridad de cada fichero antes de
tocarlo y parche con ancla verificada, seguido de `diff` para comprobar el cambio. Saltos de línea
preservados fichero a fichero (`MapPicker.tsx` es CRLF; `plan`, `composiciones` y `strats` son LF).
Cero `git reset`, `git clean`, `git restore`, `git checkout .`, stash o rebase. Cero `Write` ciego
sobre fichero existente. El árbol pasó de **994 a 995** entradas: la única nueva es el instrumento
`scripts/_fase47-1-medir.ts`. **Ningún trabajo previo sin commitear se ha perdido.**

## 22 · Sistemas no tocados

Gameplay, combate, economía, progresión, cartas, colección, sobres, tienda, F45, F46, home, worker de
Pick'em, VPS, esquema de Supabase, Caddy y Docker: sin tocar. **`GLOBAL_MARKET_ENABLED = false`**, sin
cambios. **0 migraciones**, cabeza en `0054`.

## 23 · P2 restante

1. **ORIGINAL AGENT PORTRAIT ART** — sigue abierto, y a propósito. No se han inventado retratos, ni
   círculos con iniciales, ni emojis, ni imágenes externas: la identidad la siguen dando los glifos
   originales.
2. **La mesa no crece más allá del contenedor de la aplicación.** A 2560 el mapa se queda en 998 px de
   ancho porque `GameShell` corta el contenido en 1.480 px. No es una regresión del Entrenador: es la
   caja de todo NEXUS. Si algún día se ensancha, el tope de la mesa sube con ella (queda escrito en el
   código dónde y por qué).
3. **28 warnings de ESLint** de directivas `eslint-disable` sobrantes, ya documentados y fuera del
   alcance de esta fase.

---

## Veredicto

**GO.** El mapa domina las pantallas tácticas, el Composition Manager se construye a clics, el rail se
entiende y la herramienta armada es evidente, los agentes se distinguen sobre el mapa, la secuencia se
lee como una línea de tiempo, Presentar ya enseña de verdad la jugada y aprovecha la pantalla, el Plan
Táctico comunica partida, composición y los dos bandos, el tablero responde de 390 a 2560 y las
coordenadas normalizadas están intactas. Tests, tipos, lint y build en verde; producción en `:3005`.
