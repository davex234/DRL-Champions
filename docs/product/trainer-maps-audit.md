# AUDIT — INTEGRACIÓN DE LOS 12 MAPAS FINALES EN EL ENTRENADOR

**Fecha:** 2026-09-03 · **Rama:** `arch/stabilization` · **Estado:** auditoría. **Nada modificado.**

Resumen en una línea: **el Entrenador ya tiene casi toda la arquitectura que pides** —dominio
puro, API con saneado en servidor, tabla con RLS y topes, pizarra SVG con arrastre— y lo que
falta es la **capa de imagen**, el **zoom/pan**, las **capas de dibujo** y el **estado por
paso**. No hace falta ninguna arquitectura paralela.

---

## 1 · AUDIT DE LOS ASSETS

Los 12 PNG existen en `mapas/finalizados`. Verificados **en lectura pura** (cabecera IHDR,
firma, chunk IEND final): ninguno se ha abierto para escritura.

| Fichero | Dimensiones | Ratio | Formato | Peso | Íntegro |
|---|---|---|---|---|---|
| `abyss.png` | 1300×1210 | 1,074 | 8 bit RGB | 1,18 MB | ✅ |
| `ascent.png` | 1227×1281 | 0,958 | 8 bit RGB | 0,93 MB | ✅ |
| `bind.png` | 1254×1254 | 1,000 | 8 bit RGB | 1,00 MB | ✅ |
| `breeze.png` | 1272×1236 | 1,029 | 8 bit RGB | 0,99 MB | ✅ |
| `corrode.png` | 1204×1306 | 0,922 | 8 bit RGB | 0,93 MB | ✅ |
| `fracture.png` | 1268×1240 | 1,023 | 8 bit RGB | 1,01 MB | ✅ |
| `haven.png` | 1216×1293 | 0,940 | 8 bit RGB | 0,97 MB | ✅ |
| `icebox.png` | 1206×1304 | 0,925 | 8 bit RGB | 0,95 MB | ✅ |
| `lotus.png` | 1323×1189 | 1,113 | 8 bit RGB | 1,00 MB | ✅ |
| `pearl.png` | 1306×1204 | 1,085 | 8 bit RGB | 1,08 MB | ✅ |
| `split.png` | 1296×1213 | 1,068 | 8 bit RGB | 1,11 MB | ✅ |
| `sunset.png` | 1236×1272 | 0,972 | 8 bit RGB | 1,20 MB | ✅ |

Sin ficheros de más, sin ficheros de menos, ninguno truncado. **Nada que detener.**

Tres cosas que condicionan el diseño:

1. **Ninguno es cuadrado y ninguno mide igual que otro.** Los ratios van de 0,922 a 1,113.
   La pizarra actual usa `viewBox="0 0 100 100"` —cuadrado fijo—, así que pintar el PNG ahí
   **lo deformaría**. La solución no es tocar el asset: es que el catálogo lleve las
   dimensiones reales de cada mapa y el `viewBox` se derive de ellas.
2. **Hay mucho margen oscuro alrededor del trazado.** El dibujo no llena el lienzo. Para
   «ajustar al área disponible» sin recortar el PNG hace falta un **rectángulo de encuadre**
   por mapa, que es un dato del catálogo y **no toca el fichero**.
3. **Los sitios vienen rotulados en el propio PNG** (A/B, y A/B/C en Haven). El catálogo no
   debe volver a dibujarlos encima: solo contarlos.

Estéticamente encajan con NEXUS sin retoques: fondo azul muy oscuro, trazo claro fino,
sitios en oro. Es exactamente el lenguaje de la aplicación.

---

## 2 · AUDIT DEL ENTRENADOR ACTUAL

### 2.1 Rutas

| Ruta | Qué es | Líneas |
|---|---|---|
| `/entrenador` | Vestíbulo del rol, con la ruta de 4 pasos | 357 |
| `/entrenador/equipos` | Plantilla y alineaciones | — |
| `/entrenador/mapas` | Pantalla de ESTUDIO de los mapas | 117 |
| `/entrenador/strats` | **La pizarra**: editor de 3 columnas | 484 |
| `/entrenador/partido` | El simulador de partido | — |

Ya están en el menú (`src/design/nav.ts`, sección «Jugar»): `Entrenador` y `Pizarra`.

### 2.2 Dominio — `src/domain/tactics/`

**`maps.ts`** — el catálogo central que pides **ya existe**:

