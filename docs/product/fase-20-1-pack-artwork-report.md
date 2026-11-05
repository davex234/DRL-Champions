# Fase 20.1 — Pack artwork definitivo

## ESTADO

**PARTIAL.**

Los **16 productos del catálogo tienen artwork real e integrado**: la tienda y la ceremonia
pintan ficheros WEBP con alfa, no gradientes de CSS. Hay 20 assets producidos en total.

Sigue PARTIAL, y por dos motivos concretos:

1. **No hay logos oficiales de equipo en el proyecto.** `public/teams/` solo contiene un README.
   El §7 prohíbe dibujar un logo falso, así que los cuatro Team Packs llevan el **monograma con
   la etiqueta real** del equipo — el respaldo que ese mismo README declara aprobado — y quedan
   marcados como pendientes del logo.
2. **20 de los 35 sobres pedidos no existen como producto.** Crearlos exige precio y pool, que
   son decisiones de economía; el §16 y el §18 prohíben tocarlas para que aparezca una imagen.

**No se ha usado ninguna herramienta de generación de imágenes porque este entorno no tiene
ninguna.** Se ha seguido literalmente el camino del §14: master vectorial, assets reales,
integración de lo disponible y el resto declarado PENDIENTE. No se ha declarado READY con
imágenes que faltan.

**No hay commit, ni push, ni deploy.**

---

## PACKS TERMINADOS

**20 assets reales**, todos derivados del mismo master.

### Packs de rareza (7 de 7 — FASE B completa)

| Asset | Material | Emblema | Producto |
|---|---|---|---|
| `pack-bronce.webp` | bronce industrial (metal macizo) | sigilo NEXUS · 1 anillo · 1 barra | ⚠️ sin producto |
| `pack-plata.webp` | plata pulida (metal macizo) | sigilo NEXUS · 2 anillos · 2 barras | ⚠️ sin producto |
| `pack-oro.webp` | oro (metal macizo) | sigilo NEXUS · 3 anillos · 3 barras | ⚠️ sin producto |
| `pack-masters.webp` | grafito cálido + naranja | laurel · 2 anillos | ✅ `masters` |
| `pack-champions.webp` | grafito + oro, brillo máximo | laurel · 3 anillos | ✅ `champions` |
| `pack-icon.webp` | grafito + hueso | medalla · 3 anillos | ✅ `icon` |
| `pack-mvps.webp` | grafito + carmesí | trofeo · 2 anillos | ⚠️ sin producto |

### Packs regionales (4 de 4 — FASE C completa)

| Asset | Emblema (construcción propia del globo) | Producto |
|---|---|---|
| `pack-emea.webp` | meridiano y ecuador | ✅ `emea` |
| `pack-americas.webp` | ejes cruzados | ✅ `americas` |
| `pack-pacific.webp` | arcos concéntricos | ✅ `pacific` |
| `pack-china.webp` | retícula de tres husos | ✅ `china` |

Sin banderas ni iconografía nacional (§6). Comparten acento —el cian que los cuatro declaran en
el catálogo— y se distinguen por la construcción del emblema y el tono del metal.

### Productos de la casa (5) y Team Packs (4)

| Asset | Notas | Producto |
|---|---|---|
| `pack-inicial.webp` | galón ascendente, mate | ✅ `inicial` |
| `pack-estandar.webp` | el producto base; acero neutro | ✅ `estandar` |
| `pack-premium.webp` | oro, 2 anillos | ✅ `premium` |
| `pack-prime.webp` | violeta | ✅ `prime` (retirado del escaparate) |
| `pack-ewc.webp` | laurel, cian | ✅ `ewc` |
| `pack-team-heretics.webp` | escudo `TH`, acero claro | ⚠️ `team-heretics` · pendiente logo |
| `pack-team-fnatic.webp` | escudo `FNC`, naranja de marca | ⚠️ `team-fnatic` · pendiente logo |
| `pack-team-navi.webp` | escudo `NAVI`, amarillo de marca | ⚠️ `team-navi` · pendiente logo |
| `pack-team-g2.webp` | escudo `G2`, acero | ⚠️ `team-g2` · pendiente logo |

