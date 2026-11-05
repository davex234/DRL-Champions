# FASE 9 — TORNEOS + PICK'EMS

Informe de cierre. Todo lo que sigue está **medido en el navegador sobre la build de
producción**, no estimado: 102 capturas en `docs/product/qa/fase9/` y las salidas de
`scripts/_fase9-audit.ts` con el servidor en `http://127.0.0.1:3005`.

---

## 1 · ESTADO

**FASE 9 — CERRADA.**

---

## 2 · QUÉ ESTABA MAL

Radiografía completa antes de tocar una línea (`_fase9-audit.ts antes`, seis resoluciones,
`/torneos`, `/torneos/[id]` y `/pickems`).

### El dato que lo resume

| | `/torneos` | ficha de torneo | `/pickems` |
|---|---|---|---|
| **primitivas del sistema en el DOM** | **0** | **0** | **0** |
| chaflanes de la casa | 4 | **0** | 2 |
| clases `rounded-*` | 7 | **50** | **40** |
| `text-[Npx]` | 25 | 53 | 45 |
| controles < 44 px | 4 de 12 | **12 de 17** | **10 de 17** |

Ninguna de las tres pantallas usaba `Stage`, `Plate`, `Recessed`, `Piece`, `Rail`,
`Medallion`, `Readout`, `Badge`, `Meter` ni `NxButton`. La ficha de torneo y el panel de
predicciones estaban enteros en el lenguaje anterior.

### Torneos

- **T1 · Faltaban dos niveles de los seis que pide el circuito.** No había ni «próximos
  enfrentamientos» ni «bracket / progresión». Lo único que se veía del torneo vivo era una
  cinta con el partido en directo.
- **T2 · El escenario destacado desperdiciaba dos tercios de su ancho.** 1.408 px de
  superficie con el contenido apretado en el tercio izquierdo.
- **T3 · Estado por color.** «En curso / Próximo / Finalizado» se distinguían por tres
  cadenas de clases escritas a mano y un mapa de `r,g,b` sueltos.
- **T4 · Dos CTA escritos a mano** con `<Link>` y clases, no `NxButton`.

### Ficha de torneo

- **D1 · Jerarquía plana.** H1 de 30 px y **tres H2 de 20 px**: cabecera, Pick'ems, Partidos
  y Clasificación pesaban lo mismo.
- **D2 · El partido EN VIVO estaba enterrado.** NRG 1–1 Sentinels era la **tercera fila** de
  una tabla de cuarenta, a ~1.500 px de scroll, y no se distinguía de uno de julio.
- **D3 · Los partidos eran una tabla administrativa** de cuatro columnas repetida. Cuartos,
  Semifinal y Final eran etiquetas de 11 px: ningún «camino hacia la final».
- **D4 · Emojis como iconografía**: `📍` sede, `💰` premio, `🥇🥈🥉` podio, `🏅` `📅` `🗳️`
  `🔍` `🏆` en los estados vacíos.
- **D5 · 2.480 px de alto a 1440 y 3.764 px a 390** (scroll ×4,46).

### Pick'ems

- **P1 · La pantalla no enseñaba ni una predicción.** Con más de un Pick'em en el circuito
  abría en un **selector** de dos tarjetas idénticas y el panel no llegaba a montarse. El
  modo entero quedaba detrás de un clic invisible. *(Medido: 214 nodos, 0 opciones.)*
- **P2 · Las opciones parecían campos de formulario deshabilitados.** Rectángulos de
  **667 × 42 px** con el nombre pegado al borde izquierdo. Es el momento en que el jugador
  moja y se leía como un `<input>` en gris.
- **P3 · 42 px de alto**: por debajo del objetivo táctil.
- **P4 · El estado dependía casi solo del color** del borde: verde acertada, rojo elegida.
- **P5 · A 390, la primera predicción accionable estaba a ~1.900 px** de scroll, porque las
  preguntas salían en el orden del servidor y las tres primeras estaban cerradas.
- **P6 · Los puntos vivían en una tira de cuadro de mando** de texto pequeño.

---

## 3 · QUÉ HE CAMBIADO

### Torneos — *The Nexus Circuit*