```ts
export interface TacticalMap { id; name; identity; sites; zones }
export const TACTICAL_MAPS: readonly TacticalMap[] = [TERMINAL, CANTERA, ORBITA, MERIDIANO];
export function getTacticalMap(id: string): TacticalMap | undefined
```

Cuatro mapas **inventados**, dibujados como polígonos SVG sobre una rejilla normalizada
0..100, con zonas tipadas (`spawn`/`site`/`mid`/`corridor`/`choke`), sus colores y sus
etiquetas. Datos puros: sin React, sin red.

**`strat.ts`** — el modelo de estrategia, también puro y serializable:

```ts
interface Strat { id; name; mapId; side; markers[]; steps[]; notes; version }
interface StratMarker { id; kind: "player"|"utility"|"note"; x; y; role?; label; to?; step }
interface StratStep  { id; at; label; notes }
```

Con `emptyStrat`, `moveMarker`, `setMarkerTarget`, `addMarker`, `removeMarker`, `addStep`,
`removeStep`, `validateStrat` y **`sanitizeStrat`** (reconstruye campo a campo lo que llega
de fuera). Topes: `MAX_MARKERS = 40`, `MAX_STEPS = 12`, `TEAM_SIZE = 5`.

### 2.3 API — `/api/game/strats`

`GET` (mis estrategias) · `POST {action:"save"}` · `POST {action:"delete"}`.

Ya cumple lo que pides en seguridad: **`user_id` sale del token**, nunca del cuerpo;
`sanitizeStrat` + `validateStrat` corren **en el servidor** antes de escribir; tope de 40
estrategias; `eq(user_id)` además de RLS; y **vuelve a sanear al salir**, para que una fila
vieja no reviente la pizarra.

### 2.4 Base de datos — `supabase/migrations/0017_strats.sql`

```sql
create table public.user_strats (
  id uuid pk, user_id uuid → auth.users on delete cascade,
  name text (1..60), map_id text (1..40), side text in ('attack','defense'),
  plan jsonb, created_at, updated_at );
```

Con RLS y **cuatro políticas** (select/insert/update/delete, todas `user_id = auth.uid()` en
`using` **y** en `with check`), dos índices, trigger `touch_updated_at` y un trigger
`user_strats_cap` que impone el tope de 40 **en la base**, no solo en la aplicación.

**Estado del dato: 0 estrategias guardadas.** Lo he comprobado. Eso importa mucho — ver §4.1.

### 2.5 Componentes

- **`StrategyBoard.tsx`** (11,5 KB): SVG `viewBox="0 0 100 100"`, polígonos de zona, fichas
  de jugador con color por rol, flechas de movimiento con tirador, arrastre por
  `onPointer*` + `setPointerCapture` y **manejo por teclado** (flechas mueven de 2 en 2).
  No decide nada: recibe un `Strat` y avisa de los cambios.
- **`MapThumb.tsx`**: miniatura del trazado en polígonos, deliberadamente tonta.

### 2.6 Verificación existente

`scripts/strats-verify.ts` — 25 comprobaciones contra la base real: aislamiento entre
usuarios, saneado del servidor, tope impuesto por la base.

### 2.7 Lo que NO se toca (comprobado que está separado)

`src/tactics/` es el **motor táctico del simulador de partido** (planner, opponent, phases,
carriles sobre `sim/map/ascentA`). No tiene nada que ver con la pizarra y no aparece en el
plan. Igual que el motor de cartas, duelos, economía, packs, marketplace, Pick'ems,
recompensas, progresión, importador VLR y catálogo de cartas.

---

## 3 · QUÉ EXISTE / QUÉ FALTA

