# FASE 11 — PERFIL + PROGRESIÓN · MY NEXUS

Informe de cierre. Todo lo que sigue está **medido en el navegador sobre la build de
producción**: 106 capturas en `docs/product/qa/fase11/` y las salidas de
`scripts/_fase11-audit.ts` con el servidor en `http://127.0.0.1:3005`.

---

## 1 · ESTADO

**FASE 11 — CERRADA.**

---

## 2 · RADIOGRAFÍA INICIAL

### Lo primero: las rutas no se llaman como se suponía

El encargo hablaba de `/perfil`, `/logros`, `/pase` y `/rangos`. **Tres de esas cuatro no
existen.** La arquitectura real, declarada en `src/design/nav.ts` bajo la sección
«Progreso», es:

| ruta real | qué es | lo que el encargo llamaba |
|---|---|---|
| **`/cuenta`** | el PERFIL: rango, nivel y cifras | `/perfil` |
| **`/ranking`** | la CLASIFICACIÓN global, regional y por torneo, **y la escalera de rangos** | `/rangos` |
| **`/logros`** | LOGROS **y PASE** de temporada, objetivos y misiones — todo en una | `/logros` + `/pase` |
| **`/recompensas`** | lo que has ganado y cuándo, con su recibo | — |

El pase **no tiene ruta propia**: vive dentro de `/logros`, servido por `PassRail`. La
implementación se ha adaptado a esa arquitectura, no al revés.

### Inventario de datos reales

Todo sale de `profiles` (server-only), `user_cards`, `user_packs`, `pickem_scores` y el
libro mayor de créditos. Disponibles y usados: username · avatar · cosméticos equipados
(banderín, marco, título, insignia) · puntos · rango y división · posición global y regional
· región declarada · XP · créditos · cartas distintas y totales · sobres sin abrir ·
Pick'ems jugados y aciertos · recompensas · escalones · niveles del pase · objetivos ·
logros. **No se ha inventado ninguna métrica.**

---

## 3 · QUÉ ESTABA MAL

| # | problema | dónde | medido |
|---|---|---|---|
| **P1** | **El nivel del perfil contradecía al del armazón.** La barra superior decía «NIVEL 11» y la ficha «Nivel 1», en la misma pantalla. | `/cuenta` | ver §10 |
| **P2** | **Ninguna barra de progreso era una barra de progreso.** El progreso de rango era un `div` con un ancho en línea: sin `role="progressbar"`, sin `aria-valuenow`. Un lector de pantalla no leía ningún avance. | `/cuenta` | `meters: 0` |
| **P3** | **No existía progreso de XP.** El perfil decía «Nivel 1 · 4.200 XP» y ahí se acababa: ni cuánto falta ni para qué. | `/cuenta` | — |
| **P4** | **22 de 32 controles por debajo de 44 px**: doce avatares a 40 × 40, siete cifras enlazadas a 92 × 37, cerrar sesión a 102 × 35. | `/cuenta` | 24 de 31 a 390 |
| **P5** | **Cero primitivas de superficie** en las cuatro rutas. | todas | `primitivas {}` |
| **P6** | **Una cápsula roja de 450 px con resplandor** como pestaña activa: la píldora decorativa que el lenguaje de la casa rechaza. | `/ranking` | 15 clases `rounded-*` |
| **P7** | **Un `<select>` nativo** para elegir torneo, y un enlace de **119 × 15 px** — el único control de la sección por debajo de 32. | `/ranking` | 1 `<32px` |
| **P8** | Cajas `rounded-2xl` genéricas y una cápsula `rounded-full` como chip. | `/recompensas` | 16 clases `rounded-*` |
| **P9** | **404 de dos retratos** (`/players/wo0t.png`, `/players/derke.png`) al pintar la vitrina de colección. | `/cuenta` | 12 errores de consola |

---

## 4 · QUÉ YA ESTABA BIEN

Parte del trabajo de esta fase fue **no rehacer lo que ya funcionaba**:

- **`RankEmblem`** — la pieza de rango, con sus ocho escalones y sus divisiones. Reutilizada,
  no duplicada. No existe ningún `RankEmblemV2`.
- **`RankBadge`** — la insignia compuesta con su barra. Reutilizada en `/ranking` y
  `/recompensas`.