> `pack-ewc` **no estaba en la lista de 35** y se ha añadido: es un producto vivo del catálogo y
> sin él la banda de eventos habría quedado con dos sobres con arte y uno dibujado. Lo detectó
> un test nuevo que cruza el manifiesto con el catálogo.

---

## PACKS PENDIENTES

### 20 sobres de equipo — NO EXISTEN COMO PRODUCTO

`T1` · `Team Liquid` · `Karmine Corp` · `Gentle Mates` · `FUT` · `Leviatán` · `NRG` ·
`100 Thieves` · `LOUD` · `Sentinels` · `Paper Rex` · `NongShim RedForce` · `Gen.G` · `DRX` ·
`Global Esports` · `EDward Gaming` · `TyLoo` · `Bilibili Gaming` · `Xi Lai Gaming` ·
`Trace Esports` · `JD Gaming`

**Motivo:** ninguno existe en `data/packs.ts`. Darles artwork exige crear el producto, y un
producto necesita precio y pool — economía, que el §16 y el §18 declaran fuera de esta fase. El
master ya los soporta: cada uno es una entrada de datos.

**Además, §19 tenía razón: hay trampas de naming que hay que resolver ANTES de crearlos.**

| Pedido | En el catálogo | Problema |
|---|---|---|
| `Gen.G` | **`Gen.G` Y `GEN`** | **Duplicado real**: dos valores de `Player.team` distintos, 2 y 7 jugadores. Hay que decidir el canónico antes de crear el producto. |
| `Team Liquid` | `TL` | `Player.team` usa la etiqueta; `data/teams.ts` la clave completa. |
| `Karmine Corp` | `KC` | Ídem. |
| `Gentle Mates` | `M8` | Ídem, y su plantilla está repartida entre EMEA y Americas. |
| `Leviatán` | `LEV` | Ídem. |
| `Paper Rex` | `PRX` | Ídem. |
| `100 Thieves` | `100T` | Ídem. |
| `NongShim RedForce` | `NS` | Ídem. |
| `Global Esports` | `GE` | Ídem. |
| `TyLoo` / `Bilibili` / `Xi Lai` / `Trace` / `JD` | `TYL` · `BLG` · `XLG` · `TE` · `JDG` | Ídem. |
| `T1` | **no aparece** | No hay ningún jugador con ese equipo. |

### 4 assets sin producto

`bronce`, `plata`, `oro`, `mvps`: el **fichero está terminado** y con la convención correcta. En
cuanto exista un `packId` con ese nombre se pintan sin tocar código. Crear el producto es
decisión de economía.

### Logo oficial de equipo — 4 sobres

Los cuatro Team Packs existentes están integrados y se ven, pero su troquel es tipográfico.

---

## ASSETS

| Propiedad | Valor |
|---|---|
| Ruta | `public/packs/pack-<packId>.webp` |
| Formato | **WEBP**, `quality 92`, `alphaQuality 100` |
| Resolución | **780 × 1140** (13:19) |
| Transparencia | **sí, alfa real** — verificado por fichero: esquina del chaflán con alfa 0 y centro opaco |
| Peso | 64–168 KB · **2,3 MB** los 20 |
| Fondo | ninguno (§10). Sin sombra proyectada horneada (§11): la luz la pone la interfaz |
| Origen | SVG vectorial autorado → `sharp` (librsvg) a `density 220` |

**Por qué 780 × 1140 y no 750 × 1050:** el §9 manda auditar qué espera el código. `SealedPack`
dibuja el sobre en proporción **13:19** (260 × 380), y 750 × 1050 es 5:7 — la proporción de las
CARTAS, no de los sobres. Se ha respetado la del objeto real (780 × 1140 es 3× exacto) y la
convención de nombre del manifiesto existente (§13), por lo que `ICONO` es `pack-icon.webp`: el
producto se llama `icon`.

### El master

`scripts/pack-art/master.ts` — un diseño parametrizado, no 35 diseños:

