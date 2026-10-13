# FASE 10 — ENTRENADOR · THE NEXUS TACTICAL COMMAND CENTER

Informe de cierre. Todo lo que sigue está **medido en el navegador sobre la build de
producción**: 112 capturas en `docs/product/qa/fase10/` y las salidas de
`scripts/_fase10-audit.ts` con el servidor en `http://127.0.0.1:3005`.

---

## 1 · ESTADO

**FASE 10 — CERRADA.**

---

## 2 · RADIOGRAFÍA INICIAL

Antes de tocar una línea: lectura completa de las cuatro rutas, del dominio y de la suite de
QA existente, y una pasada del instrumento por las seis resoluciones.

### Lo que hay

| capa | fichero | qué es |
|---|---|---|
| Modelo | `src/domain/tactics/strat.ts` (648 l) | `Strat` formato 2 · `STRAT_VERSION = 2` · cada paso guarda su **estado táctico completo** · clonado en profundidad · topes y `sanitizeStrat` |
| Mapas | `src/domain/tactics/maps.ts` | 12 mapas con encuadre medido, `toPixels`/`toGrid` |
| Lienzo | `components/tactics/MapCanvas.tsx` | cámara = `viewBox` · **Ctrl/Cmd + rueda** · pan · pinza · `preserveAspectRatio="xMidYMid meet"` |
| Capas | `components/tactics/StrategyBoard.tsx` | 4 `<g>` hermanos del `<image>` dentro del MISMO `<svg>` |
| Datos | `lib/tactics/client.ts` + `/api/game/strats` | guardar · cargar · duplicar · borrar, saneado en servidor |
| Ejecución | `/entrenador/strats/revisar` | **ya existía**: modo presentación `readOnly`, paso a paso, con teclado |
| QA | `maps:verify` `trainer:verify` `strats:verify` `tactical:verify` | 14/14 · **35/35** · PASA · PASA |

### El dato que resume el problema

| a 1440×900 | hub | mapas | **pizarra** | revisar |
|---|---|---|---|---|
| **mapa · % del viewport** | — | 53 % | **40 %** | 54 % |
| **mapa · % de la página** | — | 28 % | **23 %** | 42 % |
| borde superior del lienzo | — | 229 px | **251 px** | 197 px |
| primitivas del sistema | **0** | **0** | **0** | **0** |
| chaflanes de la casa | 5 | **0** | **0** | **0** |
| elementos redondeados | 45 | 38 | **94** | 30 |
| clases `rounded-*` | 20 | 26 | **67** | 16 |
| **controles < 44 px** | 6 de 31 | 8 de 25 | **44 de 67** | 9 de 20 |
| controles nativos | — | — | 3 `input` · 2 `textarea` | 1 `select` |

A 390×844 el editor era **356 × 267 px — el 29 % del viewport y el 7 % de una página de
3.291 px** (scroll ×3,9).

---

## 3 · QUÉ ESTABA MAL

- **E1 · El mapa no era el protagonista.** En la pizarra —la pantalla central— el lienzo se
  quedaba en el 40 % del viewport, la peor cifra de las tres pantallas con mapa, y el 29 %
  en móvil. Con `[260px_1fr_290px]` el mapa era **la columna del medio**, no el escenario.
- **E2 · El selector de doce mapas era un panel permanente.** Una columna entera en
  escritorio y **~1.100 px de scroll en móvil por encima de las herramientas**, para una
  acción que se hace una vez por sesión.
- **E3 · 44 de 67 controles por debajo de 44 px** en la pizarra: utilidades 36 × 36, colores
  24 × 24, formas ~28 de alto, cámara 32 × 32. Es la pantalla del producto que más se usa
  con el dedo sobre una superficie.
- **E4 · Cero primitivas del sistema y cero chaflanes.** El Entrenador entero hablaba el
  idioma anterior: `nx-panel`, `rounded-card`, `rounded-control`, botones escritos a mano.
- **E5 · Jerarquía plana.** H1 de 38 px y tres H2 de 10 px; cabecera y barra de trabajo
  apiladas empujaban el lienzo a 251 px del borde.