- El escenario destacado se reparte en **dos columnas**: identidad del torneo a la izquierda,
  **PRÓXIMOS ENFRENTAMIENTOS** a la derecha con los tres siguientes partidos como piezas
  `A vs B`, y un enlace al camino completo.
- **Una consulta en vez de una**: la que traía solo el partido en directo ahora trae las
  filas completas del torneo destacado, y de ahí salen el directo *y* los próximos. No se
  añadió ninguna petición.
- Estado con **insignia + punto + palabra** y tres tonos distintos (en curso cian, próximo
  ámbar, finalizado apagado). Se distingue en blanco y negro.
- `Stage`, `Plate`, `Badge`, `StatusDot`, `Readout`, `SectionTitle`, `NxButton`.

### Ficha de torneo

- **Orden nuevo**: quién compite → **qué se juega AHORA** → tu decisión → el camino a la
  final → la clasificación.
- **El partido vivo sube al primer plano** como `MatchCard size="hero"`. Si no hay ninguno
  vivo sube el siguiente programado; si tampoco hay, **no se pinta nada** (no se rellena el
  hueco con datos que no existen).
- **`RoundLadder`** — el camino hacia la final. La forma la decide la **forma de los datos**,
  no una lista de nombres: pocas rondas y cada una con menos partidos que la anterior →
  escalera horizontal; cualquier otra cosa (una liga de ocho jornadas) → rondas apiladas. En
  móvil la escalera se desplaza **dentro de su carril**, nunca la página.
- Cabecera en `Stage` con `Readout` para fechas, equipos, sede y premio: **sin `📍` ni `💰`**.
- Clasificación con **`Medallion`** numerado en vez de `🥇🥈🥉`, y `Readout` para los puntos.

### Pick'ems — *Make your call*

- **Abre el evento vivo.** Antes solo se abría solo con exactamente uno; ahora se elige el
  que tiene preguntas abiertas y, si ninguno las tiene, el primero de la lista que ya sirve
  el servidor ordenada por cierre.
- **El selector baja debajo del panel.** Puesto encima (mi primera versión de esta fase)
  empujaba las predicciones 750 px en móvil: el jugador aterrizaba otra vez en un selector,
  solo que más bonito.
- **`PickQuestion`** — la predicción como decisión: ronda, puntos en `Readout`, estado en
  `Badge`, y **los dos bandos enfrentados con un VS en medio**, centrados y de 56 px de alto.
  Con más de dos opciones, rejilla de dos columnas ya en móvil.
- **Cinco estados, con palabra y marca dibujada**: Pendiente · Tu elección · Cerrada ·
  Acertada · Fallada (+ «No jugada»). La marca es un SVG original —check, cruz, punto— con el
  canto del sistema: **acierto y fallo se distinguen sin ver el color**.
- **Las preguntas se agrupan por lo que puedes hacer con ellas**: *Por decidir* → *Tus
  predicciones* → *En juego* → *Corregidas*. Dentro de cada bloque, el orden exacto del
  servidor (`order_idx`). **Ninguna pregunta se esconde.**
- **`PickScore`** — los puntos como cifra competitiva (`Readout` de 40 px) con su barra.
- El resumen de resultado (`PickemResult`) pasa a `Piece`/`Plate`/`Recessed`/`NxButton`, con
  el cierre como pieza de icono y la marca dibujada.

### La costura entre los dos modos

La primera versión de este informe daba la conexión torneo → predicción por imposible y la
anotaba como deuda. **Era falso, y comprobarlo contra la base lo demostró**:
`pickem_questions.match_id` está poblado (`demo-m3`…`demo-m7`) y ya viaja en el DTO
`PickemQuestion`. La arquitectura sí lo permite, así que —como pide la Parte 4— se
**representa**, no se documenta:

- Cada partido de la ficha lleva su marca de predicción: **Puedes predecir · Tu predicción ·
  Predicción cerrada · Acertaste · Fallaste · Sin predicción**.
- Aparece en el partido destacado y en cada nodo del camino a la final, que es donde el
  jugador busca «¿tengo algo en juego aquí?».
- **El enlace no se adivina cruzando nombres de equipo**: se lee `match_id`, la clave que el
  propio dominio establece. Cruzar por texto habría sido frágil e inventado lógica.
