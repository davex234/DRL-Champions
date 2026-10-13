# Fase 20 — Catálogo real de packs + artwork definitivo

## ESTADO

**PARTIAL** — y el motivo es uno, concreto y declarado: **el artwork definitivo no existe**.

Todo lo demás está cerrado: el catálogo de productos está definido y conectado, los cuatro
Team Packs funcionan con pools reales y sesgo medido, cada familia tiene identidad visual
propia, la tienda presenta el pack como protagonista y la apertura de la Fase 19 sigue intacta.

Lo que falta son **16 ficheros de imagen**. El sistema está preparado para recibirlos (slot,
convención, manifiesto y especificación escrita) y **no se han generado imágenes provisionales
a propósito**: el §7 prohíbe introducir marcadores de posición que parezcan definitivos, y una
imagen hecha al vuelo pasando por arte aprobado es exactamente eso. Marcar READY con 16
placeholders habría sido mentir sobre el estado.

No se ha reabierto la Fase 19. No se ha tocado economía, ledger, idempotencia, mints, seriales,
`user_cards`, weighted distribution, pity, anti-duplicate, duel engine, PvP, matchmaking,
rating, telemetría ni analytics. **No se ha hecho commit, ni push, ni deploy.**

---

## PACKS IMPLEMENTADOS

16 productos. Ninguno inventado: los 12 que ya existían + 4 de equipo con plantilla real.

| Pack | Tipo | Pool | Artwork | Disponible | Estado |
|---|---|---|---|---|---|
| `inicial` | Bienvenida | `pack-inicial` (772) | pendiente | Gratis, tienda | ✅ |
| `estandar` | Nexus (base) | `pack-estandar` (772) | pendiente | 750, tienda | ✅ |
| `premium` | Nexus (premium) | `pack-premium` (772) | pendiente | 2.500, tienda | ✅ |
| `emea` | Regional | `pack-emea` (204) | pendiente | 3.000, tienda | ✅ |
| `americas` | Regional | `pack-americas` (182) | pendiente | 3.000, tienda | ✅ |
| `pacific` | Regional | `pack-pacific` (197) | pendiente | 3.000, tienda | ✅ |
| `china` | Regional | `pack-china` (189) | pendiente | 3.000, tienda | ✅ |
| **`team-heretics`** | **Equipo** | `pack-team-heretics` (204) + **`boost-team-heretics`** (11 @ 5) | pendiente | 3.000, tienda | ✅ **nuevo** |
| **`team-fnatic`** | **Equipo** | `pack-team-fnatic` (204) + **`boost-team-fnatic`** (25 @ 5) | pendiente | 3.000, tienda | ✅ **nuevo** |
| **`team-navi`** | **Equipo** | `pack-team-navi` (204) + **`boost-team-navi`** (16 @ 5) | pendiente | 3.000, tienda | ✅ **nuevo** |
| **`team-g2`** | **Equipo** | `pack-team-g2` (182) + **`boost-team-g2`** (10 @ 5) | pendiente | 3.000, tienda | ✅ **nuevo** |
| `masters` | Evento | `pack-masters` (744) | pendiente | Centro de Eventos | ✅ |
| `champions` | Evento | `pack-champions` (744) | pendiente | Centro de Eventos | ✅ |
| `ewc` | Evento | `pack-ewc` (744) | pendiente | Centro de Eventos | ✅ |
| `icon` | Icono | `pack-icon` (772) | pendiente | 20.000, tienda | ✅ |
| `prime` | Nexus (elite) | `pack-prime` (772) | pendiente | **retirado** (se abre, no se vende) | ✅ |

### NOT READY — lo que no se ha hecho, y por qué

