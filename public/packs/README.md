# Artwork de sobres — especificación e inventario

Esta carpeta contiene el artwork definitivo de **cada sobre** del catálogo. Un fichero por
producto: **no** una lámina con todos, **no** un collage, **no** capturas de pantalla.

> El artwork de los SOBRES y el de las CARTAS son dos sistemas distintos y no se mezclan. El de
> las cartas va por ejemplar (`assets` en la base de datos, resuelto por `card_id` +
> `minted_version` y servido a `CardVisual`). Un sobre no se acuña, no tiene ejemplares y no
> tiene versiones por jugador: es el envase del producto, y vive aquí como fichero estático.

---

## Convención

```
public/packs/pack-<packId>.webp
```

El `packId` es el del catálogo (`src/data/packs.ts`), tal cual. Ejemplos:
`pack-estandar.webp`, `pack-champions.webp`, `pack-team-heretics.webp`.

| Propiedad | Valor | Por qué |
|---|---|---|
| Formato | **WEBP** | Es el formato que ya usa el pipeline de cartas; mejor peso que PNG con la misma calidad. |
| Dimensiones | **780 × 1140 px** | 3× el objeto a tamaño de ceremonia (260 × 380). Proporción **13:19**, la que ya dibuja `SealedPack`. |
| Fondo | **Transparente (alfa obligatorio)** | El sobre se compone sobre el escenario negro de la apertura Y sobre la vitrina de la tienda, que no comparten fondo. Un fondo opaco recortaría un rectángulo visible en las dos. |
| Contenido | Solo la **cara impresa** del sobre | La costura, la solapa que se levanta y la carga del corte son ESTRUCTURA: las dibuja el componente y son lo que hace que el sobre se abra. Un artwork que trajera su propia solapa obligaría a recortar cada fichero por la costura. |
| Zona segura | 24 px por lado | La banda inferior con el nombre del producto se pinta encima, siempre, por legibilidad y accesibilidad. |

## Cómo se activa un artwork

Dos gestos, y el segundo es obligatorio:

1. Dejar el fichero en esta carpeta con el nombre de la convención.
2. Añadir su `packId` a `PACK_ART_AVAILABLE` en **`src/data/packArtwork.ts`**.

Mientras un `packId` no esté en ese conjunto, su sobre se dibuja con el arte **procedimental**
(troquel por categoría + material por escalón). Eso no es un marcador de posición: es el objeto
que el juego enseña hoy.

**Por qué hace falta declararlo y no basta con dejar el fichero:** la ruta se deriva del
`packId`, así que intentar la imagen sin más pediría al navegador los ficheros que todavía no
existen — una respuesta 404 por sobre en cada pintada de la tienda. El manifiesto es la
declaración explícita de lo que ha llegado de verdad.

---

## Cómo se producen

**Desde 2026-09-22 hay dos orígenes.** Diez sobres llevan **arte oficial** entregado por el
equipo de arte; el resto sigue saliendo del master vectorial.

### 1. Arte oficial (10 ficheros)

```
npx tsx scripts/pack-art-import.ts            los diez
npx tsx scripts/pack-art-import.ts --only=champions
```

Los originales viven en `sobres/*.png` (1024 × 1536, **con fondo**: negro plano, gris claro o el
propio resplandor del sobre) y **no se tocan**. El importador hace tres cosas y ninguna de ellas
redibuja nada:

1. **Recorta el fondo** por color y CONECTIVIDAD con el borde de la lámina, con un umbral que se
   ajusta al ruido del propio fondo. La conectividad es lo que impide que el negro de DENTRO del
   sobre (la cara de Champions, el foil de Icon) se vacíe por parecerse al fondo; además se
   protege un núcleo interior erosionado para que el relleno no se cuele por un corredor oscuro.
2. **Desvanece los halos**: dentro de la región de fondo el alfa sube con la distancia al color
   base, así que un resplandor horneado (Gold, Masters) se apaga en vez de cortarse con un filo.