- **`PassRail`** — el carril del pase, con sus dos vías y sus recompensas. Intacto.
- **`/logros`** ya era la ruta mejor trabajada de la sección: **102 chaflanes y 19 barras de
  progreso** antes de esta fase. Se auditó y **casi no se tocó**.
- **La ficha del perfil** ya estaba recompuesta como ficha de jugador (emblema grande, tira
  de cifras sobre la ficha, vitrina de cartas, ajustes al final). La jerarquía era correcta.
- El dominio: `rank.ts`, `levels.ts`, `achievements.ts`, `duelRewards.ts` — sólidos y con
  tests.

---

## 5 · QUÉ SE HA CAMBIADO

### `/cuenta` — la ficha de jugador

- **Las dos progresiones, una debajo de otra**, cada una con su rótulo, su cifra y su barra:
  **NIVEL** (cian) con «219 / 656 XP para el nivel 12» y **RANGO** (color del rango) con
  «110 puntos para Platino». Antes solo se veía la de rango, y sin semántica.
- **`role="progressbar"` con `aria-valuenow`** en las dos.
- La tira de cifras se construye **sobre `Readout`**, la primitiva del sistema, en vez de
  repintar la tipografía a mano; cada destino llega a 44 px.
- Avatares 40 → **44 px** con chaflán; regiones a 44; cerrar sesión a 44; «Ver todas» a 44.
- Ajustes en `Plate`, rótulos con `SectionTitle`.

### `/ranking` — clasificación y escalera

- **La cápsula desaparece**: las tres pestañas son controles con chaflán dentro de una
  superficie hundida, a 44 px, y ahora tienen **semántica de pestaña** (`role="tab"`,
  `aria-selected`), que no tenían.
- **El `<select>` nativo desaparece**: los torneos son botones del sistema en un carril
  desplazable con `aria-pressed`.
- Los selectores de región a 44 px con chaflán; las filas a `Plate`; el avatar de fila a 44.
- El enlace del pie pasa de **119 × 15** a un objetivo de 44.

### `/recompensas`

- Cajas genéricas → `Piece` (última recompensa), `Plate` (escalones, resumen) y `Recessed`
  (historial).
- El chip cápsula → `Badge`; las tres cifras → `Readout`; los encabezados → `SectionTitle`.

### `/logros` y componentes compartidos

- `/logros`: solo el estado vacío pasa al chaflán de la casa. **Nada más.**
- `RankBadge`: su única acción pasa de 36 a **44 px** y gana foco visible.

---

## 6 · QUÉ NO SE HA CAMBIADO

**Ni una línea de dominio, cálculo o dato.** Intactos:

- `src/domain/progression/**` — `rank.ts`, `levels.ts`, `achievements.ts`, `duelRewards.ts`
  y sus tests
- `src/domain/pickems/rewards.ts` (escalones), `src/domain/events`, economía, créditos
- `PassRail.tsx`, `RankEmblem.tsx` — **sin tocar**
- `src/app/api/**`, Supabase, esquema, RLS, `profiles` y sus columnas
- Colección, cartas, `Card3D`, `PlayerCard`, tienda, mercado, duelos, torneos, entrenador

---

## 7 · ARQUITECTURA VISUAL

Primitivas de superficie medidas en el DOM (`[data-surface]`):

| ruta | antes | después |
|---|---|---|
| `/cuenta` | `{}` | `{recessed: 2, plate: 1}` |
| `/ranking` | `{}` | `{recessed: 1, plate: 2}` |
| `/recompensas` | `{}` | `{object: 1, plate: 7, recessed: 1}` |
| `/logros` | `{}` | `{}` — ya construida con `nx-clip` a mano (102 chaflanes) |

Chaflanes: `/cuenta` 20 → **39** · `/ranking` 24 → **32** · `/recompensas` 4 → **14** ·
`/logros` 102 (sin cambios).

Geometría en código, sin comentarios:

| fichero | `rounded-*` | `rounded-full` | `<select>` |
|---|---|---|---|
| `cuenta/page.tsx` | 2 → **0** | 2 → **0** | 0 |
| `ranking/page.tsx` | 7 → **0** | 0 | **1 → 0** |
| `recompensas/page.tsx` | 5 → **0** | 1 → **0** | 0 |
| `logros/page.tsx` | 1 → **0** | 0 | 0 |
| `RankBadge.tsx` | 0 | 4 (barras de progreso) | 0 |
| `PassRail.tsx` | 0 | 2 (raíl del pase) | 0 |
| **total propio** | **15 → 0** | **3 → 0** | **1 → 0** |