- **Silueta**: chaflán arriba-derecha y abajo-izquierda, la misma geometría que `.nx-clip`.
- **Capas**: material de 3 paradas → estriado cepillado → foil diagonal a 115° → luz cenital →
  franja de acento → viñeta → marco interior → zona de sellado con costura perforada → troquel
  → placa inferior → biseles de canto.
- **Emblemas (7)**: sigilo NEXUS, galón, meridiano (4 construcciones), escudo con monograma,
  laurel, medalla, trofeo.
- **Familia**: todos comparten marco, wordmark, placa negra y geometría; cambian material,
  emblema y microdetalles (anillos, barras, código).
- **El emblema NEXUS son los trazados REALES** de `public/branding/icon/icon.svg`.

---

## INTEGRACIÓN

### Archivos creados (4)

| Fichero | Qué es |
|---|---|
| `scripts/pack-art/master.ts` | El MASTER PACK DESIGN parametrizado |
| `scripts/pack-art-render.ts` | Catálogo de assets + render con verificación por fichero |
| `public/packs/*.webp` | **20 assets** |
| `docs/product/fase-20-1-pack-artwork-report.md` | Este informe |

### Archivos modificados (5)

| Fichero | Qué cambió |
|---|---|
| `src/data/packArtwork.ts` | Manifiesto: de 0 a **16 productos declarados** |
| `src/components/packs/SealedPack.tsx` | Con artwork, **apaga su decoración procedimental** (foil, retícula, franja, barrido, cantoneras, banda del nombre y costura) y la solapa pasa a ser el recorte superior del propio asset |
| `src/components/packs/packs.test.tsx` | 4 tests actualizados al contrato nuevo + **3 nuevos** (incluida la red que cruza manifiesto y catálogo) |
| `public/packs/README.md` | Inventario real, cómo se produce, pendientes |
| `package.json` | `pack-art:render` |
| `scripts/_fase20-qa.ts` | Dos comprobaciones invertidas al contrato nuevo |

**No se ha tocado:** pack opening engine, economía, weighted distribution, mints, seriales,
pools, rarity logic, card engine, `packIdentity` (se reutiliza tal cual: el slot de artwork ya
lo exponía desde la Fase 20).

---

## QA

| Gate | Resultado |
|---|---|
| `npm test` | **855/855 ✓** |
| `npx tsc --noEmit` | **limpio** |
| `npm run build` | **✓ Compiled successfully**, 64/64 páginas |
| `npm run security:verify` | **TODAS PASAN** |
| `npm run pack:verify` | **TODAS PASAN** |
| `npm run content-catalog:verify` | **62 ✓ / 0 ✗** |
| `npm run content-pools:verify` | **81 ✓ / 0 ✗** |
| `npm run distribution:verify` | **30 ✓ / 0 ✗** |
| `npm run ux:verify` | **PASA** |
| `eslint` (packs, packArtwork, pack-art) | **limpio** |
| **QA real** (`_fase20-qa.ts`) | **49/49 ✓** |

### Responsive — 390 / 768 / 1024 / 1440

Sin desbordamiento horizontal en tienda ni vitrina, y sin desbordamiento **ni scroll** en la
apertura, en los cuatro anchos. Los CTA de la vitrina llegan a 44 px en los cuatro.

### QA visual real

Capturas en `docs/product/qa/packs-catalogo/` (23) — tienda a los cuatro anchos, vitrina de
rareza / regional / equipo, pack seleccionado y apertura. Comprobado además:

- **16 imágenes de sobre servidas, 0 roturas, 0 respuestas 404** de `/packs/`.
- **Sin errores de JavaScript** en todo el recorrido.
- Apertura real de `inicial`, `estandar`, `champions` y `team-fnatic`: 5/5 cartas cada una, con
  su artwork en escena, y «abrir otro sobre» manteniendo el producto.

---

## PROBLEMAS

### Bugs encontrados y corregidos (6)

1. **El emblema se leía como una pegatina negra** sobre bronce y plata: el escudo tenía un
   fondo casi negro fijo. Ahora se tinta con el material.