- **E6 · Controles nativos sin vestir**: 3 `<input>` y 2 `<textarea>` en la pizarra, y un
  `<select>` del sistema operativo en el modo presentación.
- **E7 · Un focalizable sin nombre accesible** (la nota del paso).
- **E8 · Iconografía por glifo**: `✓` en los pasos del vestíbulo, `🗺️` en el estado vacío
  del modo revisión.

---

## 4 · QUÉ YA ESTABA BIEN Y NO SE TOCÓ

Esto es la mitad del trabajo de esta fase: **descubrir que la arquitectura táctica ya era
buena y no reemplazarla.**

- **El modelo de estrategia.** Formato 2, cada paso con su estado completo, clonado en
  profundidad para que mover una ficha en el paso 2 no la mueva en el 1. `STRAT_VERSION`
  intacto.
- **La cámara.** Zoom por `viewBox`, nunca sobre la imagen. **Ctrl/Cmd + rueda** —la rueda
  sola es de la página, que es lo que verifica `ux:scroll`—, pan por puntero y pinza a dos
  dedos. No se ha tocado ni una línea de la mecánica.
- **El orden de las capas.** Anotaciones → dibujos → utilidades → jugadores → PNG, como
  hermanos dentro del mismo `<svg>`. Cuatro `<g>`, ni uno más: es lo que hace imposible una
  desalineación y lo que comprueba `trainer:verify`.
- **El PNG.** Entero, en su tamaño real, sin recortes ni filtros. Los doce assets y su
  catálogo: `maps:verify` sigue dando 14/14.
- **La persistencia.** `/api/game/strats`, `sanitizeStrat`, los topes, los IDs.
- **El modo ejecución.** `revisar` ya existía y funcionaba, con navegación por flechas del
  teclado. No se ha creado ningún motor ni ninguna simulación.
- **La accesibilidad de las fichas.** Cada token del mapa ya era enfocable y se movía con
  las flechas. Sigue igual: 5 fichas enfocables medidas.

---

## 5 · QUÉ SE HA CAMBIADO

### El lienzo (`MapCanvas`)

- El contenedor pasa a llevar **el canto del sistema** —chaflán, filo de luz, sombra
  propia— en vez de `rounded-panel` con un borde de 1 px. **La geometría del mapa no cambia**:
  mismo `viewBox`, mismo `preserveAspectRatio`, mismo `<image>`.
- **Mando de cámara a 44 px** (era 32 × 32) con las superficies de la casa. El
  comportamiento —`fitCamera`, los factores de zoom, el aviso de «Ctrl + rueda»— es idéntico.

### La pizarra

- **De tres columnas a dos**: `[minmax(0,1fr)_320px]`. El mapa se queda con la grande.
- **El lienzo se mide en `vh`, también en móvil**: `h-[min(58vh,470px)]` →
  `sm:min(64vh,560px)` → `xl:min(80vh,880px)`. Deja de ser un `aspect-[4/3]` de 267 px.
- **Cabecera y barra de trabajo fundidas en una tira**, para devolverle al mapa los píxeles
  que ocupaban dos bloques apilados.
- **Elegir mapa, Mis estrategias y Descripción bajan a paneles plegables** dentro del rail.
  Son `<details>`, así que **siguen montados en el DOM** y el selector sigue ofreciendo sus
  doce mapas.
- **Rail táctico con hitbox de 44 px** en las cuatro familias —puntero, jugadores,
  utilidades, formas y color—, con `aria-pressed` en todas.
- **Campos de texto del sistema** (`Campo`): siguen siendo `<input>`/`<textarea>` nativos
  —lo que se escribe es texto— pero con la superficie hundida de la casa y 44 px de alto.
- El rol se dice **con su color y con sus tres letras**; el objeto seleccionado, **con una
  insignia y con su nombre**. Nada depende solo del color.

### Mapas

- Cabecera de una línea: el lienzo sube de `top 229` a **`top 155`**.
- Lienzo en `vh` también en móvil (267 px → **470 px**).
- Los datos del mapa como `Readout`; el texto de contexto baja al panel lateral.

### Revisar (ejecución)

- **El `<select>` nativo desaparece**: la lista de estrategias es un carril de botones del
  sistema con `aria-pressed`, que en móvil no abre una rueda del sistema operativo encima
  del mapa.