| Paso que pides | Estado | Nota |
|---|---|---|
| 1 · Auditoría | ✅ | este documento |
| 2 · Integrar assets | ❌ falta | no hay ninguna imagen de mapa en `public/` |
| 3 · Catálogo central | 🟡 existe, hay que ampliarlo | `TACTICAL_MAPS` es ya la fuente única; le faltan `asset`, dimensiones y `available` |
| 4 · Selector visual | 🟡 existe, con miniaturas SVG | hay que cambiarlas por el PNG |
| 5 · Tablero por capas | 🟡 parcial | hay capas SVG, **falta la capa base de imagen** |
| 6 · Zoom y pan | ❌ **no existe** | `viewBox` fijo y cuadrado |
| 7 · Jugadores (5) | ✅ | 5 fichas por rol, arrastre, teclado, tope y validación |
| 8 · Utilidades | 🟡 5 fijas de texto libre | `Humo · Destello · Muro · Recon · Nota`, escritas a mano en la página; sin tipo |
| 9 · Dibujo | ❌ **no existe** | solo la flecha `marker.to`; sin líneas, círculos, rectángulos, zonas ni texto libre |
| 10 · Secuencias | 🟡 existen los pasos | pero **no guardan estado**: cada marcador tiene UNA posición y pertenece a UN paso |
| 11 · Guardado en servidor | ✅ | tabla + API + saneado + RLS + topes |
| 12 · Mis estrategias | 🟡 lista y borrado | falta **duplicar**, y mostrar nº de pasos |
| 13 · Presentación | ❌ **no existe** | no hay modo revisión ni timeline |
| Estética | ✅ | la pizarra ya es HUD oscuro de NEXUS |
| Responsive | 🟡 | el SVG escala, pero sin zoom no se puede trabajar en móvil |
| Seguridad | ✅ | usuario del token, saneado en servidor, RLS, topes en base |

**Traducción:** de trece pasos, cuatro están hechos, seis a medias y tres faltan enteros. Y
ninguno de los que faltan exige tirar nada de lo que hay.

---

## 4 · RIESGOS Y DECISIONES ANTES DE EMPEZAR

### 4.1 No hay nada que migrar — y esto es una buena noticia con fecha de caducidad

`GET /api/game/strats` **descarta** las filas cuyo `plan` no pasa `sanitizeStrat`, y
`sanitizeStrat` devuelve `null` si `getTacticalMap(mapId)` no encuentra el mapa. Es decir:
si el catálogo cambia de ids, **las estrategias guardadas sobre los mapas viejos
desaparecerían de la lista sin decir nada**.

Hoy da igual: **hay 0 estrategias guardadas**. La ventana para reemplazar el catálogo sin
migrar nada es ahora.

### 4.2 Los nombres de los mapas contradicen una regla escrita en el propio código

`src/domain/tactics/maps.ts` y `/entrenador/mapas` documentan, literalmente:

> «Mapas **PROPIOS**. No son reproducciones de los de VALORANT ni de ningún otro juego: ni su
> trazado, ni sus nombres, ni sus callejones. La Fase 9 lo prohíbe explícitamente (§0.6: no
> copiar interfaces, assets, personajes, logos, artwork ni branding ajeno).»

Los 12 assets se llaman `ascent`, `bind`, `breeze`, `fracture`, `haven`, `icebox`, `lotus`,
`pearl`, `split`, `sunset`, `abyss` y `corrode`, que son los nombres de los mapas de
VALORANT. Tú tienes el contexto de dónde salen estos assets y yo no, así que **no lo decido
yo**: lo dejo señalado igual que se señaló la revocación de §29 en la F18, para que el
cambio quede rastreable y no parezca un descuido de alguien que no leyó la regla.

Si me confirmas que siguen adelante, actualizo ese párrafo **en su sitio** —con la
revocación fechada— en vez de borrarlo. Es la decisión **A** de §7.

### 4.3 Los 12 PNG pesan 13 MB

El selector enseña 12 miniaturas. Sin cuidado, abrir el selector descarga los 13 MB enteros.
El proyecto **no usa `next/image`** en ningún sitio (cero ficheros) y la build de escritorio
va con `output: "export"` e `images: { unoptimized: true }`, así que la optimización
automática no está disponible de forma uniforme.

Sin tocar los PNG hay dos salidas, y la primera es gratis:

- **Carga diferida**: `loading="lazy"` + `decoding="async"` en las miniaturas, para que solo
  bajen las que entran en pantalla. Es lo que propongo por defecto.
- **Miniaturas derivadas** (`public/maps/thumbs/*.webp`, ~30 KB cada una): ficheros
  **nuevos**, sin tocar los originales, que se seguirían usando a tamaño completo en el
  tablero. Es más rápido, pero genera assets derivados y tu regla prohíbe «escalar» y
  «convertir». Por eso **no lo hago sin que lo apruebes**: decisión **B** de §7.

### 4.4 Los 12 mapas no traen zonas, y el código las usa

Los 4 mapas actuales tienen polígonos de zona, y de ahí salen tres cosas: la miniatura, la
colocación inicial de los 5 jugadores en su base (`emptyStrat` busca la zona `spawn`) y las
etiquetas del inspector.