Lo que queda de `rounded-full` son **barras**: un raíl de progreso con extremos redondeados
es lo correcto, y es lo que hace el propio `Meter` del sistema. No hay ni una cápsula
decorativa.

**Nota honesta sobre `/cuenta`:** el DOM sigue midiendo 39 clases `rounded-*` y 52 elementos
redondeados. **Ninguno es de esta pantalla**: salen de `Card3D` (7 + 3 clases, × 4 cartas de
la vitrina) y de `GameShell` (5 + 6) — componentes de la Colección y del armazón global,
fuera del alcance de esta fase.

---

## 8 · IDENTIDAD DEL JUGADOR

Protagonista y medida: **H1 de 52 px** con el nombre, el emblema de rango a 112 px, la
insignia de división, la región, y los cosméticos equipados —banderín, marco, título,
insignia de maestría— cuando existen. Debajo, la vitrina de prestigio y las cuatro mejores
cartas.

Jerarquía medida a 1440: `H1/52px` nombre → `H2/10px` vitrina → `H2/10px` ajustes. La
identidad pesa cinco veces más que cualquier otra cosa de la pantalla.

## 9 · RANGO

`RankEmblem` reutilizado, con su color, su escalón y sus divisiones. Se dice **con emblema,
con palabra y con cifra**: «ORO III · 640 pts · 110 puntos para Platino». La escalera
completa de ocho rangos vive en `/ranking`, con `RankEmblem` en cada peldaño. **Ni el
cálculo, ni los umbrales, ni los nombres, ni las divisiones se han tocado.**

## 10 · NIVEL / XP — el hallazgo de esta fase

**`profiles.level` es una columna muerta.** Comprobado contra la base:

```
username             level   xp     points
NEXUSDemo_2f86         1    2567      42
econamtljy320_e618     1     284       0
```

Todo el mundo es nivel 1, incluido un perfil con 2.567 XP. **Nadie la escribe**: no hay
trigger, ni migración, ni servicio que la actualice. Mientras tanto, la barra superior del
armazón deriva el nivel de la XP con `levelFromXp(xp)`, la función del dominio. Resultado:
en la misma pantalla se leía **«NIVEL 11» arriba y «Nivel 1» en la ficha**.

**Qué se ha hecho:** el perfil llama a `levelFromXp` — **la misma función que ya usaba el
armazón**. No hay cálculo nuevo, no se toca el dominio, no se toca el esquema y la columna
se queda donde está. Es elegir cuál de las dos fuentes existentes se pinta, y la otra estaba
provablemente muerta.

**Qué NO se ha hecho:** arreglar el dato. Rellenar o retirar `profiles.level` es trabajo de
dominio y migración → **deuda D1**.

Con eso, el nivel gana lo que le faltaba: **su barra**, con `role="progressbar"`, y el texto
«219 / 656 XP para el nivel 12».

## 11 · PROGRESIÓN

Dos barras en la ficha (nivel y rango) y diecinueve en `/logros` (pase, objetivos, misiones).
Todas responden a «¿qué me falta?» con una cifra concreta, no con un porcentaje suelto.

## 12 · LOGROS · 13 · OBJETIVOS · 14 · PASE

`/logros` los reúne, y **ya estaba bien**: el pase con sus dos vías (Libre y Competitivo) en
`PassRail`, los objetivos por cadencia (Diarias · Semanales · De temporada · Hitos) y los
logros con su estado. 19 barras de progreso y 102 chaflanes antes de esta fase. Se auditó y
**solo se tocó el estado vacío**. No se ha inventado ningún logro ni ninguna recompensa.

## 15 · COLECCIÓN

El perfil **no duplica** la Colección: enseña una cifra —«20 / 772 · 20 cartas»— y las
cuatro mejores cartas, con el CTA «Ver todas →» a `/coleccion`. Ni filtros, ni álbum, ni
rarezas.

## 16 · ESTADÍSTICAS

Siete cifras en una tira sobre la ficha, no en siete tarjetas: puntos, torneos, aciertos,
recompensas, colección, sobres y créditos. Son contexto y pesan como contexto: la tira mide
`Readout size="md"` frente al H1 de 52 px de la identidad.

---

## 17 · RESPONSIVE