- Cabecera de una línea con la insignia **REVISIÓN**: el modo se distingue del editor de un
  vistazo. El lienzo llega al **59 % del viewport**.
- El paso actual pasa a `Piece` con `Badge` y sus cuatro cifras en `Readout`.
- Estado vacío sin emoji, con `Plate` + `NxButton`.

### Vestíbulo

- La ruta táctica pasa a `Stage` + `Plate` + **`Medallion`**, con la marca de paso completado
  **dibujada en SVG** en vez del glifo `✓`.
- Dos `Readout` en la cabecera con el estado real: titulares y estrategias guardadas.

---

## 6 · QUÉ NO SE HA CAMBIADO

**Ni una línea de lógica ni de geometría.** Intactos:

- `src/domain/tactics/**` — `strat.ts`, `maps.ts`, `tactics.test.ts`, `STRAT_VERSION`,
  `sanitizeStrat`, topes, clonado
- `src/components/tactics/StrategyBoard.tsx` — **sin tocar**: capas, orden, coordenadas,
  arrastre, teclado
- `src/components/tactics/MapThumb.tsx` — **sin tocar**
- La mecánica de cámara de `MapCanvas`: `fitCamera`, `toGrid`, `pxPerScreen`, `onWheel`,
  pan, pinza, `viewBox`, `preserveAspectRatio`
- `src/app/api/game/strats/route.ts`, `src/lib/tactics/client.ts`
- Los doce PNG de `/public/maps` y el catálogo
- `src/tactics/**`, `src/coach/**`, `src/domain/cardgame`, economía, mercado, recompensas,
  ranking, Supabase, esquema, pipeline VCT

Textos y selectores que las verificaciones leen y que **no se han tocado**: `+ Paso`, los
pasos como «N. Nombre», `role="radio"` × 12 en el selector de mapas, los cuatro `<g>` de
capas, `role="application"` del lienzo, `g[role="button"]` de las fichas, y el orden
mapa-antes-que-`<aside>` en móvil.

---

## 7 · ARQUITECTURA VISUAL

Primitivas medidas en el DOM (`[data-surface]`), antes → después:

| pantalla | antes | después |
|---|---|---|
| vestíbulo | `{}` | `{plate: 19, stage: 1, medallion: 4, object: 5, recessed: 1}` |
| mapas | `{}` | `{plate: 3, recessed: 1}` |
| pizarra | `{}` | `{plate: 7, recessed: 1, object: 1}` |
| revisar | `{}` | `{plate: 3, object: 1, recessed: 1}` |

Chaflanes de la casa en el DOM: hub 5 → **33** · mapas 0 → **23** · pizarra 0 → **72** ·
revisar 0 → **18**.

Geometría en código, sin comentarios:

| fichero | `rounded-*` | `rounded-full` | primitivas |
|---|---|---|---|
| `entrenador/page.tsx` | 7 → **0** | 1 → **0** | 0 → 20 |
| `entrenador/mapas/page.tsx` | 0 → **0** | 0 → **0** | 0 → 13 |
| `entrenador/strats/page.tsx` | 22 → **0** | 2 → **0** | 0 → 32 |
| `entrenador/strats/revisar/page.tsx` | 3 → **0** | 0 → **0** | 0 → 21 |
| `tactics/MapCanvas.tsx` | 4 → **0** | 0 → **0** | — |
| `tactics/MapPicker.tsx` | 2 → **0** | 0 → **0** | — |
| **total** | **38 → 0** | **3 → 0** | **0 → 86** |

**Controles nativos**: `<select>` **1 → 0** (medido en el DOM). Quedan 3 `<input>` y 2
`<textarea>` en la pizarra, que son campos de texto de verdad —nombre de la estrategia,
nombre del paso, notas, texto de la anotación, descripción— vestidos con la superficie
hundida del sistema.

**Iconografía**: sin emojis. Las utilidades siguen usando `UtilityGlyph` (SVG del producto);
la marca de paso completado y el cierre son SVG originales; el podio y los estados usan
`Medallion` y `Badge`.

---

## 8 · MAPAS Y CAPAS