| Pedido en el §2 | Estado | Qué falta exactamente |
|---|---|---|
| **NEXUS** como producto | **Resuelto sin crear nada** | NEXUS es la MARCA de la familia (está en los 16 sobres). El producto base es `estandar`, que ahora pertenece a la familia «Nexus». Crear un 17.º sobre llamado «NEXUS» habría duplicado a `estandar`. |
| **BRONCE / PLATA / ORO** | **NO SON SOBRES** | Son **variantes de carta** (`bronze`/`silver`/`gold`, ranks 1-3), como confirmó la Fase 19. Convertirlas en sobres habría chocado con el dominio. |
| **VCT / EVENT** genérico | **NOT READY — falta el evento** | `data/events.ts` tiene tres eventos REALES (`masters-toronto`, `ewc-2026`, `champions-paris`) y sus tres sobres ya existen y están conectados. **No existe ningún evento «VCT»**: crearlo exigiría inventar un torneo. |
| **TEAM NAVI** | ✅ implementado, con matiz | `data/teams.ts` declara «Natus Vincere» como equipo **sin roster**, pero la plantilla SÍ existe en `players` bajo la etiqueta `NAVI` (8 jugadores, 16 cartas). Se usa el dato real. |
| Más Team Packs | **Disponibles, no creados** | Hay **29 equipos** con ≥5 jugadores y ≥2 rarezas. Los mejores candidatos por riqueza de catálogo son **EDward Gaming** (21 cartas), **NRG** (17) y **MIBR** (14, con 2 legendarias). Crear más es una decisión de producto, no un problema técnico. |

---

## CAMBIOS

### Archivos creados (6)

| Fichero | Para qué |
|---|---|
| `src/components/packs/PackSigil.tsx` | Los **seis símbolos** de la familia, un trazado por categoría |
| `src/data/packArtwork.ts` | El **slot** de artwork de sobre: convención de ruta + manifiesto de lo entregado |
| `public/packs/README.md` | Especificación del asset (formato, medidas, alfa, zona segura) + inventario de los 16 pendientes + dirección de arte |
| `scripts/content-pools-boost.ts` | Provisión de los pools de sesgo por equipo (`npm run content-pools:boost`) |
| `scripts/_fase20-calibrate.ts` | Instrumento: calibración medida del peso del sesgo |
| `scripts/_fase20-qa.ts` | Instrumento: QA real del catálogo, la identidad y la apertura |
| `scripts/_fase20-audit.ts` | Instrumento: auditoría de equipos y cartas reales por equipo |

### Archivos modificados (11)

| Fichero | Qué cambió |
|---|---|
| `src/data/packs.ts` | **+4 Team Packs** con datos reales y economía heredada del producto regional |
| `src/domain/packs/types.ts` | **+1 campo opcional**: `PackDef.team` (presentación; el motor no lo lee) |
| `src/components/packs/packIdentity.ts` | Evolucionado a capa de identidad de PRODUCTO: categoría, símbolo, monograma, artwork + el material de la Fase 19 |
| `src/components/packs/SealedPack.tsx` | Consume `PackSigil` + slot de artwork + rótulo de categoría; id de degradado único por instancia |
| `src/components/shop/ShopRail.tsx` | Carril **agrupado por familia** |
| `src/components/shop/ShopHero.tsx` | Insignia de familia + **nota honesta del Team Pack** (cartas reales del equipo y «no están garantizadas») |
| `src/app/tienda/page.tsx` | Rejilla de 3 celdas: la banda de evento sube junto a la vitrina (mata 200 px de negro muerto) |
| `src/data/packStats.ts` | **REGENERADO** con `economy:model --emit`: 15 sobres de pago medidos con el motor real |
| `src/components/packs/packs.test.tsx` | 4 tests actualizados al contrato nuevo + **8 tests nuevos** de catálogo/identidad/equipo |
| `scripts/content-pools-migrate.ts` | **Bug corregido**: no era idempotente (ver BUGS) |
| `scripts/content-pools-verify.ts`, `scripts/content-catalog-verify.ts` | Invariante acotado a los pools uniformes + **verificación nueva del sesgo** (ver BUGS) |

### Componentes reutilizados (sin duplicar)