- Es lectura pura: dos campos que ya existen traducidos a una etiqueta. No se puntúa, no se
  compara ningún resultado que el servidor no haya publicado en `correct_option`, y no se
  toca ni el generador de preguntas ni el corrector.

---

## 4 · QUÉ NO HE CAMBIADO

**Ni una línea de lógica.** Intactos, sin tocar:

- `src/domain/**` — `pickems/questions.ts`, `pickems/rewards.ts`, `pickems/ledger.ts`,
  `tournaments/*`, `progression/rank`
- `src/server/services/pickems.ts` (`submitPick`, `setCorrectOption`, `scorePickemEvent`),
  `pickemLifecycle.ts`
- `src/tournament*/**` (engine, orchestrator, runtime, scheduler, watcher, control,
  notifications, autopipeline) · `src/engine/tournament.ts` · `src/lib/tournaments/**`
- `src/app/api/pickems/route.ts` y todos los contratos de `src/lib/game/client.ts`
- Supabase, esquema, RLS, vistas (`pickem_questions_public`, `ranking_pickem_event`)
- Cálculo de puntos, escalones, recompensas, créditos, XP, rangos, economía
- El pipeline de datos VCT y los importadores
- Motor de Duelos, cartas, mercado, tienda, colección

Comportamientos que se han **conservado a propósito**:

- La UI sigue siendo **optimista con el servidor mandando**: si `submitPick` falla se
  revierte, y si falla por cierre se recarga.
- El `Countdown` sigue avisando al expirar para que el panel recargue. *(Se perdió al
  extraer `PickQuestion` y se restauró antes de cerrar: es contrato existente.)*
- La marca **DEMO** sigue en todas partes, y el aviso de torneo de demostración también.
- El resumen de resultado sigue saliendo una sola vez por corrección.

---

## 5 · ARQUITECTURA VISUAL

Primitivas del sistema, medidas en el DOM (`[data-surface]`):

| pantalla | antes | después |
|---|---|---|
| `/torneos` | `{}` | `{stage: 1, plate: 4, recessed: 3}` |
| ficha de torneo | `{}` | `{stage: 1, plate: 13, recessed: 11, object: 8, medallion: 2}` |
| `/pickems` | `{}` | `{stage: 1, plate: 7, recessed: 2, object: 6}` |

**Piezas nuevas — dos, y porque no existía ninguna equivalente.** Se buscó antes: no había
`MatchCard`, `TeamBlock`, `Bracket`, `PickChoice` ni nada parecido en `src/components`.

| pieza | por qué | quién la usa |
|---|---|---|
| `components/tournaments/Match.tsx` → `MatchCard`, `RoundLadder` | Un partido no es una fila de tabla | `/torneos` (próximos) y la ficha (destacado + camino) |
| `components/pickems/PickQuestion.tsx` → `PickQuestion`, `PickScore` | Una predicción no es un formulario | el panel, que usan `/pickems` y la ficha |

**No se ha creado ningún `…V2` ni `…New`.** `PickemPanel` sigue siendo el único sitio donde
se guarda una predicción, compartido por las dos pantallas, como antes.

Geometría **en código**, excluyendo comentarios (los `rounded-*` que aún aparecen en los
ficheros están dentro de comentarios que explican el cambio):

| fichero | `rounded-*` | `rounded-full` | `text-[Npx]` |
|---|---|---|---|
| `torneos/page.tsx` | 0 → **0** | 3 → **0** | 12 → **3** |
| `torneos/[id]/page.tsx` | 4 → **1** | 0 → **0** | 2 → **2** |
| `pickems/page.tsx` | 1 → **0** | 1 → **0** | 1 → **1** |
| `PickemPanel.tsx` | 7 → **0** | 1 → **0** | 12 → **1** |
| `PickemResult.tsx` | 12 → **0** | 3 → **0** | 12 → **4** |
| `Match.tsx` *(nuevo)* | — → **0** | — → **0** | — → 4 |
| `PickQuestion.tsx` *(nuevo)* | — → **0** | — → **1** | — → 6 |
| **total** | **24 → 1** | **8 → 1** | **39 → 21** |

Lo que queda es exactamente esto y nada más:

- **1 `rounded-control`**: el enlace «‹ Torneos», que es el idioma compartido de vuelta del
  producto (el mismo que usa Duelos).