- **Los doce assets, intactos.** `maps:verify` 14/14, incluida «ningún componente escribe una
  ruta de mapa a mano» y «las dimensiones reales coinciden con las del catálogo».
- **El PNG no se toca**: `trainer:verify` comprueba que el zoom cambia el `viewBox` y deja el
  `<image>` idéntico. Sigue pasando.
- **Cuatro capas**, en el mismo orden, dentro del mismo `<svg>`: medido en las seis
  resoluciones, `4 capas` en pizarra y en revisión.
- **Sin deformación**: `preserveAspectRatio="xMidYMid meet"` y `viewBox` derivado del
  encuadre real. Las doce miniaturas siguen usando `contain`.

## 9 · JUGADORES

Cinco fichas, una por rol, con el color del rol **y** su abreviatura de tres letras. Nacen
colocadas (`emptyStrat`) y siguen siendo enfocables con teclado y movibles con las flechas:
`fichasEnfocables: 5` medido. En el rail, cada rol es un botón de 44 px que se deshabilita
cuando ese rol ya está en el mapa.

## 10 · UTILIDADES

Las nueve del dominio, con su glifo SVG y su `aria-label` (`Humo`, `Destello`,
`Incendiaria`…). En el rail son botones de 44 × 44 con `aria-pressed`. Sobre el mapa
conservan su forma y su color del dominio: **ni una coordenada, ni un tipo, ni un dato
cambiado**.

## 11 · LÍNEAS

Las seis formas —flecha, línea, círculo, rectángulo, zona y trazo— con su paleta cerrada de
seis colores. Botones de 44 px de alto; el tirador de color pasa de 24 a un objetivo de 44
con la muestra de 20 dentro. El dibujo por arrastre sigue funcionando:
`trainer:verify` comprueba que un arrastre deja una forma con recorrido.

## 12 · ANOTACIONES

Siguen siendo el mismo tipo del dominio: texto en una coordenada. El campo de texto pasa a
la superficie del sistema y la anotación colocada se lee sobre el mapa (visible en
`despues-1440-revisar.png`). **No se ha inventado ningún tipo nuevo.**

## 13 · ESTRATEGIAS · 14 · GUARDAR / CARGAR

Los cinco gestos existentes —**Nueva, Abrir, Guardar, Duplicar, Borrar**— con la misma
lógica y los mismos contratos. Lo que cambia:

- La estrategia actual tiene presencia en la tira de trabajo: nombre, bando y guardar en una
  línea, con **Revisar** al lado en cuanto está guardada.
- Las guardadas viven en un panel plegable del rail, cada una como `Piece` con su mapa, su
  bando, sus pasos y su fecha, y las cuatro acciones a 44 px.
- `strats:verify` sigue pasando, incluido «no se puede duplicar la estrategia de otro».

---

## 15 · RESPONSIVE

| | 390×844 | 768×1024 | 1024×768 | 1280×800 | 1440×900 | 1920×1080 |
|---|---|---|---|---|---|---|
| **overflow-X** | **0** | **0** | **0** | **0** | **0** | **0** |
| pizarra · mapa % viewport | **51 %** | 51 % | 49 % | 49 % | **54 %** | 44 % |
| mapas · mapa % viewport | 51 % | 55 % | 55 % | 55 % | 58 % | 45 % |
| revisar · mapa % viewport | 54 % | 51 % | 56 % | 56 % | **59 %** | 46 % |
| pizarra · alto de página | 2.322 | — | — | — | 1.529 | — |

**Antes / después de la pizarra:**

| | antes | después |
|---|---|---|
| 390 · lienzo | 356 × 267 px · **29 %** | 358 × 470 px · **51 %** |
| 390 · página | 3.291 px (×3,9) | **2.322 px (×2,75)** |
| 1440 · lienzo | 792 × 682 px · **40 %** | 1.044 × 720 px · **54 %** |
| 1440 · página | 1.639 px | **1.529 px** |

En 1920 el porcentaje baja al 44-46 % porque el rail mide 320 px fijos y el alto se topa en
`min(80vh, 880px)`: el lienzo mide 1.084 × 864, que es **más grande en píxeles que en
cualquier otra resolución**. El porcentaje cae, la superficie sube.