`openPack` · `PackEngine` · `Minter` · `pickWeighted` · `buildPool` · `composeDistribution` ·
`serverDistribution` · `content_pools`/`content_pool_entries`/`content_pack_pools` · las cuatro
RPC de pools · `app_content_distribution_snapshot` · `PackOpeningExperience` · `PackHand` ·
`CardBack` · `CardReveal` · `ceremony` · `CardVisual`/`useArtworkStore` · `Card3D` ·
`PlayerCard` · `Stage`/`Plate`/`Recessed`/`Badge`/`Readout`/`NxButton`/`SectionTitle` ·
`design/tokens` · `design/motion` · `data/teams` · `data/events` · `packStats` ·
`domain/packs/guidance` · `economy:model` · `content-pools:migrate`.

**Ni un sistema paralelo. Ni un `V2`. Ni un `if (packId === …)`** — hay un test que lo
comprueba sobre las cinco piezas que dibujan el producto, con los 16 ids reales.

---

## DATOS

| Magnitud | Valor |
|---|---|
| Sobres en el catálogo | **16** (12 previos + 4 de equipo) |
| Sobres de pago con estadística medida | **15** |
| Pools | **20** (16 base `EXPLICIT` + 4 de sesgo `RULE`) |
| Vínculos pack→pool | **20** |
| Entradas de pool | **7.720** |
| Familias de producto | **6** (Bienvenida, Nexus, Regional, Equipo, Evento, Icono) |
| Símbolos distintos | **6**, todos sobre el mismo marco hexagonal |
| Artwork entregado | **0 de 16** (pendiente, especificado) |
| Cartas reales del catálogo | 772, de 379 jugadores |

**Datos reales utilizados:** plantillas y cartas de `players`/`content_cards` (Team Heretics 11
cartas, Fnatic 25, NAVI 16, G2 10), siglas de `data/teams.ts`, colores de marca de Fnatic y
NAVI de `data/teams.ts`, eventos de `data/events.ts`, y el reparto de rareza **medido** con el
motor de sorteo. Ni un jugador, equipo, evento, pool o probabilidad inventados.

---

## QA

| Gate | Resultado |
|---|---|
| `npm test` | **853/853 ✓** (31 en `packs.test.tsx`) |
| `npx tsc --noEmit` (app + scripts) | **limpio** |
| `npm run build` | **✓ Compiled successfully**, `/abrir/[packId]` prerenderiza los **16** sobres |
| `npm run security:verify` | **TODAS PASAN** |
| `npm run pack:verify` | **TODAS PASAN** (10 M decisiones, escala lineal) |
| `npm run content-pools:verify` | **76 ✓ / 0 ✗** — incluye las 8 comprobaciones nuevas del sesgo |
| `npm run content-catalog:verify` | **62 ✓ / 0 ✗** |
| `npm run content:verify` | **EL CONTENIDO ES COHERENTE** |
| `npm run catalog-builder:verify` | **44/44** |
| `npm run publisher:verify` | **32/32** |
| `npm run distribution:verify` | **30 ✓ / 0 ✗** |
| `npm run ux:verify` | **PASA** |
| `eslint` (packs, shop, tienda, packArtwork) | **limpio** |
| `npm run runtime-review:verify` | **37/40** — 3 fallos **preexistentes y demostrados** (ver BUGS) |
| `npm run economy:verify` | inestable, preexistente (documentado en la Fase 19) |
| **QA REAL de apertura** (`_fase20-qa.ts`) | **49/49 ✓** · 23 capturas |

### QA responsive (390 / 768 / 1024 / 1440)

Sin desbordamiento horizontal en la tienda ni en la vitrina, y sin desbordamiento ni scroll en
la apertura, en los cuatro anchos. Los CTA de la vitrina llegan a 44 px en los cuatro.

> Se informa, sin exigirlo: las filas del carril miden 40 px de alto **por diseño** (es una
> lista densa de selección de 16 productos, no una acción), igual que «Inicio» y «Tu nivel» del
> cromo. El suelo de 44 px se exige a los CTA, que es donde se decide y se paga.

