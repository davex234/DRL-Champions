# FASE 25 — PACKS + CARD EXPERIENCE + COLLECTION GAME LOOP · Sobres, cartas y colección como corazón jugable

**Estado:** completada · **Fecha:** 2026-09-14 · **Rama:** `arch/stabilization` · **Sin commit/push/deploy** · **Sin VPS, cron, worker ni 0045** · **Marketplace OFF (`GLOBAL_MARKET_ENABLED=false`)** · **Datos reales, fixtures solo QA SYNTHETIC**.

> Regla de la fase: el servidor decide (créditos, propiedad, RNG, carta, serial, recompensas, mazos);
> el cliente presenta. Nada de esta fase toca `openPack`, pesos, pools, pity, precios ni el motor de
> combate. Lo que añade es el BUCLE: conseguir → abrir → descubrir → coleccionar → completar → construir
> equipo → jugar → progresar → conseguir más sobres.

## 1. Estado inicial encontrado

- **Sobres**: `/packs` era un catálogo por pestañas; `/packs/[packId]` una ficha con reparto medido
  (`packStats`) y nota de equipo; `/abrir/[packId]` una ceremonia fullscreen de seis actos (intro,
  sellado, rotura, mano, revelado carta a carta con `ceremony.ts` por rareza, resumen) con saltar,
  teclado, reduced motion, recuperación por `sessionStorage` (`openRecovery`), NEW/DUPLICATE por
  `isNew`, serial, mejor carta (rareza → OVR) y «abrir otro» sin salir. Compra/apertura por
  `POST /api/game/packs` (`buy`/`open`/`buy_and_open`), RPC `app_buy_pack`/`app_apply_pack_open`,
  idempotencia por `economy_ops.ref`, ciclo de vida DRAFT/ACTIVE/RETIRED en dominio y servidor.
- **Cartas**: `PlayerCard → CardRenderer` (tilt framer-motion, capas, sello de variante), `Card3D`
  (showcase/static, `status new/locked`), `CardViewer` (ficha con stats, valor, descripción), 37
  variantes con `rank`, `serialLimit` y `animation`. Sin `rarity` plano: la rareza ES la variante.
- **Colección**: `/coleccion` con `CollectionEngine` (búsqueda, región, serie, tengo/faltan, orden
  rareza/OVR/A-Z), agrupación por definición (`groupCollection`: `count` + `bestSerial`), paginado
  48, progreso por región, maestría y prestigio (servidor), `CardDetail` con instancias. `/coleccion/
  equipos` con `buildTeamCollection` (owned/missing por equipo). `/inventario` con sobres y duplicadas.
- **Mazos**: `domain/cardgame/deck.ts` (10 cartas, 2 por rol, jugador único, `validateDuelDeck`),
  `duel_decks` en servidor con `saveDeck` (propiedad y composición), `DeckBuilder`.
- **Home**: `LobbyStage` con escalera de CTA (abrir sobres / entrar / construir mazo / jugar).
- **Telemetría**: contrato cerrado de 4 eventos (CHECK en BD), zonas y 4 flujos.
- **Audio**: `lib/sound.ts` (Web Audio sintetizado, mute). **Sin haptics**.
- **Favoritos**: modelados en `collection/meta.ts`, sin UI ni persistencia de servidor.
- **Bug real**: la acción `open` de `/api/game/packs` no reenviaba `ref` al servicio: un reintento
  (respuesta perdida, doble toque) generaba un gesto nuevo en servidor y consumía un SEGUNDO sobre.

## 2. Qué se reutilizó

Todo lo anterior. No hay ceremonia nueva, ni RNG, ni visual de carta paralelo, ni motor de colección
nuevo, ni reglas de mazo nuevas, ni eventos de telemetría nuevos. Se añaden capas finas: dominio puro
(`odds`, `deckInsert`, `showcase`), componentes (`MyPacks`, `PackOddsPanel`, `AddToDeckSheet`,
`LoopStrip`) y cableado en las pantallas existentes.

## 3. Qué se construyó