- **1 `rounded-full`**: el anillo de 20 px de la marca de acierto/fallo. Un círculo debe ser
  redondo.

**Controles nativos**: 0 `<select>` y 0 `<input>` antes y después.

---

## 6 · RESPONSIVE

Las seis resoluciones del encargo, después:

| | 390×844 | 768×1024 | 1024×768 | 1280×800 | 1440×900 | 1920×1080 |
|---|---|---|---|---|---|---|
| **overflow-X** | **0** | **0** | **0** | **0** | **0** | **0** |
| `/torneos` alto | 1276 | 1105 | 908 | 908 | 920 | 1080 |
| ficha · scroll | ×4,0 | ×2,85 | ×3,58 | ×3,40 | ×3,05 | ×2,52 |
| `/pickems` · scroll | ×3,40 | ×2,21 | ×2,69 | ×2,56 | ×2,28 | ×1,90 |

Profundidad de scroll en la ficha a **390: ×4,46 → ×4,0**, y eso **añadiendo** el partido
destacado, el camino a la final y las cabeceras de bloque. La página pasa de 3.764 a
3.372 px.

`/pickems` a 390 pasa de 859 a 2.870 px: **no es una regresión, es que antes no había nada
que medir** — la pantalla enseñaba el selector y el panel no se montaba.

Decisiones específicas de móvil, no de encogimiento:
- La escalera del bracket se desplaza **dentro de su carril** (`overflow-x` declarado en el
  contenedor), con las columnas a `min(78vw, 300px)`.
- Las preguntas de más de dos opciones arrancan en **dos columnas ya en 390** (eran ocho
  bloques apilados: 500 px de scroll para una sola pregunta).
- El selector de eventos va al final.

---

## 7 · TESTS

Todo sobre la build de producción con el servidor en `:3005`.

| | antes | después |
|---|---|---|
| `npm test` | 696/696 | ✅ **696/696** |
| `npm run typecheck` | limpio | ✅ limpio |
| `npm run build` | OK | ✅ OK |
| `npm run lint` | 1 error preexistente | ⚠️ **el mismo, ninguno nuevo** |
| `security:verify` | OK | ✅ todas |
| `collection:verify` | OK | ✅ todas |
| `pack:verify` | OK | ✅ todas |
| `card-generator:verify` | 50/50 | ✅ **50/50** |
| `materializer:verify` | 42/42 | ✅ **42/42** |
| `catalog-builder:verify` | 44/44 | ✅ **44/44** |
| `duel-gameplay:verify` | OK | ✅ todas |
| `duel:e2e` | OK | ✅ todas |
| `duel:playtest` | 0 errores | ✅ 6 partidas · 0 errores |
| `ux:scroll` | 38/38 | ✅ **38/38** |
| `audit:stability` | 105 · P0 0 · P1 0 · P2 0 | ✅ **105 · P0 0 · P1 0 · P2 0** |
| `launcher:verify` | 33/33 | ✅ **33/33** |
| `_fase8-a11y` (regresión Duelos) | 14/14 | ✅ **14/14** |

**QA específico de esta fase:**

| | |
|---|---|
| `npm run test:pickems` | ✅ todas — incluye «el usuario no puede escribir sus propios puntos» y «existe ranking POR TORNEO» |
| `npm run loop:verify` | ✅ el ciclo de juego sigue conectado |
| `npm run test:flow` | ✅ recorrido demo completo: torneo → Pick'em → predicción → cierre → corrección → recompensa → sobre → colección |

**Fallos, clasificados** (ninguno introducido):

1. **`npm run lint` — 1 error, PREEXISTENTE.** `src/app/admin/torneos/page.tsx:190`,
   `useMemo` condicional. Fichero **sin modificar** en el árbol de trabajo, fuera de esta
   fase; ya se clasificó igual al cerrar la Fase 8.
2. **`npm run ux:verify` — 4 fallos, PREEXISTENTES.** Enlaces de 12 px de alto en **inicio**
   (`Ver todo`) y **tienda** (`Centro de eventos →`). **Los mismos cuatro que en la Fase 8**,
   ni uno más: ni Torneos ni Pick'ems aparecen en la lista. No se tocan (Parte 15).

---

## 8 · QA VISUAL

**102 capturas** en `docs/product/qa/fase9/`.