Móvil no es escritorio encogido: el lienzo se mide en `vh`, el rail va debajo en una tira
compacta y elegir mapa, estrategias y descripción están plegados.

## 16 · ACCESIBILIDAD

```
teclado: 69 focalizables · 0 sin nombre accesible · 5 fichas del mapa enfocables · 69 con foco visible
zonas táctiles: 0 controles del Entrenador por debajo de 44 px
```

- **Objetivo táctil**: pizarra **44 de 67 controles < 44 px → 0**. Los 3-4 que la sonda sigue
  contando son del armazón compartido (`Inicio` 34, `Tu nivel` 42, `Instalar` 36,
  `Cerrar` 36), no del Entrenador → §21, deuda D3.
- **Nombre accesible**: 2 → **0** sin nombre. El que faltaba era la nota del paso, que
  tampoco lo tenía antes de esta fase.
- **Sin depender del color**: el rol lleva color + abreviatura; el objeto seleccionado,
  insignia + nombre; el paso completado, medallón + marca dibujada; el estado del mapa,
  palabra + punto.
- **`prefers-reduced-motion`**: mismo texto (740 caracteres), mismos nodos (457), mismas
  fichas (5) y mismas capas (4) con y sin movimiento. Las transiciones de las piezas llevan
  `motion-reduce:transition-none`.

## 17 · PERFORMANCE

| | hub | mapas | pizarra | revisar |
|---|---|---|---|---|
| nodos DOM | 345 → 393 | 277 → 286 | 430 → 457 | 298 → 318 |
| elementos redondeados | 45 → **17** | 38 → **15** | 94 → **16** | 30 → **16** |
| **animaciones en bucle infinito** | **0** | **0** | **0** | **0** |
| **errores de consola** | **0** | **0** | **0** | **0** |

El DOM sube entre un 3 y un 14 % porque las primitivas del sistema llevan sus capas de canto
—una `Plate` es un nodo con su filo, donde antes había un `div` con un borde—. A cambio los
elementos con geometría redondeada bajan de 94 a 16 en la pizarra. No se ha añadido ni un
observer, ni un temporizador, ni un `requestAnimationFrame`.

## 18 · TESTS

| | antes | después |
|---|---|---|
| `npm test` | 696/696 | ✅ **696/696** |
| `npm run typecheck` | limpio | ✅ limpio |
| `npm run build` | OK | ✅ OK |
| `npm run lint` | 1 error preexistente | ⚠️ **el mismo, ninguno nuevo** |
| **`maps:verify`** | 14/14 | ✅ **14/14** |
| **`trainer:verify`** | **35/35** | ✅ **35/35** |
| **`strats:verify`** | PASA | ✅ **PASA** |
| **`tactical:verify`** | PASA | ✅ **PASA** |
| `security:verify` | OK | ✅ todas |
| `collection:verify` · `pack:verify` | OK | ✅ todas |
| `card-generator:verify` | 50/50 | ✅ 50/50 |
| `materializer:verify` | 42/42 | ✅ 42/42 |
| `catalog-builder:verify` | 44/44 | ✅ 44/44 |
| `duel-gameplay:verify` · `duel:e2e` | OK | ✅ todas |
| `duel:playtest` | 0 errores | ✅ 0 errores |
| `ux:scroll` | 38/38 | ✅ **38/38** |
| `audit:stability` | 105 · P0 0 · P1 0 · P2 0 | ✅ **105 · P0 0 · P1 0 · P2 0** |
| `launcher:verify` | 33/33 | ✅ 33/33 |
| `loop:verify` · `test:flow` · `test:pickems` | OK | ✅ todas |
| a11y de Duelos (Fase 8) | 14/14 | ✅ **14/14** |
| `ux:verify` | 4 fallos preexistentes | ⚠️ **los mismos 4** |

**Fallos, clasificados** (ninguno introducido):

1. **`lint` — 1 error, PREEXISTENTE.** `src/app/admin/torneos/page.tsx:190`, `useMemo`
   condicional. Fichero sin modificar, fuera de esta fase. Igual que en las Fases 8 y 9.
