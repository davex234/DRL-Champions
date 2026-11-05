# DRLCards — inventario de arte para release (F70)

Fecha: 2026-09-28 · Auditoría estática de solo lectura (sin internet). Solo se declara lo que tiene evidencia en el repo; **no se afirma ninguna licencia** que no esté escrita.

## 1. Resumen

`public/` = **500 ficheros, ~52 MB** (462 webp, 19 png, 13 svg, 1 ico, 1 js, 4 md).

| Clase | Grupos | Ficheros en `public/` |
|---|---|---|
| OWNED/CREATED | 7 | 34 (+ audio, dorsos y troqueles generados en código, 0 ficheros) |
| USER_SUPPLIED | 4 | 461 |
| THIRD_PARTY | 1 | 0 (Google Fonts cargado en runtime) |
| UNKNOWN | 0 | 0 |

Resto: `sw.js` (código) y 4 README. `public/players/` y `public/teams/` están vacíos (solo README): el runtime usa silueta/monograma.

## 2. Tabla por grupo

| # | Ruta | Nº | Tamaño | Uso en runtime | Clase | Evidencia |
|---|---|---|---|---|---|---|
| 1 | `public/cards/*.webp` | 331 | ~33 MB | Arte de cada carta (`CardVisual`, colección, sobres, duelo) | USER_SUPPLIED | Catálogo reemplazado por las cartas diseñadas de `Cartas\` (carpeta local del usuario): `docs/product/catalog-replace-report.md`, `scripts/cartas-import.ts`, `docs/product/catalog-replace/NEW_CATALOG_MANIFEST.json`. Representan jugadores profesionales reales y equipo impreso. |
| 2 | `public/agents/<agente>/{face,face-96,full}.webp` (29 agentes de Valorant) | 87 | ~1,7 MB | `AgentArt`/`AgentPortrait` (Entrenador, roster) | USER_SUPPLIED | Importados de `personajes/{cara,entero}` (F59): `docs/product/fase-59-agent-visual-system.md` §1 y l.135 («Estos ficheros los aporta el usuario y se integran por su decisión explícita»; F16/F47 los evitaban por falta de licencia); `docs/product/qa/fase59-agent-visual-system/asset-inventory.json`. |
| 3 | `public/agents/veil/{portrait,avatar}.webp` | 2 | ~56 KB | Agente propio Veil | OWNED/CREATED | Z-Image-Turbo local (Apache-2.0 según el informe): `docs/product/fase-48b-veil-golden-sample-report.md` l.25/65/71; pipeline `docs/product/art/veil/pipeline/`. |
| 4 | `public/maps/*.png` + `public/maps/thumbs/*.webp` (12 mapas de Valorant) | 24 | ~12,5 MB + 140 KB | Capa visual del Entrenador; grafos de navegación generados desde los PNG | USER_SUPPLIED | `docs/product/trainer-maps-report.md` §7: el responsable del producto sustituyó el catálogo el 2026-09-03; «NO afirma nada sobre su titularidad ni sobre licencia alguna: no consta verificada ninguna». |
| 5 | `public/packs/` arte oficial (inicial, estandar, premium, oro, masters, champions, ewc, icon, emea, americas, pacific, china, team-heretics, team-fnatic, team-g2, team-liquid, team-karmine + copias bronce/plata) | 19 | ~4 MB | Tienda y ceremonia de apertura (`packArtwork(packId)`, `PACK_ART_AVAILABLE`) | USER_SUPPLIED | `public/packs/README.md` («arte oficial entregado por el equipo de arte», originales en `sobres/*.png`, `scripts/pack-art-import.ts`). Los 5 de equipo «traen su arte oficial con logo». |
| 6 | `public/packs/` master vectorial (prime, mvps, team-navi) | 3 | ~340 KB | prime/navi retirados del escaparate; mvps sin producto | OWNED/CREATED | `public/packs/README.md` §2 (`scripts/pack-art/master.ts`, `npm run pack-art:render`). Nota: navi lleva «escudo NAVI». |
| 7 | `public/game/arenas/nexus-champions/stage-{1920,960}.webp` | 2 | ~188 KB | Escenario de la arena | OWNED/CREATED | `docs/product/fase-50-nexus-arena-report.md` l.21 (Z-Image-Turbo, semilla 47, «sin texto, logos ni assets de terceros»); `docs/product/qa/fase50/arena-asset-provenance.json`. |
| 8 | `public/store/credits/*.webp` | 6 | ~584 KB | Paquetes de DRL Credits (`/tienda/creditos`) | OWNED/CREATED | Generador procedural `scripts/credits-art/render.ts` (F49.1). |
| 9 | `public/branding/**`, `public/icons/*`, `public/favicon.*`, `favicon-32.png`, `apple-touch-icon.png` | 21 | ~300 KB | Logo, PWA, favicon, OpenGraph | OWNED/CREATED | `public/branding/README.md` (generado por `scripts/generate-brand.ts` desde `src/branding/geometry.ts`). |
| 10 | Audio / música | 0 | — | Web Audio sintetizado (`src/lib/audio/musicEngine.ts`) | OWNED/CREATED | `docs/product/fase-44-1-immersion-world-audio-input-report.md` l.66 (0 ficheros de audio); `docs/product/fase-64-game-feel.md` l.186. |
| 11 | Dorsos de carta, troqueles de sobre procedurales, GameGlyph | 0 | — | SVG/CSS en código | OWNED/CREATED | `docs/product/fase-50-nexus-arena-report.md` l.21 (dorso = CSS + `icon-mono.svg`); `public/packs/README.md` (arte procedimental por defecto). |
| 13 | `public/flags/*.svg` (40: 39 países + `un`) + `LICENSE-flag-icons.txt` | 40 | ~430 KB | Bandera de la carta (`Flag`) y pista de país de las cartas ocultas (F72.3) | THIRD_PARTY (MIT) | flag-icons 7.5.0 (© Panayiotis Lipiridis), copiadas byte a byte del tarball npm verificado; hashes y licencia en `public/flags/README.md`. **Sin dependencia externa en runtime** (antes flagcdn.com). |
| 14 | `public/hints/teams/<canonicalId>.png` | 25 | ~260 KB | Pista de equipo de las cartas ocultas (F72.3) | USER_SUPPLIED | Copiados byte a byte de la biblioteca de trabajo `NEXUSFICHAJES/players/EQUIPOS` (hashes en `public/hints/teams/README.md`). **Integración técnica APROBADA; derechos de marca para release pública SIN RESOLVER.** Los 16 equipos restantes, iconos de rol VALORANT y de liga VCT: NO importados. |
| 12 | Tipografías Rajdhani + Inter | 0 locales | — | `<link>` a fonts.googleapis.com en `src/app/layout.tsx` l.60-63 | THIRD_PARTY | Carga externa en runtime; el repo no documenta su licencia para la app (`docs/product/README.md` solo cubre las fuentes del PDF). |

Fuentes originales fuera de `public/` (no se sirven): `personajes/`, `sobres/`, `Cartas\` en la raíz del repo.

## 3. Pendiente de confirmación legal/licencia

Antes de un **release público** hace falta confirmación de David sobre:

1. **`public/agents/<29 agentes>/`** (87 ficheros): nombres, imagen y semejanza de agentes de VALORANT = PI de Riot Games. Procedencia de `personajes/` no documentada más allá de «los aporta el usuario».
2. **`public/maps/*.png` y `public/maps/thumbs/`** (24): mapas de VALORANT (Riot); titularidad y licencia «no consta verificada ninguna».
3. **`public/cards/*.webp`** (331): imagen/semejanza de jugadores profesionales reales y logos/nombres de equipo impresos; autoría y derechos del diseño de `Cartas\` sin documentar.
4. **`public/packs/pack-team-{heretics,fnatic,g2,liquid,karmine}.webp`** (+ `pack-team-navi.webp`, escudo NAVI): logos/marcas de clubes.
5. **`public/packs/pack-{masters,champions,ewc,emea,americas,pacific,china}.webp`**: marcas de competición (VCT/Riot, EWC) si aparecen en el arte; revisar.
6. **Resto del arte oficial de sobres** (`pack-{inicial,estandar,premium,oro,icon,bronce,plata}.webp`): autoría del «equipo de arte» y cesión de derechos sin documentar.
7. **Uso de nombres de VALORANT / Riot / VCT en textos y datos** (catálogo de agentes `src/domain/tactics/roster.ts`, datos de jugadores/equipos importados de VLR): fuera del alcance de ficheros, pero misma cuestión de PI.
8. **Google Fonts (Rajdhani, Inter)**: confirmar licencia y la carga externa (privacidad) — riesgo bajo.
9. **`public/hints/teams/*.png`** (25 logos de club, F72.3): marcas de cada equipo. La autorización recibida cubre SOLO la integración técnica («ya forman parte de nuestros assets de trabajo»), **no** los derechos de marca para release pública. Procedencia original de la biblioteca NEXUSFICHAJES sin documentar.
10. **Pistas pendientes (no importadas):** logos de los 16 equipos restantes (derechos/fuente pendientes), iconos de rol de VALORANT e iconos de liga VCT (requieren licencia de Riot). Mientras falten, el servidor no elige esas pistas (sin texto ni placeholder).

Sin pendiente: Veil, arena, créditos, branding, audio, dorsos/troqueles procedurales (creados en el proyecto con evidencia; el modelo Z-Image-Turbo figura como Apache-2.0 en el informe F48B).

## 4. Nota

Esto **no bloquea la build técnica** ni la beta cerrada. **Bloquea el PUBLIC RELEASE** hasta que David confirme por escrito los puntos de §3 (o se retiren/sustituyan esos assets; el runtime ya tiene respaldos: silueta, monograma, troquel procedural).