Los PNG no traen esa geometría, y **deducirla automáticamente sería redibujar el mapa**.
Propuesta: hacer `zones` **opcional** en el catálogo y que `emptyStrat` caiga en un reparto
por defecto en el borde del bando cuando no las haya. Las zonas se podrán añadir después,
mapa a mapa, como dato de catálogo. Decisión **C** de §7.

### 4.5 El estado por paso cambia el modelo

Pides que **cada paso guarde su estado táctico** (players / utilities / drawings /
annotations). El modelo actual es distinto: un marcador tiene **una** posición y **un**
`step` en el que aparece. No es lo mismo, y no se puede fingir.

Propongo lo que pides literalmente —**una instantánea por paso**—, con el editor sembrando
cada paso nuevo a partir del anterior para que no haya que recolocar nada. Es más JSON, pero
el modelo mental es el que tú describes y es el que se puede explicar en una llamada de
equipo. Requiere `STRAT_VERSION 2` y una función de migración. Decisión **D** de §7.

---

## 5 · ARCHIVOS A MODIFICAR / CREAR

Todo dentro del Entrenador y de sus assets. Nada fuera.

### 5.1 Assets (nuevos)

| Fichero | Qué |
|---|---|
| `public/maps/{id}.png` × 12 | **Copia byte a byte** desde `mapas/finalizados`. Verificada por hash SHA-256 contra el original. |

### 5.2 Catálogo — una sola fuente de verdad

| Fichero | Cambio |
|---|---|
| `src/domain/tactics/maps.ts` | `TacticalMap` gana `asset`, `width`, `height`, `frame` (encuadre) y `available`. Se añaden los 12. `zones` pasa a opcional. |
| `src/lib/assets.ts` | `ASSETS.mapsDir = "/maps"` y `mapImageSrc(id)`, junto a `playerImageSrc`/`teamLogoSrc`. **Ningún componente construye rutas a mano.** |

Correspondencia exacta `id → asset`, tal como la pediste, con nombre visible en español
donde corresponde («Sitios: 2», «Ataque»/«Defensa»; los nombres propios de los mapas no se
traducen, igual que no se traduce el nombre de un equipo).

### 5.3 Tablero por capas

| Fichero | Cambio |
|---|---|
| `src/components/tactics/MapCanvas.tsx` | **Nuevo.** El armazón: `viewBox` derivado de las dimensiones reales del mapa, cámara (zoom/pan), rueda, pinza en táctil, encuadre inicial y conversión pantalla↔mapa. |
| `src/components/tactics/StrategyBoard.tsx` | Pasa a montarse sobre `MapCanvas`. Añade la **capa base `<image>`** con el PNG y ordena las capas: mapa → jugadores → utilidades → dibujos → texto. |
| `src/components/tactics/MapThumb.tsx` | Pinta el PNG (con `loading="lazy"`) en lugar de los polígonos. |
| `src/components/tactics/UtilityGlyph.tsx` | **Nuevo.** Glifos SVG propios para humo, flash, incendiaria, stun, muro, reveal, spike, waypoint y marcador. Dibujados, no emoji — es la decisión que ya tomó `PassRail`. |
| `src/components/tactics/DrawLayer.tsx` | **Nuevo.** Línea, flecha, círculo, rectángulo, zona libre y texto. |

**El PNG se pinta con `<image href>` y `preserveAspectRatio`. No se recorta, no se escala de
forma permanente, no se convierte y no se le aplica ningún filtro.** El zoom y el pan mueven
la cámara del SVG, no la imagen.

### 5.4 Modelo

| Fichero | Cambio |
|---|---|
| `src/domain/tactics/strat.ts` | `STRAT_VERSION → 2`. `Strat` gana `description` y `tags`. `StratStep` gana `state: { players, utilities, drawings, annotations }`. `utility` pasa a tener `kind` tipado. Nuevos topes por paso y un tope de tamaño total. `migrateStrat(v1 → v2)`. `sanitizeStrat` cubre todo lo nuevo. |

### 5.5 API y base de datos

| Fichero | Cambio |
|---|---|
| `src/app/api/game/strats/route.ts` | `action: "duplicate"`. `description`/`tags` en el guardado. Devolver `steps` en el listado. Validar el tamaño del `plan`. |
| `src/lib/tactics/client.ts` | `duplicateStrat(id)`. |
| `supabase/migrations/0028_strats_v2.sql` | **Aditiva y reversible**: `add column if not exists description text`, `tags text[]`, y un `check` de tamaño del `plan`. Sin `DROP`, sin tocar RLS ni los triggers. |