2. **`ux:verify` — 4 fallos, PREEXISTENTES.** Enlaces de 12 px en **inicio** y **tienda**.
   **Los mismos cuatro de las Fases 8 y 9**, ni uno más: ninguna ruta del Entrenador aparece.

## 19 · QA VISUAL

**112 capturas** en `docs/product/qa/fase10/` — 56 `antes-*` y 56 `despues-*`, mismos nombres
y mismos momentos.

Cubre, en las seis resoluciones: entrada al Entrenador · selección de mapa · mapa vacío ·
pizarra con jugadores · con utilidades · con líneas · con anotaciones · estrategia completa ·
herramienta activa · guardar y cargar (panel de estrategias) · estados de panel plegado ·
vacío (nada que revisar) · **ejecución/replay** (`revisar`) · movimiento con y sin
`prefers-reduced-motion` · página completa de cada ruta.

Los datos son los del producto: los doce mapas reales y **una estrategia sembrada con las
funciones del dominio y guardada por la ruta real**, con 5 jugadores, 4 utilidades, 3 dibujos
y 2 anotaciones. El usuario y su estrategia se borran al terminar.

## 20 · FICHEROS MODIFICADOS

```
M  src/app/entrenador/page.tsx                    (vestíbulo)
M  src/app/entrenador/mapas/page.tsx              (estudio de mapas)
M  src/app/entrenador/strats/page.tsx             (la pizarra)
M  src/app/entrenador/strats/revisar/page.tsx     (ejecución)
M  src/components/tactics/MapCanvas.tsx           (canto del lienzo + mando de cámara)
M  src/components/tactics/MapPicker.tsx           (chaflán en las miniaturas)
+  scripts/_fase10-audit.ts                       NUEVO — instrumento de auditoría (no CI)
+  docs/product/fase-10-entrenador-report.md      NUEVO — este informe
```

**Sin tocar**: `StrategyBoard.tsx`, `MapThumb.tsx`, `UtilityGlyph.tsx`, todo `src/domain`,
`src/tactics`, `src/coach`, `src/app/api`, `supabase/`.

## 21 · DEUDAS

Ninguna implementada. Todas documentadas.

| # | deuda | por qué no se toca |
|---|---|---|
| **D1** | **DEUDA — NO TOCAR EN FASE 10.** No existe historial de partidos dirigidos: el vestíbulo lo declara como «Por definir» porque esa persistencia no está en ninguna tabla. | Es dominio y esquema. Parte 21. |
| **D2** | El vestíbulo mide **4.258 px a 390** (×5,05) — es la ruta más larga del Entrenador, por las doce fichas de mapa a dos columnas. | Enseñar los doce mapas es lo que hace que el vestíbulo sea un escaparate y no un índice. Recortarlo sería quitar el contenido; paginar es una decisión de producto. |
| **D3** | Cuatro controles del **armazón compartido** por debajo de 44 px: `Inicio` (34), `Tu nivel` (42), `Instalar` (36), `Cerrar` (36). | `GameShell` / barra superior / aviso PWA: fuera de estas rutas. Anotado igual en las Fases 8 y 9. |
| **D4** | `ux:verify`: enlaces de 12 px en **inicio** y **tienda**. | Los mismos cuatro preexistentes. Parte 25: no se tocan otras pantallas. |
| **D5** | A 1920 el lienzo se topa en `min(80vh, 880px)` y el rail mide 320 fijos, así que el % de viewport baja al 44 %. | En píxeles es el lienzo más grande de todas las resoluciones (1.084 × 864). Subir el tope exigiría medir en pantallas reales de 4K, que no tengo. |
| **D6** | Los doce mapas comparten un mismo tratamiento visual oscuro; en `Ascent` el trazado se lee como alambre sobre negro. | Es el asset, y **los assets no se tocan** (Parte 4). Mejorar el contraste exigiría regenerar los PNG. |
| **D7** | La pizarra conserva 3 `<input>` y 2 `<textarea>` nativos. | Son campos de texto de verdad. Se han vestido con la superficie del sistema; sustituir el elemento nativo perdería corrección ortográfica, dictado y autocompletado. |
| **D8** | No hay **deshacer/rehacer** en la pizarra. | Es funcionalidad nueva, no presentación. Parte 21: documentar, no implementar. |