3. **Reencuadra sin deformar**: recorta al contenido y lo centra en el lienzo 780 × 1140; el
   relleno es transparente, la proporción original se respeta.

Verifica lo que escribe: esquinas transparentes, centro opaco y medidas exactas. El contrato lo
fija `src/data/packArtOfficial.test.ts`.

> **El render procedimental ya NO los pisa.** `pack-art:render` salta los `packId` del importador
> (`IMPORT_MAP`) y lo dice por pantalla. `--force` los devuelve al arte dibujado, a propósito.

### 2. Master vectorial (el resto)

Los demás assets de esta carpeta **están generados desde un master vectorial**, no dibujados uno a
uno:

```
npm run pack-art:render                     los 20
npm run pack-art:render -- --only=champions  uno
npm run pack-art:render -- --svg             deja también el SVG fuente al lado
```

- **El diseño maestro** vive en `scripts/pack-art/master.ts`: silueta, sellado, foil, biseles,
  emblemas, tipografía e iluminación, parametrizados. Un producto es una ENTRADA DE DATOS.
- **El catálogo de assets** vive en `scripts/pack-art-render.ts`.
- El render comprueba cada fichero al escribirlo: alfa real, chaflán recortado y centro opaco.

**Tipografía:** el wordmark se compone con **Bahnschrift** —tercera opción del propio
`--font-display` del proyecto— porque Rajdhani no está instalada en la máquina de render. Para
el render definitivo: instalar Rajdhani y volver a ejecutar el comando. Es una constante
(`DISPLAY_FONT`), no un cambio de diseño.

---

## Inventario: 22 entregados (17 con arte oficial)

Los **16 productos del catálogo** tienen su artwork, y `PACK_ART_AVAILABLE` los declara: la
tienda y la ceremonia ya pintan el fichero. Además hay **4 assets de productos que todavía no
existen** en el catálogo (esperan decisión de producto y economía; ver Pendientes).

| Fichero | Producto | Familia | Emblema | Estado |
|---|---|---|---|---|
| `pack-inicial.webp` | Sobre Inicial | Bienvenida | — | 🎨 **arte oficial** (`inicial.png`) |
| `pack-estandar.webp` | **Sobre Bronce** | Nexus | — | 🎨 **arte oficial** (`Bronze.png`) · el `packId` sigue siendo `estandar` |
| `pack-premium.webp` | **Sobre Plata** | Nexus | — | 🎨 **arte oficial** (`Plata.png`) · el `packId` sigue siendo `premium` |
| `pack-prime.webp` | Sobre Prime | Nexus | sigilo NEXUS | ✅ integrado (retirado del escaparate) |
| `pack-masters.webp` | Sobre Masters | Evento | — | 🎨 **arte oficial** (`Masters.png`) |
| `pack-champions.webp` | Sobre Champions | Evento | — | 🎨 **arte oficial** (`Champions.png`) |
| `pack-ewc.webp` | Sobre EWC | Evento | — | 🎨 **arte oficial** (`EWC.png`) |
| `pack-icon.webp` | Sobre Icon | Icono | — | 🎨 **arte oficial** (`Icono.png`) |
| `pack-emea.webp` | Sobre EMEA | Regional | — | 🎨 **arte oficial** (`Emea.png`) |
| `pack-americas.webp` | Sobre Americas | Regional | — | 🎨 **arte oficial** (`Amercias.png`) |
| `pack-pacific.webp` | Sobre Pacific | Regional | — | 🎨 **arte oficial** (`Pacific.png`) |
| `pack-china.webp` | Sobre China | Regional | — | 🎨 **arte oficial** (`China.png`) |
| `pack-team-heretics.webp` | Sobre Team Heretics | Equipo | — | 🎨 **arte oficial** (`TeamHeretics.png`) |
| `pack-team-fnatic.webp` | Sobre Fnatic | Equipo | — | 🎨 **arte oficial** (`FNC.png`) |
| `pack-team-liquid.webp` | Sobre Team Liquid | Equipo | — | 🎨 **arte oficial** (`TL.png`) · ACTIVO 2026-09-22 |
| `pack-team-karmine.webp` | Sobre Karmine Corp | Equipo | — | 🎨 **arte oficial** (`KC.png`) · ACTIVO 2026-09-22 |
| `pack-team-navi.webp` | Sobre NAVI | Equipo | escudo `NAVI` | ⚠️ integrado · producto **RETIRADO** del escaparate (el arte se conserva para el inventario) |
| `pack-team-g2.webp` | Sobre G2 | Equipo | — | 🎨 **arte oficial** (`G2.png`) |
| `pack-oro.webp` | **Sobre Oro** | Nexus | — | 🎨 **arte oficial** (`oro.png`) · producto NUEVO (Packs Base 4.0) |
| `pack-bronce.webp` | — | — | — | ♻️ copia anterior de `Bronze.png`; el fichero vivo es `pack-estandar.webp` |
| `pack-plata.webp` | — | — | — | ♻️ copia anterior de `Plata.png`; el fichero vivo es `pack-premium.webp` |
| `pack-mvps.webp` | — | Reconocimiento | trofeo | 🅿️ asset listo, **sin producto** |