| | 390×844 | 768×1024 | 1024×768 | 1280×800 | 1440×900 | 1920×1080 |
|---|---|---|---|---|---|---|
| **overflow-X** | **0** | **0** | **0** | **0** | **0** | **0** |
| `/cuenta` alto | 2.251 | — | — | — | 1.291 | — |
| `/ranking` alto | 1.894 | — | — | — | 1.097 | — |
| `/logros` alto | 4.626 | — | — | — | 2.788 | — |
| `/recompensas` alto | 1.998 | — | — | — | 1.238 | — |

`/recompensas` a 390 baja de 2.067 a **1.998 px**; `/cuenta` sube de 2.081 a 2.251 porque
**añade la barra de nivel y su texto**, que antes no existían. Es más página a cambio de más
información, y se dice.

A 390 el orden es el que pide el encargo: identidad → rango y nivel → progreso → cifras →
vitrina → ajustes.

## 18 · ACCESIBILIDAD

```
teclado: 32 focalizables · 0 sin nombre accesible · 32 con foco visible
zonas táctiles: 0 controles de la sección Progreso por debajo de 44 px
```

| | antes | después |
|---|---|---|
| `/cuenta` · controles < 44 px | **22 de 32** | **4** — todos del armazón |
| `/ranking` · < 44 px | 9 de 14 | **4** — todos del armazón |
| `/ranking` · < 32 px | **1** | **0** |
| `/recompensas` · < 44 px | 6 de 11 | **4** — todos del armazón |
| `/logros` · < 44 px | 4 de 9 | **4** — todos del armazón |
| barras con `role="progressbar"` en `/cuenta` | **0** | **2** |
| `<select>` nativos | **1** | **0** |

Los cuatro que quedan en todas las rutas son los mismos: `Inicio` (34), `Tu nivel` (42),
`Instalar` (36) y `Cerrar` (36) — barra de navegación, barra superior y aviso PWA → deuda D3.

**`prefers-reduced-motion`**: el texto es **idéntico** (896 caracteres), las barras son las
mismas (2) y los controles con estado los mismos (16). El DOM baja de 562 a 555 nodos: son
**siete capas decorativas de `Card3D`** —brillo y reflejo, `pointer-events-none`, sin
contenido— que la carta no pinta cuando se pide menos movimiento. Es el comportamiento
correcto de un componente de la Colección, no una pérdida de información.

## 19 · PERFORMANCE

| | `/cuenta` | `/ranking` | `/logros` | `/recompensas` |
|---|---|---|---|---|
| nodos DOM | 523 → 555 | 546 → 546 | 771 → 771 | 308 → 316 |
| elementos redondeados | 71 → **52** | 28 → **21** | 60 → 60 | 31 → **21** |
| **animaciones en bucle** | **0** | **0** | **0** | **0** |
| errores de consola | 12 (404 de retratos) | 0 | 0 | 0 |

`/cuenta` sube 32 nodos: son la segunda barra de progresión y sus rótulos. No se ha añadido
ningún observer, temporizador ni animación.

## 20 · TESTS

| | antes | después |
|---|---|---|
| `npm test` | 696/696 | ✅ **696/696** |
| `npm run typecheck` | limpio | ✅ limpio |
| `npm run build` | OK | ✅ OK |
| `npm run lint` | 1 error + 8 avisos preexistentes | ⚠️ **los mismos, ninguno nuevo** |
| **`progression:verify`** | PASA | ✅ **PASA** |
| **`battlepass:verify`** | todas | ✅ **todas** |
| `security` · `collection` · `pack` | OK | ✅ todas |
| `card-generator` · `materializer` · `catalog-builder` | 50/50 · 42/42 · 44/44 | ✅ iguales |
| `duel-gameplay` · `duel:e2e` · `duel:playtest` | OK · 0 errores | ✅ iguales |
| `ux:scroll` | 38/38 | ✅ **38/38** |
| `trainer:verify` · `maps:verify` · `strats:verify` | 35/35 · 14/14 · PASA | ✅ iguales |
| `audit:stability` | 105 · P0 0 · P1 0 · P2 0 | ✅ **iguales** |
| `loop:verify` · `test:pickems` · `test:flow` · `launcher:verify` | OK | ✅ todas |
| a11y de Duelos (Fase 8) | 14/14 | ✅ **14/14** |
| `ux:verify` | 4 fallos preexistentes | ⚠️ **los mismos 4** |

**Fallos, clasificados** (ninguno introducido):