| conjunto | nº | qué cubre |
|---|---|---|
| `antes-*` | 41 | las tres rutas × seis resoluciones + página completa + estados provocados |
| `despues-*` | 42 | los mismos nombres y momentos |
| `despues-fallada-*` | 19 | el estado **predicción fallada**, que exige otra participación |

Estados cubiertos, en 390 y 1440 como mínimo:

- **Torneos**: carga, torneo activo, próximos enfrentamientos, finalizados, torneo sin
  Pick'ems, ficha no encontrada.
- **Pick'ems**: evento activo, predicción **pendiente**, **elegida**, **cerrada en juego**,
  **acertada**, **fallada**, puntos, recompensas, resumen de resultado, selector de eventos.
- **Ficha**: partido en vivo destacado, camino a la final (escalera), rondas apiladas (la
  liga de 40 partidos), clasificación, aviso de demostración.
- **Movimiento**: `motion-con-movimiento` / `motion-reducido`.

Los nombres coinciden entre `antes-` y `despues-` salvo dos capturas de página completa que
en «antes» no existían porque la pantalla cabía en el pliegue (`/pickems` solo enseñaba el
selector).

---

## 9 · ACCESIBILIDAD

Medido en el navegador, después:

```
teclado: 26 focalizables · 0 sin nombre accesible · 16 con aria-pressed · 26 con foco visible
zonas táctiles: 0 controles de Torneos o Pick'ems por debajo de 44 px
```

- **Objetivo táctil**: las opciones de predicción pasan de **42 a 56 px**. Los cuatro enlaces
  de apoyo que quedaban a 32-34 px se han subido a **44** sin tocar la clase compartida
  `nx-action`, que vive en veinte pantallas más.
- **Los únicos controles < 44 px que quedan son del armazón compartido**: `Inicio` (34 px,
  barra de navegación), `Tu nivel` (42 px, barra superior) y `Instalar` / `Cerrar` (36 px,
  aviso de instalación PWA). Ninguno pertenece a esta fase → §11, deuda D4.
- **El estado nunca depende solo del color**: cada predicción lleva su palabra
  («Pendiente», «Tu elección», «Cerrada», «Acertada», «Fallada»), su punto de estado y una
  **marca dibujada** en la opción; cada torneo y cada partido, lo mismo.
- Cada opción es un `<button>` con `aria-pressed` y un `aria-label` que dice si es tu
  elección y si es el resultado. Cada `MatchCard` tiene su `aria-label` («X contra Y, En
  vivo»). El bracket va en un `role="group"` con nombre.
- **`prefers-reduced-motion`**: mismo texto (1.923 caracteres), mismos nodos (501), mismas
  opciones (20) y mismas barras (2) con y sin movimiento. Se reduce movimiento, no
  información. Las transiciones de barra llevan `motion-reduce:transition-none`.

---

## 10 · PERFORMANCE

| | `/torneos` | ficha | `/pickems` |
|---|---|---|---|
| nodos DOM | 208 → 273 | 403 → 654 | 376 → 501 |
| animaciones en bucle infinito | 0 | 0 | 0 |
| **errores de consola** | **0** | **0** | **0** |
| tamaños de letra distintos en pantalla | — | 15 | 14 |

El DOM sube porque las pantallas **enseñan más cosas**: la ficha pasa de una tabla a un
partido destacado, cuatro bloques de predicciones y una escalera de tres rondas; `/pickems`
pasa de un selector vacío a un panel completo. No hay ni una animación en bucle.

Dos métricas suben de forma **engañosa** y conviene decir por qué:

- **`rounded-full` en el DOM** sube (15 → 43 en la ficha). No es una píldora más: son los
  `StatusDot` del sistema y las marcas de acierto/fallo, de 5 a 20 px. Contando solo lo que
  mide más de 24 px —una cápsula de verdad— quedan **3** en Torneos y en la ficha y **9** en
  Pick'ems, y **todas son del armazón compartido** (barra superior, aviso de instalación,
  `RankBadge`): en los siete ficheros de esta fase hay exactamente **un** `rounded-full`, el
  anillo de 20 px de la marca.
- **`box-shadow`** sube (6 → 84). `Recessed`, `Plate` y `Piece` construyen sus cantos con
  sombras **`inset`**; aplicar el sistema sube el recuento por construcción sin añadir ni una
  sombra flotante.