### QA real de apertura — los cuatro productos que pide el §19

`inicial` (gratis) · `estandar` (NEXUS base) · `champions` (evento) · `team-fnatic` (equipo).
Para cada uno: tienda → selección → identidad → precio → saldo → **compra real** → apertura →
5 cartas → reveal → resultado → «abrir otro sobre». Sin mocks.

**El sesgo de equipo, medido en aperturas REALES** (8 sobres de Fnatic abiertos pulsando el
botón, 40 cartas, contadas contra `user_cards`):

```
43 % de las cartas obtenidas fueron de Fnatic   (sin sesgo: ~25 %)
23 de 40 cartas fueron de OTROS equipos          → no es una garantía
```

Coincide con la medición del motor (43,2 %) y con la calibración previa (2,12 cartas/sobre).

**«Abrir otro sobre» mantiene el contexto** (§16): desde `team-fnatic`, el botón reinicia la
ceremonia en `/abrir/team-fnatic` y la escena vuelve a enseñar «SOBRE FNATIC». No redirige al
inventario.

---

## BUGS

### Encontrados y corregidos (4)

1. **`content-pools:migrate` no era idempotente.** `app_content_pool_publish` rechaza
   `ACTIVE → ACTIVE` (es una máquina de estados, y con razón), pero el script publicaba
   SIEMPRE: en cuanto existía un pool activo, volver a ejecutarlo abortaba en el primero — y
   con él **la única vía de provisionar el pool de un sobre nuevo**. Corregido leyendo el
   lifecycle antes de publicar, en el script y no relajando la guarda de la base de datos.
2. **El invariante «con pools == sin pools» ya no podía valer para todo.** Era la condición de
   éxito de la migración 8.3 y los Team Packs lo rompen **a propósito** (un pool de sesgo
   existe para que salga otra carta). Relajarlo para todos habría tirado la red que protege a
   los otros doce sobres. Se ha **partido en dos** en `content-pools:verify` y
   `content-catalog:verify`: obligatorio en los pools UNIFORMES (detectado por `uniform`, no
   por una lista de ids) y, para los ponderados, **sustituido por algo más fuerte** — que el
   sesgo exista, vaya en la dirección correcta y **no sea una garantía**.
3. **`<defs>` con id compartido.** `SealedPack` emitía siempre `id="nxpack"`; la tienda dibuja
   16 sobres a la vez y dos degradados con el mismo id se pisan (gana el primero del documento
   y los demás heredan su color). Corregido con `useId()` por instancia.
4. **200 px de negro muerto en la tienda.** Con 16 sobres el carril pasó a ser más alto que la
   vitrina. Corregido colocando la banda de evento bajo la vitrina — y el primer intento
   **no funcionó**: un `row-span-2` reparte su altura entre las dos filas e infla la primera.
   Hizo falta `grid-rows-[auto_1fr]` para que el sobrante lo absorba la fila de abajo.

### Pendientes (no corregidos, con atribución demostrada)

1. **`runtime-review:verify` 37/40.** Los tres fallos tienen **una sola causa y es anterior a
   esta fase**: la generación emite **1 carta** donde el propio test dice que el Masters London
   real emite 112, y esa única carta es `zekken__mythic`.

   *Demostración de que esta fase no puede haberlo causado:* el check exige
   `eligibility.packs.length > 0`, y `packs` solo se rellena si `market.inPacks` es cierto
   (`card-generator/eligibility.ts:28`). `decideMarket` devuelve `inPacks: false` para toda
   familia `SPECIAL`, y `mythic` está en esa lista (`live/market.ts:20-27`). Con una sola carta
   mythic, `eligibleNew` es 0 **con 12 sobres y con 16**: añadir sobres solo puede ALARGAR esa
   lista, nunca vaciarla. Los otros dos fallos («los filtros por región ven a los jugadores
   nuevos», «EMEA 204 → 204») son la misma ausencia de altas.