1. **`lint` — 1 error, PREEXISTENTE.** `admin/torneos/page.tsx:190`, `useMemo` condicional.
   Fuera de esta fase. Igual que en las Fases 8-10.
2. **`ux:verify` — 4 fallos, PREEXISTENTES.** Enlaces de 12 px en **inicio** y **tienda**.
   Los mismos cuatro de las Fases 8, 9 y 10. Ninguna ruta de Progreso aparece.
3. **12 errores de consola en `/cuenta` — PREEXISTENTES, de contenido.** Son 404 de
   `/players/wo0t.png` y `/players/derke.png`: dos retratos que el pipeline de artwork no ha
   generado. `PlayerPhoto` ya cae a su silueta de reserva, así que la pantalla no se rompe →
   deuda D2.

## 21 · QA VISUAL

**106 capturas** en `docs/product/qa/fase11/` — 53 `antes-*` y 53 `despues-*`, mismos
nombres y momentos, en las seis resoluciones.

Cubre: perfil completo · identidad · rango · nivel · progreso · colección resumen ·
estadísticas · ajustes · **perfil sin sesión** (el estado vacío real) · clasificación global
· **regional** · **por torneo** · escalera de rangos · logros · pase · objetivos ·
recompensas · escalones · historial · página completa de cada ruta · movimiento con y sin
`prefers-reduced-motion`.

Datos del producto, con un usuario de usar y tirar al que se le siembran 20 cartas por la
RPC real y puntos/XP/créditos en las columnas server-only —igual que hace el corrector de
Pick'ems—. El rango y el nivel los **deriva el dominio**. El usuario se borra al terminar.

## 22 · FICHEROS MODIFICADOS

```
M  src/app/cuenta/page.tsx                        (la ficha: nivel, XP, barras, táctil)
M  src/app/ranking/page.tsx                       (pestañas, select, filas, táctil)
M  src/app/recompensas/page.tsx                   (superficies y cifras del sistema)
M  src/app/logros/page.tsx                        (solo el estado vacío)
M  src/components/progression/RankBadge.tsx       (su acción, a 44 px)
+  scripts/_fase11-audit.ts                       NUEVO — instrumento de auditoría (no CI)
+  docs/product/fase-11-perfil-progresion-report.md  NUEVO — este informe
```

**Sin tocar**: `PassRail.tsx`, `RankEmblem.tsx`, todo `src/domain`, `src/app/api`,
`supabase/`, `Card3D`, `PlayerCard`, `GameShell`.

## 23 · DEUDAS

Ninguna implementada. Todas documentadas.