*(La sonda que intentaba separar sombras proyectadas de `inset` da un recuento no fiable
—parte las comas de dentro de `rgba()`—, así que su número no se usa en este informe.)*

---

## 11 · DEUDAS

Ninguna implementada. Todas documentadas.

| # | deuda | por qué no se toca |
|---|---|---|
| **D1** | La marca de predicción por partido vive en la **ficha del torneo**, no en la lista `/torneos`. La lista enseña el recuento («3 abiertas») y el CTA. | Llevarla a la lista exigiría pedir también *mis respuestas* de cada Pick'em del circuito: una consulta por torneo para una pantalla de resumen. La costura completa está donde se mira el torneo. |
| **D1b** | Una pregunta del Pick'em de demostración (`¿Qué equipo levantará el trofeo?`) **no tiene `match_id`** —correctamente: no corresponde a ningún partido—, así que no aparece marcada en ningún nodo del camino. | Es el comportamiento correcto, no un fallo. Se anota para que no se lea como un hueco. |
| **D2** | `EmptyState` —la pieza compartida de todo el producto— sigue siendo `rounded-2xl` punteado con un **emoji** como icono. | Vive en veinte pantallas; cambiarla es una fase de sistema, no de Torneos. En esta fase se sustituyó **localmente** por `Plate` + `NxButton` en las cinco pantallas vacías de estas rutas, sin tocar la primitiva. |
| **D3** | El **`🪙`** de créditos se mantiene. | Es la marca de moneda de **todo** el producto (tienda, mercado, colección, inventario, recompensas, logros): quitarla solo aquí rompería la consistencia. Es un símbolo de moneda, no un sistema de iconos ad-hoc. |
| **D4** | Cuatro controles del **armazón compartido** por debajo de 44 px: `Inicio` (34), `Tu nivel` (42), `Instalar` (36), `Cerrar` (36). | `GameShell` / barra superior / aviso PWA: fuera de estas dos rutas. |
| **D5** | `ux:verify`: enlaces de 12 px en **inicio** y **tienda**. | Los mismos cuatro fallos preexistentes de la Fase 8. Parte 15: no se rediseñan esas pantallas aquí. |
| **D6** | El bracket **solo vive en la ficha**, no en `/torneos`. | Duplicarlo en la lista sería una segunda implementación del mismo cuadro. La lista enseña los tres próximos enfrentamientos y enlaza al camino completo. |
| **D7** | La forma del calendario (escalera vs rondas apiladas) se decide por la **forma de los datos**, no por un campo del dominio. | Un campo `format` en `events` sería más honesto, pero es dominio. Documentado en el propio componente. |
| **D8** | `/pickems` con **más de un evento** sigue necesitando dos consultas por evento (preguntas + respuestas + puntos) para pintar el selector. | Es el comportamiento existente (`detailed = base.length > 1`); optimizarlo toca la capa de datos. |

---

## 12 · FICHEROS MODIFICADOS

```
M  src/app/torneos/page.tsx                     (lista del circuito)
M  src/app/torneos/[id]/page.tsx                (ficha de torneo)
M  src/app/pickems/page.tsx                     (centro de predicciones)
M  src/components/pickems/PickemPanel.tsx       (reparto y superficies; lógica intacta)
M  src/components/pickems/PickemResult.tsx      (superficies y botones del sistema)
+  src/components/tournaments/Match.tsx         NUEVO — MatchCard + RoundLadder
+  src/components/pickems/PickQuestion.tsx      NUEVO — PickQuestion + PickScore
+  scripts/_fase9-audit.ts                      NUEVO — instrumento de auditoría (no CI)
```

Sin tocar: `src/components/pickems/Countdown.tsx`, y todo `src/domain`, `src/server`,
`src/tournament*`, `src/app/api`, `supabase/`.

---

## 13 · RIESGOS