| Pieza | Fichero | Qué hace |
|---|---|---|
| Pack Hub | `src/app/packs/page.tsx` | Mis sobres (agrupados ×n + Abrir) → Destacados → Tienda por pestañas; saldo; telemetría `hub_viewed` |
| Mis sobres | `src/components/packs/MyPacks.tsx` + `domain/collection/showcase.ownedPackGroups` | agrupación por producto, RETIRED poseído «ya no se vende» pero abrible, DRAFT nunca |
| Probabilidades | `src/domain/packs/odds.ts` + `src/components/packs/PackOdds.tsx` | por carta (medido), «≥1 por sobre» (derivado), garantía, imposibles, equipo «aumentada» |
| Ceremonia 2.0 | `PackOpeningExperience.tsx` | señal de rareza antes del revelado, «Revelar todas», serie baja, «Añadir al equipo», telemetría |
| Recuperación | `openRecovery.ts` + `lib/game/sync.ts` + `route.ts` | un gesto por apertura (pendiente en `sessionStorage`), `ref` reenviado en `open` |
| Sobre → mazo | `src/domain/cardgame/deckInsert.ts` + `src/components/deck/AddToDeckSheet.tsx` + `deckCard.ts` | planificar hueco/sustitución/upgrade, comparar, confirmar, `saveDuelDeck` |
| Colección 2.0 | `src/app/coleccion/page.tsx` + `AlbumToolbar.tsx` | hero con cifras, recientes, facetas equipo/rol/copias, órdenes equipo/serial/reciente, equipos cerca de completarse, «Añadir al equipo» en la ficha |
| Home | `src/components/lobby/LoopStrip.tsx` + `src/app/page.tsx` | tira del bucle: sobres, carta nueva, equipo N/10, próximo objetivo |
| QA | `src/app/design-system/fase25/page.tsx` + `scripts/_fase25-visual-qa.ts` | arnés QA SYNTHETIC (catálogo real, propiedad inventada, sin servidor) + capturas 1440/1024/390 |

## 4. Pack Hub

`/packs`: cabecera con saldo, **Mis sobres** arriba (el bucle empieza por lo que ya tienes),
**Destacados** (un sobre por familia visible, motivo real: «Probabilidad aumentada de X» para
equipo, o la cabecera medida de `guidanceFor`), **Tienda** con las pestañas de siempre (hash
`#rareza/#regiones/#equipos/#eventos`). Solo ACTIVE. Botones de pestaña ≥44 px.

## 5. Pack Detail

Sobre grande, categoría, «N sin abrir», precio/contiene/saldo y el panel **«Qué puede salir»**: barra
por carta, filas por rareza (por carta medido, «≥1 por sobre» aproximado, «Garantizada» cuando el
catálogo lo garantiza en la última carta), rarezas imposibles, y la frase de equipo. CTA: abrir si se
posee, comprar y abrir si no; sin internals (pool ids, pesos, JSON, prioridad).

## 6. Probabilidades

`packOddsFor(pack, packStats, teamCards)`: por carta = `packStats.drawn` (20 000 aperturas con el
motor real, revalidadas por `packStats.test.ts`); `atLeastOne = 1 − (1 − p)^n`; `guaranteedMin` del
catálogo → 100 % para esa rareza, las superiores mantienen su cifra; imposibles = `packStats.impossible`;
sin medición → pesos declarados normalizados (`source: "weights"`). Test 5 comprueba que la UI ES la
distribución medida, sobre TODOS los sobres visibles.

## 7. Team Packs

`teamBoostCopy`: «Probabilidad aumentada de jugadores de Team Heretics: N cartas del equipo pueden
salir y son más probables que el resto, pero no están garantizadas». Nunca «contiene». Team Heretics
sigue siendo el único ACTIVE; NRG/Sentinels/T1/Gen.G/DRX/EDG siguen BLOCKED (solo filas de auditoría,
no están en `PACKS`), sin pools ni datos nuevos.

## 8. Opening 2.0