### 5.6 Pantallas

| Fichero | Cambio |
|---|---|
| `src/app/entrenador/strats/page.tsx` | Selector visual de 12 mapas, paleta de herramientas por capas, línea de pasos con anterior/siguiente, guardar/duplicar. |
| `src/app/entrenador/strats/revisar/page.tsx` | **Nuevo.** Modo presentación: mapa grande, paso actual, descripción, ← →, timeline. |
| `src/app/entrenador/mapas/page.tsx` | Estudio de los 12 mapas con el PNG. |
| `src/app/entrenador/page.tsx` | El vestíbulo dice «12 mapas» en vez de «4 trazados propios». |
| `src/design/nav.ts` | Sin cambios: `Pizarra` ya está en el menú. |

### 5.7 Verificación

| Fichero | Cambio |
|---|---|
| `scripts/maps-assets-verify.ts` | **Nuevo.** Los 12 existen en `public/maps`, **hash idéntico al original** (la prueba de que no se han tocado), dimensiones que coinciden con el catálogo, catálogo sin rutas huérfanas y sin rutas escritas a mano fuera de `assets.ts`. |
| `scripts/strats-verify.ts` | Ampliar: v1→v2, duplicar, topes por paso, tamaño del plan, aislamiento entre usuarios sobre el modelo nuevo. |

---

## 6 · PLAN DE IMPLEMENTACIÓN

Siete tramos. Cada uno deja el árbol compilando y verde.

| # | Tramo | Entrega | Verificación |
|---|---|---|---|
| 1 | **Assets + catálogo** | 12 PNG en `public/maps`, catálogo ampliado, `mapImageSrc` | `maps:verify` (hash idéntico), typecheck |
| 2 | **Lienzo con cámara** | `MapCanvas` con zoom, rueda, pan, pinza y encuadre; sin deformar ningún ratio | prueba manual + audit de estabilidad |
| 3 | **Capa base + selector** | El PNG bajo la pizarra; selector de 12 con miniaturas | criterio de éxito hasta «VER MAPA FINAL» |
| 4 | **Modelo v2** | `description`, `tags`, estado por paso, utilidades tipadas, dibujos, `migrateStrat` | tests unitarios de dominio |
| 5 | **Capas de edición** | Jugadores, utilidades tipadas, dibujo, texto | criterio hasta «DIBUJAR FLECHAS» |
| 6 | **Pasos + guardado** | Secuencia con instantánea, migración 0028, API con `duplicate`, «Mis estrategias» completo | `strats:verify` ampliado |
| 7 | **Presentación + responsive** | Modo revisión con timeline; móvil con herramientas plegables y sin desbordamiento | `audit:stability`, prueba en móvil |

El **criterio de éxito completo** que escribiste queda cubierto al final del tramo 7. Al
acabar el 6 ya se puede hacer el recorrido entero salvo «REVISAR PASO A PASO».

---

## 7 · DECISIONES QUE NECESITO DE TI

**A — Los nombres de los mapas** (§4.2). El código declara que los mapas son propios y que
no se usan los de VALORANT. Los assets llevan esos nombres. ¿Confirmas que seguimos, y
actualizo la regla escrita dejando constancia de la revocación?

**B — Miniaturas del selector** (§4.3). ¿Carga diferida del PNG completo (gratis, cero
ficheros nuevos, algo más lento) o genero miniaturas derivadas en `public/maps/thumbs`
(ficheros nuevos, los originales intactos, mucho más ligero)? Por defecto haría la primera.

**C — Los 4 mapas actuales** (`terminal`, `cantera`, `orbita`, `meridiano`). Dijiste que los
12 pasan a ser «los mapas oficiales». ¿Los retiro del catálogo —no hay ninguna estrategia
guardada sobre ellos, así que no se pierde nada— o conviven con los 12?

**D — Estado por paso** (§4.5). Confirmo que hago **una instantánea completa por paso**, tal
como lo describiste, en vez de mantener el modelo actual de «un marcador, una posición, un
paso». Cambia el formato y obliga a `STRAT_VERSION 2`.

**E — Zonas** (§4.4). ¿`zones` opcional por ahora, y las añadimos mapa a mapa más adelante?
Deducirlas de la imagen sería redibujar el mapa, y eso no lo voy a hacer.

---

**Nada modificado. Ningún PNG abierto para escritura. Sin commit, sin push, sin deploy.**