| riesgo | mitigación |
|---|---|
| **`/pickems` abre solo el evento vivo** — es un cambio de comportamiento visible. | Es una preferencia de presentación: no cambia qué Pick'ems existen ni su orden, y el selector sigue mandando en cuanto el jugador toca otro. Verificado con `test:flow` y `test:pickems`. |
| **`PickemPanel` reparte las preguntas en cuatro bloques.** Si alguien esperaba el orden crudo del servidor, la pantalla se ve distinta. | Dentro de cada bloque el orden es el del servidor. **Ninguna pregunta se esconde**: los cuatro bloques cubren los cuatro estados posibles y se pintan todos los que tienen contenido. |
| **`RoundLadder` decide su reparto por la forma de los datos.** Un torneo con rondas raras podría caer en el reparto equivocado. | El caso por defecto es el conservador (rondas apiladas); la escalera solo se activa con ≤4 rondas estrictamente decrecientes. Verificado con los dos torneos reales de la base: playoffs → escalera, liga de 40 partidos → apiladas. |
| **La consulta de partidos del destacado** trae todas las filas de ese torneo. | Es **un** torneo, no los diez del circuito, y sustituye a la consulta que ya existía. |
| **La ficha de torneo pide ahora también las preguntas y mis respuestas** para poder marcar cada partido, y `load` pasa a depender de `user`: se recarga una vez cuando la sesión resuelve. | Van dentro del `Promise.all` que ya existía. Verificado sin bucles de recarga: `audit:stability` 105 comprobaciones con P0/P1/P2 a cero y «0 pantallas vacías» en la segunda vuelta. |
| El árbol de trabajo tiene mucho sin commitear de fases anteriores. | **No he hecho commit ni despliegue**, y no he tocado nada fuera de los ocho ficheros de §12. |

---

## 14 · REGRESIONES

**Ninguna detectada.**

- Duelos (Fase 8): `duel:e2e` ✅, `duel:playtest` ✅ 0 errores, `ux:scroll` 38/38 ✅,
  accesibilidad 14/14 ✅.
- Navegación global: `audit:stability` 105 comprobaciones, **P0/P1/P2 a cero**, 25 saltos,
  0 pantallas vacías.
- Recorrido completo del producto: `test:flow` ✅ 22 pasos, «ningún enlace de navegación
  está roto».
- Otras pantallas: `ux:verify` da **exactamente los mismos 4 fallos preexistentes** que al
  cerrar la Fase 8, ni uno más.
- Un comportamiento **sí** se perdió al extraer `PickQuestion` —la recarga del panel cuando
  la cuenta atrás llega a cero— y **se restauró antes de cerrar**. Queda dicho porque pasó.

---

## 15 · VEREDICTO

| criterio de cierre | |
|---|---|
| Torneos tiene jerarquía clara | ✅ destacado → próximos → resto |
| Pick'ems tiene jerarquía clara | ✅ evento → por decidir → tus predicciones → en juego → corregidas |
| Ambas parecen NEXUS | ✅ 0 → 63 chaflanes, 0 → 34 primitivas en la ficha |
| No parecen dashboards SaaS | ✅ la tabla de partidos es ahora un camino; el formulario, una decisión |
| Activo / próximo / finalizado se entiende | ✅ palabra + punto + tono, distinguible sin color |
| Matches legibles | ✅ `MatchCard`, con el vivo en primer plano |
| Bracket usable | ✅ escalera en escritorio, carril desplazable en móvil, 0 overflow-X |
| Pick'ems se siente como decisión | ✅ dos bandos enfrentados con VS, 56 px |
| Selección clara | ✅ marca dibujada + «Tu elección» |
| Estados claros | ✅ cinco, con palabra y marca |
| Puntos con presencia | ✅ `Readout` de 40 px con barra |
| Conexión torneo → predicción visible | ✅ marca por partido vía `match_id`, en el destacado y en el camino |
| Responsive funciona | ✅ seis resoluciones, 0 overflow-X |
| 390 px funciona | ✅ scroll ×4,46 → ×4,0 enseñando más |
| Reduced-motion funciona | ✅ mismo texto, mismos nodos |
| Accesibilidad auditada | ✅ 18/18 con nombre y foco; 0 controles propios < 44 px |
| Sin overflow-X accidental | ✅ 0 en las seis |
| **Lógica sin alterar** | ✅ §4 y §12 |
| Tests verdes | ✅ 696/696 + toda la batería |
| Build y typecheck verdes | ✅ |
| QA visual realizado | ✅ 102 capturas |
| Deudas documentadas | ✅ 8, ninguna implementada |

**FASE 9 — CERRADA.**