Se conserva el flujo de seis actos y se añade: **señal de rareza** en el acto de la mano (halo con el
color de la mejor variante e intensidad de su receta `ceremony.ts`; rayos solo en los niveles altos;
solo color/intensidad, sin nombre ni carta en el DOM), **«Revelar todas»** junto a «Revelar»,
**serie baja** en el pie (≤10 o ≤1 % de la tirada), **«Añadir al equipo»** en el resumen con la mejor
carta, y telemetría (`opening_started`, `pack_opened`, `card_revealed`, `opening_skipped`). Sigue:
skip solo de presentación, doble apertura bloqueada por `opened.current`, reduced motion, teclado,
«abrir otro» solo con unidades reales.

## 9. Recovery / idempotencia

- `route.ts`: `open` reenvía `ref` (bug corregido).
- `sync.openPackOnline`: `gesture = ref ?? loadPendingOpen(packId) ?? newOpenGesture()`; se guarda
  ANTES de pedir y se limpia al confirmar. Respuesta perdida → el reintento repite el mismo gesto →
  `economy_ops` devuelve lo ya persistido (`repeated`) o abre por primera vez. Nunca dos sobres.
- El revelado se sigue guardando (`saveOpenReveal`) y restaurando tras recarga sin reabrir.
- No se devuelven créditos ni sobres automáticamente: el estado lo decide el servidor.

## 10. Card Experience

`CardVisual`/`PlayerCard`/`CardRenderer` siguen siendo la fuente visual canónica (tilt en desktop,
sello y paleta por variante, `Card3D` showcase en la mejor carta, `static` en rejillas grandes). Esta
fase no añade un sistema visual: añade dónde y cuándo se muestra (recientes con `status="new"`,
serie baja destacada, comparación en el mazo).

## 11. Card Detail

`CardViewer` (jugador, equipo, rol, OVR, trío de combate, variante, serial, valor canónico, copias)
con instancias por serial y ahora **«Añadir al equipo»** (instancia representativa → mazo). Sin datos
inventados: solo lo que ya existe en catálogo e instancia.

## 12. Collection 2.0

Hero con **cartas únicas / total / %**, **copias (+repetidas)**, **equipos completos / empezados** y
**recientes 24 h**; tira **«Recién conseguidas»** (`obtainedAt` real, `status new`, abre la ficha);
sección **Equipos** (los cuatro más cerca de completarse, pulsable = filtro por equipo, enlace a
`/coleccion/equipos`); filtros y órdenes nuevos (§14); ficha con «Añadir al equipo».

## 13. Duplicate grouping