2. **La línea de familia era ilegible** («Rareza» en gris claro sobre plata pulida). Ahora usa
   tinta secundaria material-aware, en versalitas y un punto mayor.
3. **Champions salía verde oliva**: la franja de acento al 30 % sumada al tinte dorado
   enturbiaba el cuerpo. Bajada a 16 % y el tinte reducido.
4. **La zona de sellado cortaba el objeto en dos** en los metales (banda casi negra sobre
   bronce). Ahora es una versión oscurecida del propio metal.
5. **El código de la placa desaparecía** en bronce y plata (tinta oscura sobre placa que se
   oscurecía). La placa es ahora negra en los siete materiales — y de paso es la constante que
   más une la familia.
6. **Doble objeto perfilado** al integrar: `SealedPack` seguía pintando su foil, sus cantoneras,
   su banda de nombre, su costura y una solapa con borde de acento ENCIMA del asset. Se apaga
   todo y la solapa pasa a ser el recorte superior del propio fichero, invisible hasta que gira.

### Encontrados y NO corregidos (fuera de alcance, documentados)

7. **Los cuatro regionales eran indistinguibles** en el primer render completo: mismo acento y
   mismo emblema — «la misma bolsa cambiando de color» sin ni cambiar el color. **Corregido**
   con cuatro construcciones del globo (es el §6), pero queda anotado porque la causa de fondo
   es que **no hay un color por región en los datos** y no se ha inventado uno.
8. **`ewc` no tenía artwork** y estaba a punto de quedarse dibujado junto a sus hermanos.
   Corregido añadiendo el asset, y **se ha añadido un test** que cruza manifiesto y catálogo
   para que no vuelva a pasar en silencio.
9. **`Gen.G` / `GEN` duplicados** en `Player.team`. Es la deuda de datos que ya señalaba el
   informe de la Fase 20; bloquea crear el Team Pack de Gen.G y **no se ha tocado** porque
   arreglarlo es editar el catálogo de jugadores.
10. **Rajdhani no está instalada** en la máquina de render, así que el wordmark se compone con
    Bahnschrift (tercera opción del propio `--font-display` del proyecto). No se ha vendorizado
    una fuente nueva sin pedirlo. Es una constante: con Rajdhani instalada, re-renderizar
    alinea los assets con la tipografía de la interfaz sin tocar el diseño.

---

## DECISIONES

1. **Vector, no raster generado.** No hay herramienta de generación de imágenes en el entorno
   (comprobado, no supuesto). El §14 prevé exactamente este caso y manda el master vectorial:
   los assets son SVG autorado → WEBP con alfa. No son CSS, no son rectángulos y no son
   placeholders; son ficheros de imagen con su silueta recortada, reproducibles y versionables.
2. **El monograma no es un logo falso.** Es la etiqueta REAL del equipo, y es el respaldo que
   `public/teams/README.md` declara aprobado para cuando falta el logo. Aun así quedan marcados
   como pendientes de logo oficial, como pide el §7.
3. **Se han añadido 5 assets que no estaban en la lista de 35** (`inicial`, `estandar`,
   `premium`, `prime`, `ewc`) porque son productos VIVOS. Sin ellos, la vitrina quedaba mitad
   con arte y mitad dibujada, y el §21 pide poder juzgar la familia.
4. **No se ha creado ningún producto nuevo** para que una imagen tuviera dónde aparecer. El
   §18 lo dice y es lo correcto: el artwork y el pool son cosas distintas.
5. **13:19 y no 5:7.** Auditado como pide el §9: es la proporción del objeto que el código ya
   dibuja. 750 × 1050 es la de las cartas.
6. **La placa del nombre va en el asset**, no en la interfaz, y por eso `SealedPack` apaga la
   suya: el §20 pide que el nombre sea legible en el propio asset.

---

**FASE 20.1 — PARTIAL.** 20 assets reales entregados, 16 productos integrados y verificados en
navegador. Para llegar a READY faltan cosas que **no son de arte**: los logos oficiales de
equipo y la decisión de producto/economía sobre los 20 sobres de equipo y los 4 de rareza que
todavía no existen en el catálogo.