2. **`economy:verify` inestable** en `mis listados incluyen los cerrados` (§8 MERCADO ·
   LECTURAS). Ya documentado en la Fase 19; es mercado, no sobres.

---

## DEUDAS

1. **Artwork de sobre: 0 de 16 entregados.** Es la razón del estado PARTIAL. El hueco, la
   convención (`public/packs/pack-<packId>.webp`, 780 × 1140, alfa), el manifiesto y la
   dirección de arte están escritos en `public/packs/README.md`. Activar uno son dos gestos:
   dejar el fichero y añadir su id a `PACK_ART_AVAILABLE`.
2. **`Player.team` no es homogéneo.** Unos equipos se guardan con el nombre completo («Team
   Heretics», «Fnatic») y otros con su etiqueta («NAVI», «G2», «TS», «AG»), así que
   `getTeam("NAVI")` no encuentra nada: su clave en `data/teams.ts` es «Natus Vincere».
   `teamMonogram` lo absorbe con un respaldo, pero homogeneizarlo tocaría el catálogo de
   jugadores y esta fase no lo abre. **Consecuencia hoy:** los Team Packs de NAVI y G2 no
   pueden leer el color de marca del registro, y su acento se ha elegido a mano.
3. **`public/teams/` y `public/players/` están vacíos** (solo un README). Cada escudo y cada
   foto devuelven 404 desde antes de esta fase; el dibujado por capas los cubre con monograma y
   silueta, que es su diseño. Es la razón de que los Team Packs usen un monograma tipográfico
   en el troquel y no el logo del equipo.
4. **NAVI y G2 solo tienen comunes y poco comunes.** Su sesgo no puede alcanzar a rara/épica/
   legendaria, y en esas rarezas el sobre reparte como un regional. **La tienda lo dice** —la
   nota del Team Pack enseña el desglose real y avisa de las rarezas ausentes— pero es una
   asimetría de producto que conviene conocer.
5. **Fnatic llega al 94,8 % de P(≥1 carta del equipo).** No es una garantía y el motor produce
   sobres sin ninguna, pero está cerca. La causa es el CATÁLOGO, no el sesgo: Fnatic tiene 25
   de las 204 cartas EMEA y **sin ningún sesgo ya daría 1,20 cartas por sobre**. Si se quiere
   bajar, la palanca honesta es el peso de su pool (hoy 5, el mismo para los cuatro).
6. **`PackStoreCard` sigue duplicando a `ShopHero`** en `/eventos`. Heredado de la Fase 19.
7. **`npm run lint` roto** bajo Next 16. Heredado de la Fase 19.

---

## DECISIONES

Las desviaciones respecto al prompt, y su por qué.

1. **El precio y los pesos de los Team Packs no se han inventado: se han HEREDADO del producto
   regional** (3.000 créditos, 5 cartas, 35/40/18/6/1). Un Team Pack es un sobre *dirigido*, la
   misma clase de producto que los cuatro regionales, y `restrictRegion` es la región real de
   la plantilla: el sobre renuncia a las otras tres regiones, y eso es lo que se paga por la
   puntería. **La medición lo confirma**: `packStats` regenerado da a los cuatro Team Packs
   EXACTAMENTE el reparto del regional (0,3521 / 0,3999 / 0,1782 / 0,0597 / 0,0101), porque el
   sesgo cambia *qué* carta sale dentro de un bucket, nunca las probabilidades del bucket. La
   economía del catálogo no se ha movido. *Aun así, el precio final es una decisión de producto
   que puedes cambiar: el número es defendible, no sagrado.*

2. **El peso del sesgo (5) está medido, no elegido.** `_fase20-calibrate.ts`, 4.000 aperturas
   por equipo con el motor real, buscando el objetivo explicable «≈1 carta del equipo por
   sobre»: Heretics 1,13 (P 72 %), NAVI 1,20 (74 %), G2 0,91 (63 %), Fnatic 2,12 (94 %). Se ha
   preferido **un solo peso para los cuatro** antes que afinar uno por sobre: una tabla de
   pesos por producto se lee como arbitraria y habría que justificar cada número.