### Pendientes

1. **Logo oficial de equipo — ninguno pendiente.** Los cinco sobres de equipo de la oferta
   (Heretics, Fnatic, G2, Team Liquid y Karmine Corp) ya traen su arte oficial con logo
   (2026-09-22). El troquel de monograma queda para los sobres de equipo que sigan en DRAFT.
2. **20 sobres de equipo más** (T1, Team Liquid, Karmine Corp, Gentle Mates, FUT, Leviatán,
   NRG, 100 Thieves, LOUD, Sentinels, Paper Rex, NongShim, Gen.G, DRX, Global Esports, EDward
   Gaming, TyLoo, Bilibili, Xi Lai, Trace, JD Gaming): **no existen como producto** en
   `data/packs.ts`, y crearlos exige precio y pool — decisión de economía, no de arte. El
   master ya los soporta: son una entrada de datos cada uno.
3. **`pack-mvps.webp` sigue sin producto**: el fichero está listo y con la convención correcta,
   así que en cuanto exista un `packId` igual al nombre se pinta solo.

   Los escalones ICON (BRONZE / SILVER / GOLD) ya SÍ tienen producto desde Packs Base 4.0: son
   la gama base **Bronce → Plata → Oro**. Bronce y Plata son los productos de siempre renombrados
   en sitio, así que su arte vive en el fichero de su `packId` histórico (`pack-estandar.webp` y
   `pack-premium.webp`) y no en `pack-bronce/plata`, que quedan como copia del original. Oro es
   producto nuevo y sí usa `pack-oro.webp`.

## Dirección de arte

El lenguaje es el de NEXUS: premium, esports, tecnológico, oscuro, cinematográfico,
coleccionable. Sigue siendo **un sobre** —no una caja, ni una cápsula, ni un dispositivo— y
debe reconocerse de inmediato como «un sobre NEXUS que contiene cartas».

Lo que el arte procedimental ya establece y conviene respetar:

- **La familia es el hexágono.** Marco hexagonal, trazo monolínea, ángulos de 30°/60°.
- **La categoría cambia el símbolo**, no el marco (ver `PackSigil.tsx`): cuñas enfrentadas
  (Nexus), galón ascendente (Bienvenida), meridiano (Regional), escudo con siglas (Equipo),
  laurel (Evento), medalla (Icono).
- **El escalón cambia el material**, no el símbolo: densidad de foil, anillos del troquel,
  barrido especular y cantoneras.

A evitar: plástico genérico, exceso de reflejos, exceso de oro, rayos, glassmorphism, estética
infantil, y cualquier parecido con Pokémon, FIFA, otros TCG o la interfaz de VALORANT.