| # | deuda | por qué no se toca |
|---|---|---|
| **D1** | **`profiles.level` es una columna muerta**: nadie la escribe y vale 1 para todos. El producto deriva el nivel de la XP en dos sitios; ahora los dos usan `levelFromXp`, pero la columna sigue ahí mintiendo a quien la lea. Hay que **rellenarla con un trigger o retirarla en una migración**. | Es dominio y esquema (Parte 24). |
| **D2** | **404 de dos retratos**: `/players/wo0t.png` y `/players/derke.png` no existen. Degrada bien —hay silueta de reserva— pero ensucia la consola. | Es contenido del pipeline de artwork, no código de esta fase. |
| **D3** | Cuatro controles del **armazón compartido** por debajo de 44 px: `Inicio` (34), `Tu nivel` (42), `Instalar` (36), `Cerrar` (36). | `GameShell` / barra superior / aviso PWA. Igual en las Fases 8-10. |
| **D4** | `ux:verify`: enlaces de 12 px en **inicio** y **tienda**. | Los mismos cuatro preexistentes. Parte 28. |
| **D5** | **El avatar es un emoji** de una lista de doce, guardado en `profiles.avatar`. La Parte 22 pide no usar emojis como iconografía, pero aquí el emoji **es el dato del usuario**, no un icono del sistema. Cambiarlo migraría datos de cuentas reales. | Es dato de usuario y migración. Los cosméticos equipados (marco, avatar comprado) ya lo sustituyen cuando existen. |
| **D6** | **`/logros` mide 4.626 px a 390** (×5,48): la ruta más larga del producto. Reúne pase, objetivos de cuatro cadencias y logros. | Separar el pase a su propia ruta es una decisión de producto e implicaría navegación nueva, no presentación. |
| **D7** | `Card3D` no pinta sus 7 capas decorativas con `prefers-reduced-motion`, así que el recuento de nodos cambia aunque la información no. | Es el comportamiento correcto y vive en un componente de la Colección (Fase 5, cerrada). |
| **D8** | El perfil **no tiene historial de actividad** (últimos duelos, últimos Pick'ems). La Parte 14 lo pedía «solo si esos datos existen»: existen repeticiones de duelo y puntuaciones de Pick'em, pero no una vista de actividad unificada. | Requiere una lectura nueva y una decisión de producto. **No se ha inventado ningún timeline.** |

## 24 · RIESGOS

| riesgo | mitigación |
|---|---|
| **El nivel mostrado cambia de 1 a 11.** Es el cambio más visible de la fase y toca un número. | No es un cálculo nuevo: es la función del dominio que el armazón ya usaba. El número que se veía antes era el de una columna que nadie escribe. Documentado con la evidencia en §10 y como deuda D1. |
| **Las pestañas de `/ranking` cambian de forma** (cápsula → chaflán). | Mismo estado, mismos textos, misma navegación; ahora con `role="tab"`. Verificado con capturas de las tres pestañas en 390 y 1440. |
| **El `<select>` nativo desaparece.** Quien lo usara con teclado tenía el comportamiento del sistema operativo. | Los botones son focalizables, tienen `aria-pressed` y foco visible; el carril se desplaza. Mismo estado, misma lista. |
| **`RankBadge` es compartido** entre `/ranking` y `/recompensas`. | El único cambio es la altura de su acción (36 → 44). Verificado en las dos rutas. |
| Árbol de trabajo con mucho sin commitear de fases anteriores. | **Sin commit y sin despliegue**, y sin tocar nada fuera de los siete ficheros de §22. |

## 25 · REGRESIONES

**Ninguna detectada.**

- **Progresión**: `progression:verify` PASA · `battlepass:verify` todas — igual que antes.
- **Duelos** (Fase 8): `duel:e2e` ✅, `duel:playtest` 0 errores, `ux:scroll` 38/38, a11y 14/14.
- **Torneos y Pick'ems** (Fase 9): `test:pickems` ✅, `loop:verify` ✅.
- **Entrenador** (Fase 10): `trainer:verify` 35/35, `maps:verify` 14/14, `strats:verify` PASA.
- **Navegación global**: `audit:stability` 105 comprobaciones, P0/P1/P2 a cero.
- **Recorrido completo**: `test:flow` ✅ 22 pasos.
- **Otras pantallas**: `ux:verify` da los mismos 4 fallos preexistentes, ni uno más.

## 26 · VEREDICTO

| criterio de cierre | |
|---|---|
| Perfil tiene identidad propia | ✅ ficha con emblema, cosméticos y vitrina |
| Identidad protagonista | ✅ H1 de 52 px frente a H2 de 10 |
| Rango comprensible | ✅ emblema + palabra + cifra + barra |
| Nivel comprensible | ✅ y **coherente con el armazón** por primera vez |
| XP comprensible | ✅ «219 / 656 XP para el nivel 12» |
| Progresión visible | ✅ 2 barras en la ficha, 19 en logros |
| Logros con jerarquía | ✅ (ya la tenían) |
| Objetivos claros | ✅ por cadencia, con progreso y recompensa |
| Pase conectado | ✅ en `/logros`, con `PassRail` |
| Colección no se duplica | ✅ una cifra y cuatro cartas |
| Estadísticas no dominan | ✅ tira de contexto sobre la ficha |
| Responsive funciona | ✅ seis resoluciones |
| 390×844 funciona | ✅ |
| Sin overflow-X | ✅ 0 en las seis |
| **0 controles < 44 px** | ✅ de la sección Progreso |
| Accesibilidad auditada | ✅ 32/32 con nombre y foco; 0 → 2 barras con semántica |
| Reduced-motion auditado | ✅ mismo texto, mismas barras, mismos controles |
| Performance auditada | ✅ 0 bucles infinitos |
| 0 errores de consola | ⚠️ **12 en `/cuenta`, preexistentes y de contenido** (deuda D2) |
| Tests, typecheck y build verdes | ✅ |
| QA visual completo | ✅ 106 capturas |
| Regresiones comprobadas | ✅ |
| Deudas documentadas | ✅ 8 |
| **Dominio intacto** | ✅ §6 |

**FASE 11 — CERRADA.**