Una casilla por definición (`groupCollection`: `×n` y mejor serial); las instancias (#84, #932…) en
la ficha; facet **Copias → Duplicadas** (`duplicateCardIds`); en la ceremonia «Repetida» sale de
`isNew` real y cada instancia conserva su serial.

## 14. Collection completion

Global (`engine.progress`), por región (existente), por equipo (`buildTeamCollection`, catálogo
real) y en el hero (`heroMetrics`). Sin checklist manual.

## 15. Team Collection

`/coleccion/equipos` (existente) enlazada desde el hero y desde la sección Equipos; desde la
colección, pulsar un equipo filtra el álbum por ese equipo (owned normal, missing en gris).

## 16. Pack → Deck

`planDeckInsert(deck, carta)` → `free` (hueco de su rol), `replace` (rol o mazo lleno: elegir a
quién sustituir, comparación OVR/SH/GS/EF/rareza con «N suben · M bajan», sin porcentajes
inventados), `upgrade` (mismo jugador: solo su carta), `blocked` (ya está). `AddToDeckSheet` exige
elegir antes de «Sustituir y guardar», crea mazo si no hay ninguno, guarda con `saveDuelDeck` (el
servidor valida propiedad y composición) y muestra el estado devuelto. Restricciones intactas
(`ALLOW_SAME_PLAYER_TWICE=false`, 2 por rol, 10 cartas). Test 43 comprueba que lo que produce pasa
`validateDuelDeck`.

## 17. Home loop

`LoopStrip` bajo el escenario: «Tienes N sobres → Abrir», «Nueva carta → Ver colección» (24 h),
«Tu equipo 8/10 → Completar», «Próximo objetivo → equipo más cerca». Sin datos no hay tarjeta; el
jugador nuevo ve «Consigue tu primer sobre» o directamente sus sobres de bienvenida. FTUE y
recompensas no se tocan.

## 18. Game feel / audio / haptics

Feedback donde aporta: hover/press en hub y destacados, señal de rareza, «Nueva» en verde, serie baja,
`Card3D status="new"` en recientes. Audio: se reutiliza `lib/sound.ts` (sin assets nuevos, con mute
existente). Haptics: no había infraestructura y no se añade dependencia; queda como P2.

## 19. Responsive

Hub en 2/3/4 columnas; Mis sobres en lista (móvil) o rejilla; ficha en una columna en móvil con el
panel de probabilidades apilado; ceremonia ya escalaba el sobre por ancho; hoja «Añadir al equipo»
anclada abajo en móvil (`items-end`) y centrada en desktop; tira del bucle 1→2→4 columnas; recientes
con scroll horizontal. Capturas en §24.

## 20. Accessibility

Botones reales ≥44 px, `nx-focus` visible, `aria-label` en abrir/ver/equipo, `role="dialog"`
`aria-modal` en la hoja, `role="radiogroup"/"radio"` en la sustitución, `role="status"` en guardado,
teclado de la ceremonia intacto, «Revelar todas» accesible, rareza con forma (rombo) + texto además
del color, reduced motion respetado (la señal de rareza y los rayos no se pintan).

## 21. Performance

Sin listeners 3D en rejillas: `Card3D mode="static"` en recientes y en el resto del sobre;
`useMemo` para opciones de equipo/rol, duplicadas, `latestByCard`, entradas de equipo y hero;
paginado de 48 intacto; sin virtualización (no hace falta con paginado).

## 22. Security

Verificado por `packLoop.contract.test.ts`: la ruta solo lee `action/packId/ref`; el precio sale del
catálogo; la semilla es `randomInt` en servidor; `guardPublicOpen`/`guardPurchase`; DRAFT 404 y RETIRED
409 (suite existente `packLifecycle.test.ts`); la propiedad la comprueba la RPC en transacción; los
mazos se guardan con `saveDeck` (propiedad server-side); el cliente no compone seriales (suite 21.2
sigue verde); `GLOBAL_MARKET_ENABLED=false` y sin venta rápida con sesión.

## 23. Telemetry

Taxonomía existente: `trackFlow("pack_ceremony", contexto)` con `hub_viewed`, `pack_viewed:<id>`,
`pack_purchased:<id>`, `opening_started:<id>`, `pack_opened:<id>:<n>`, `card_revealed`,
`opening_skipped`; `trackFlow("deck_builder", "add_from_card:<origen>")`; `zone_entered` cubre
colección/tienda/ceremonia. Sin eventos nuevos (el CHECK de BD no cambia). `card_detail_viewed`
queda como P2 (exige contrato + migración).

## 24. QA

Arnés `/design-system/fase25?seed=1` (QA SYNTHETIC: catálogo real, 29 instancias inventadas con
duplicadas, serie baja y recientes; sobres estándar ×4, premium ×1, Team Heretics ×2; mazo de mentira
para la comparación). Escenarios cubiertos: con/sin sobres, estándar, team pack, rare pull (señal),
múltiples cartas, NEW/DUPLICATE, serie baja, skip/revelar todas, refresh (recovery), fallo de red
(gesto pendiente), doble clic, móvil, reduced motion, RETIRED poseído, DRAFT inaccesible, colección
grande (paginado), equipos, añadir al mazo. Capturas: ver `docs/product/qa/fase25/` (lista al final).

## 25. Tests / gates

Nuevos: `odds.test.ts` (5), `deckInsert.test.ts` (7), `showcase.test.ts` (8, incluye la tira del
bucle), `packLoop.contract.test.ts` (8), `openRecovery.test.ts` (10 = 7 de la 21.2 reconstruidos + 3).
Incidencia honesta: el fichero `openRecovery.test.ts` (21.2, 7 tests, sin commit) se sobrescribió por
error durante la fase y se reconstruyó a partir de su informe; ninguna otra suite existente se ha
modificado. Gates: ver la sección final del informe (se rellena con la última pasada).

## 26. P2 reales restantes

1. Favoritos persistentes en servidor (hoy solo modelo local sin UI): exige migración.
2. `card_detail_viewed`/`collection_viewed` como eventos propios: exige ampliar el contrato de
   telemetría y su CHECK en BD.
3. Haptics (`navigator.vibrate`) opcional en móvil.
4. Valor estimado en ficha: se muestra el canónico (`instanceValue`); sin histórico real de precios
   con sesión.
5. Mapas «TBD» del conector VLR y demás P2 de 24.x, sin cambios.
6. `sort.ts` «obtained» sigue siendo aproximado en el motor; la colección ordena «reciente» con la
   instancia real, pero el motor no expone `obtainedAt` por vista.

## Archivos

**Nuevos:** `src/domain/packs/odds.ts` (+test), `src/domain/cardgame/deckInsert.ts` (+test),
`src/domain/collection/showcase.ts` (+test), `src/components/packs/MyPacks.tsx`, `PackOdds.tsx`,
`packLoop.contract.test.ts`, `src/components/deck/AddToDeckSheet.tsx`, `deckCard.ts`,
`src/components/lobby/LoopStrip.tsx`, `src/app/design-system/fase25/page.tsx`,
`scripts/_fase25-visual-qa.ts`, `docs/product/qa/fase25/*`, este informe.
**Modificados:** `src/app/packs/page.tsx` (hub), `src/app/packs/[packId]/page.tsx`,
`src/components/packs/packCatalog.ts` (`featuredPacks`), `PackOpeningExperience.tsx`,
`src/app/api/game/packs/route.ts` (ref en `open`), `src/lib/game/sync.ts`, `src/lib/game/openRecovery.ts`
(+test reconstruido), `src/app/coleccion/page.tsx`, `src/components/album/AlbumToolbar.tsx`,
`src/app/page.tsx`.
**No tocados:** RNG/`openPack`/pools/pity/pesos/precios, `packStats`, Marketplace, combate, PvP,
Pick'ems, progresión, economía, migraciones, VPS/cron/worker.

## Gates (última pasada, código final)

| gate | resultado |
|---|---|
| `npm test` | **1274/1274** (1243 previos + 31 nuevos; incluye los 7 de `openRecovery` reconstruidos) |
| typecheck web + scripts | verde |
| build (`next build`) | verde (84 páginas; ruta nueva `/design-system/fase25`) |
| lint (eslint sobre todo lo tocado) | 0 errores; 1 aviso preexistente (`rosterVersion` en `coleccion/page.tsx`, ajeno) |
| security · pack · content · distribution · competitive · importer-vlr | verdes |
| tests existentes de packs (`packs.test.tsx`, `packOpening.behavior`, `packLifecycle`, `packStats`, `teamPackCatalog`, `distribution`) | verdes sin modificar |

## Capturas QA (`docs/product/qa/fase25/`, 28 PNG + README)

`00-arnes-qa` · `01-pack-hub` (1440/1024/390) · `02-pack-detail` (1440/390) · `03-opening-start` ·
`04-rarity-buildup` · `05-card-reveal` · `06-multi-reveal` · `07-summary` (1440/390 cada una) ·
`08-collection` (1440/1024/390) · `09-team-collection` (1440/390) · `10-card-detail` (1440/390) ·
`11-deck-add-compare` (1440/390) · `12-home-loop` (1440/390) · `13-opening-reduced-motion` (390).
Los 404 de consola son fotos de jugador ausentes (`/players/<nick>.png`, preexistente; la carta usa
su sigil). Nota de arnés: en `11-deck-add-compare` las dos opciones de sustitución mostraban dos
variantes del mismo jugador por un mazo de mentira mal construido; corregido en el arnés después de
la captura (no afecta al producto: el planificador real recibe mazos válidos del servidor).

**FASE 25 — CERRADA.**