## 22 · RIESGOS

| riesgo | mitigación |
|---|---|
| **El reparto pasa de tres columnas a dos.** Quien conociera la pizarra encontrará el selector de mapas en otro sitio. | Sigue en pantalla, plegado y rotulado «Mapa · Ascent», en el rail. `trainer:verify` sigue encontrando sus doce `role="radio"`. |
| **Plegar paneles con `<details>`** podría desmontar contenido del que depende una verificación. | No lo desmonta: un `<details>` cerrado mantiene el DOM. Comprobado — el selector sigue devolviendo 12. |
| **El lienzo pasa a medirse en `vh`.** En una ventana muy baja podría quedarse pequeño. | Hay suelo (`min(58vh, 470px)` en móvil) y tope. Medido en las seis resoluciones del encargo, incluida 1024×768 y 1280×800. |
| **Tocar `MapCanvas`** es tocar el fichero más delicado del Entrenador. | Solo el envoltorio y el mando de cámara. La mecánica —`viewBox`, `toGrid`, `pxPerScreen`, rueda, pan, pinza— no tiene ni un carácter cambiado, y `trainer:verify` comprueba el zoom, la alineación de capas y que el `<image>` no se toque. |
| Árbol de trabajo con mucho sin commitear de fases anteriores. | **Sin commit y sin despliegue**, y sin tocar nada fuera de los ocho ficheros de §20. |

## 23 · REGRESIONES

**Ninguna detectada.**

- **Suite del Entrenador**: `maps:verify` 14/14 · `trainer:verify` **35/35** ·
  `strats:verify` PASA · `tactical:verify` PASA. Exactamente lo mismo que antes de empezar.
- **Duelos** (Fase 8): `duel:e2e` ✅, `duel:playtest` 0 errores, `ux:scroll` 38/38,
  accesibilidad 14/14.
- **Torneos y Pick'ems** (Fase 9): `test:pickems` ✅, `loop:verify` ✅.
- **Navegación global**: `audit:stability` 105 comprobaciones, P0/P1/P2 a cero.
- **Recorrido completo**: `test:flow` ✅ 22 pasos, «ningún enlace de navegación está roto».
- **Otras pantallas**: `ux:verify` da los mismos 4 fallos preexistentes, ni uno más.

## 24 · VEREDICTO

| criterio de cierre | |
|---|---|
| Identidad visual NEXUS | ✅ 0 → 86 primitivas · 5 → 146 chaflanes · 38 → 0 `rounded-*` |
| **El mapa es el protagonista** | ✅ pizarra 40 % → **54 %** (1440) y 29 % → **51 %** (390) |
| Herramientas comprensibles | ✅ rail por familias, `aria-pressed`, 44 px |
| Jugadores comprensibles | ✅ color + abreviatura, enfocables |
| Utilidades comprensibles | ✅ glifo + `aria-label`, distinguibles sin color |
| Líneas comprensibles | ✅ seis formas, paleta cerrada, arrastre verificado |
| Anotaciones comprensibles | ✅ integradas sobre el mapa |
| Estrategia actual visible | ✅ nombre, bando y guardar en la tira de trabajo |
| Guardar/cargar claro | ✅ los cinco gestos, misma lógica |
| Los flujos existentes funcionan | ✅ 35/35 en `trainer:verify` |
| Responsive funciona | ✅ seis resoluciones |
| 390×844 funciona | ✅ lienzo ×1,76 y página −29 % |
| Sin overflow-X | ✅ 0 en las seis |
| Reduced-motion funciona | ✅ mismo texto, mismos nodos, mismas capas |
| Accesibilidad auditada | ✅ 69/69 con nombre y foco; 0 controles propios < 44 px |
| Performance auditada | ✅ 0 bucles infinitos |
| 0 errores de consola | ✅ |
| Tests, build y typecheck verdes | ✅ |
| QA visual completo | ✅ 112 capturas |
| Regresiones comprobadas | ✅ |
| Deudas documentadas | ✅ 8 |
| **Lógica sin alterar** | ✅ §6 |

**FASE 10 — CERRADA.**