3. **Pool `RULE`, no `EXPLICIT`.** Es la decisión técnica central. Un pool `EXPLICIT` habría
   restringido la pertenencia y el sobre entregaría **solo** cartas del equipo: una garantía
   disfrazada de pool, justo lo que el §11 prohíbe. `RULE` repondera sin restringir
   (`composeDistribution` solo fija `members` en `EXPLICIT`/`MIXED`), y hay dos comprobaciones
   nuevas que lo vigilan por su efecto medible, no leyendo el código.

4. **No se ha creado un sobre «NEXUS».** NEXUS es la marca de la familia y está en los 16
   sobres; el producto base es `estandar`, que ahora pertenece a la familia «Nexus». Un 17.º
   sobre llamado NEXUS habría sido un duplicado de `estandar` con otro nombre.

5. **La categoría se DERIVA, no se declara.** Sale de campos que el catálogo ya tiene
   (`team` → `eventId` → `guaranteedMin` → `price` → `restrictRegion`), en ese orden de
   especificidad. Un sobre nuevo obtiene identidad el día que entra en el catálogo sin tocar
   una línea. El único campo añadido es `PackDef.team`, y es un DATO de presentación: hay un
   test que demuestra que quitarlo **no cambia el pool** que deduce el motor.

6. **El manifiesto de artwork en vez de `onError`.** `CardFace` puede intentar la imagen y caer
   al dibujado porque su URL viene de la base de datos: si está, existe. Aquí la ruta se deriva
   del `packId`, así que intentarla sin más serían 16 respuestas 404 en cada pintada de la
   tienda. El manifiesto declara lo que ha llegado de verdad — y el QA comprueba que hoy no se
   pide **ni una** imagen de sobre.

7. **El arte procedimental no es un placeholder.** Es el objeto que el juego enseña hoy, con
   símbolo por familia y material por escalón, y seguirá siendo el respaldo cuando lleguen los
   ficheros. Por eso el estado es PARTIAL y no BLOCKED: la tienda es usable y los productos se
   distinguen sin una sola imagen.

---

## CRITERIO DE CIERRE, contrastado

| # | Criterio | Estado |
|---|---|---|
| 1 | Catálogo correctamente definido | ✅ 16 productos, 6 familias derivadas |
| 2 | Packs reales bien representados | ✅ los 12 previos intactos + 4 con datos reales |
| 3 | Variantes de carta ≠ sobres | ✅ bronce/plata/oro siguen siendo variantes; documentado |
| 4 | Packs especiales por pools, no `if/else` | ✅ pools `RULE` persistidos; test sobre 5 piezas y 16 ids |
| 5 | La tienda muestra el pack como protagonista | ✅ vitrina con entrada animada, carril agrupado |
| 6 | Cada pack con identidad visual propia | ✅ 6 símbolos + 4 escalones de material |
| 7 | Assets correctamente integrados | ⚠️ **el slot sí; los ficheros no existen** |
| 8 | La apertura de la Fase 19 sigue funcionando | ✅ 4 productos abiertos de verdad, 5/5 cartas |
| 9 | «Abrir otro sobre» sigue funcionando | ✅ y mantiene el contexto del sobre |
| 10 | Sin regresión de economía/mints/seriales | ✅ `packStats` medido, `security:verify` verde, 853 tests |
| 11 | Sin overflow en 390/768/1024/1440 | ✅ |
| 12 | Sin datos inventados | ✅ lo que faltaba está marcado NOT READY |
| 13 | Gates existentes verdes | ✅ salvo 3 fallos preexistentes con atribución demostrada |
| 14 | Pendientes documentados con honestidad | ✅ 7 deudas |

**FASE 20 — PARTIAL: cerrada en catálogo, identidad y pools; abierta en artwork.**

Con los 16 ficheros en `public/packs/` y sus ids en `PACK_ART_AVAILABLE`, pasa a READY sin
tocar código.
