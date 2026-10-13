# QA visual · Fase 37 — Collection & Card Experience 3.0

**QA SYNTHETIC**: cada escena del arnés `/design-system/fase37` renderiza la sala REAL (`CollectionRoomScreen`), la ficha REAL (`CardDetailView`) y el comparador REAL (`CardCompareView`) con el catálogo REAL (772 definiciones, stats, equipos, sobres) y COPIAS INVENTADAS (`src/app/design-system/fase37/fixtures.ts`: instancias, seriales, favoritas, vitrina y equipos). Nada de estas capturas es un dato de un jugador.
Las capturas `72-*`…`76-*` son rutas reales de la app sin backend (sin túnel). La evidencia con la cuenta QA contra la BD del VPS está en `real/` y en el informe de la fase.
Generadas con `npx tsx scripts/_fase37-visual-qa.ts` contra `next start` en :3005.
Comprobaciones por captura: desbordamiento horizontal, número de `h1`, controles < 44 px dentro de sala/ficha/comparador (fuera de las cartas), cartas montadas en la rejilla, estado de girar y favorito.

## Evidencia REAL (separada de las fixtures) — `real/`

`npx tsx scripts/_fase37-live-smoke.ts <creds>`: app local (`next start` :3005) → túnel SSH → BD del VPS, cuenta QA `8c326e52`, login por el formulario real. Sin economía (no compra, no abre, no reclama). Única escritura: vitrina añadida y revertida.

| captura | qué demuestra |
|---|---|
| `real-01/03/04-coleccion-hero-{1440,1024,390}` | cabecera real 30 / 772 · 3,8 % = API |
| `real-02-coleccion-full-1440` | sala completa con datos reales |
| `real-05-search-owned-player-1440` | búsqueda «aspas»: 8 variantes, 1 tuya, `?q=` |
| `real-06-filter-owned-1440` · `real-07-filters-panel-1440` | «Poseídas» = 30 únicas; panel de filtros |
| `real-08-detail-best-owned-1440` · `real-09-detail-copies-serials-1440` | ficha real: `#5/500` Top 10, equipos, «Favoritos no disponibles» (0052 sin aplicar) |
| `real-10-detail-flip-back-1440` | reverso NEXUS |
| `real-11-compare-own-cards-1440` | comparación con carta propia, sin veredicto |
| `real-12-detail-deck-usage-1440` · `real-13-add-to-deck-sheet-1440` | uso en equipos; hoja abierta y cerrada sin guardar |
| `real-showcase-added-390` · `real-showcase-after-refresh-390` | vitrina añadida y persistida tras recargar (luego revertida por API) |
| `real-14-detail-unowned-1440` | carta no conseguida: «No conseguida», sin serial |
| `real-15-anon-public-card-1440` · `real-16-anon-collection-1440` | anónimo: definición pública, sin datos privados |

Huella de BD antes/después idéntica salvo `player_profile_customization.version` v2→v4 (añadir + revertir). Favoritos E2E real: **NO EJECUTADO — REQUIERE 0052 APLICADA**.

| captura | ancho | escena | comprobaciones |
|---|---|---|---|
| `01-hub-collection-hero-1440.png` | 1440 | scene=hub-veteran | 48 cartas montadas |
| `01-hub-collection-hero-1024.png` | 1024 | scene=hub-veteran | 48 cartas montadas |
| `01-hub-collection-hero-390.png` | 390 | scene=hub-veteran | 48 cartas montadas |
| `02-hub-full-room-1440.png` | 1440 | scene=hub-veteran · página completa | 48 cartas montadas |
| `03-hub-empty-account-1440.png` | 1440 | scene=hub-fresh | 48 cartas montadas |
| `03-hub-empty-account-1024.png` | 1024 | scene=hub-fresh | 48 cartas montadas |
| `03-hub-empty-account-390.png` | 390 | scene=hub-fresh | 48 cartas montadas |
| `04-hub-starter-collection-1440.png` | 1440 | scene=hub-starter | 48 cartas montadas |
| `04-hub-starter-collection-1024.png` | 1024 | scene=hub-starter | 48 cartas montadas |
| `04-hub-starter-collection-390.png` | 390 | scene=hub-starter | 48 cartas montadas |
| `05-hub-complete-catalog-100-1440.png` | 1440 | scene=hub-complete | 48 cartas montadas |
| `05-hub-complete-catalog-100-390.png` | 390 | scene=hub-complete | 48 cartas montadas |
| `06-hub-anonymous-public-catalog-1440.png` | 1440 | scene=hub-anon | 48 cartas montadas |
| `06-hub-anonymous-public-catalog-1024.png` | 1024 | scene=hub-anon | 48 cartas montadas |
| `06-hub-anonymous-public-catalog-390.png` | 390 | scene=hub-anon | 48 cartas montadas |
| `07-hub-local-mode-1440.png` | 1440 | scene=hub-local | 48 cartas montadas |
| `07-hub-local-mode-390.png` | 390 | scene=hub-local | 48 cartas montadas |
| `08-hub-loading-1440.png` | 1440 | scene=hub-loading | 48 cartas montadas |
| `08-hub-loading-390.png` | 390 | scene=hub-loading | 48 cartas montadas |
| `09-hub-offline-last-snapshot-1440.png` | 1440 | scene=hub-offline | 48 cartas montadas |
| `09-hub-offline-last-snapshot-1024.png` | 1024 | scene=hub-offline | 48 cartas montadas |
| `09-hub-offline-last-snapshot-390.png` | 390 | scene=hub-offline | 48 cartas montadas |
| `10-hub-server-error-last-snapshot-1440.png` | 1440 | scene=hub-error-stale | 48 cartas montadas |
| `11-hub-favorites-unavailable-1440.png` | 1440 | scene=hub-favorites-unavailable | 48 cartas montadas |
| `12-discovery-favorites-top-near-1440.png` | 1440 | scene=hub-veteran | 48 cartas montadas |
| `12-discovery-favorites-top-near-1024.png` | 1024 | scene=hub-veteran | 48 cartas montadas |
| `12-discovery-favorites-top-near-390.png` | 390 | scene=hub-veteran | 48 cartas montadas |
| `13-book-teams-1440.png` | 1440 | scene=book-team | 48 cartas montadas |
| `13-book-teams-1024.png` | 1024 | scene=book-team | 48 cartas montadas |
| `13-book-teams-390.png` | 390 | scene=book-team | 48 cartas montadas |
| `14-book-regions-1440.png` | 1440 | scene=book-region | 48 cartas montadas |
| `15-book-roles-flex-1440.png` | 1440 | scene=book-role | 48 cartas montadas |
| `16-book-rarities-1440.png` | 1440 | scene=book-rarity | 48 cartas montadas |
| `16-book-rarities-390.png` | 390 | scene=book-rarity | 48 cartas montadas |
| `17-book-editions-1440.png` | 1440 | scene=book-edition | 48 cartas montadas |
| `18-album-grid-all-1440.png` | 1440 | scene=hub-veteran | 48 cartas montadas |
| `18-album-grid-all-1024.png` | 1024 | scene=hub-veteran | 48 cartas montadas |
| `18-album-grid-all-390.png` | 390 | scene=hub-veteran | 48 cartas montadas |
| `19-album-owned-only-1440.png` | 1440 | scene=album-owned | 48 cartas montadas |
| `19-album-owned-only-390.png` | 390 | scene=album-owned | 48 cartas montadas |
| `20-album-missing-only-1440.png` | 1440 | scene=album-missing | 48 cartas montadas |
| `20-album-missing-only-390.png` | 390 | scene=album-missing | 48 cartas montadas |
| `21-search-player-1440.png` | 1440 | scene=album-search | 6 cartas montadas |
| `21-search-player-1024.png` | 1024 | scene=album-search | 6 cartas montadas |
| `21-search-player-390.png` | 390 | scene=album-search | 6 cartas montadas |
| `22-search-no-diacritics-1440.png` | 1440 | scene=album-search-diacritics | 2 cartas montadas |
| `23-search-team-1440.png` | 1440 | scene=album-search-team | 21 cartas montadas |
| `24-search-no-results-1440.png` | 1440 | scene=album-no-results |  |
| `24-search-no-results-1024.png` | 1024 | scene=album-no-results |  |
| `24-search-no-results-390.png` | 390 | scene=album-no-results |  |
| `25-filter-legendary-1440.png` | 1440 | scene=album-rarity | 7 cartas montadas |
| `25-filter-legendary-390.png` | 390 | scene=album-rarity | 7 cartas montadas |
| `26-filter-role-flex-1440.png` | 1440 | scene=album-role | 48 cartas montadas |
| `27-filter-region-pacific-1440.png` | 1440 | scene=album-region | 48 cartas montadas |
| `28-filter-team-1440.png` | 1440 | scene=album-team | 29 cartas montadas |
| `29-filter-ovr-range-1440.png` | 1440 | scene=album-ovr | 48 cartas montadas |
| `30-filter-duplicates-1440.png` | 1440 | scene=album-duplicates | 48 cartas montadas |
| `30-filter-duplicates-390.png` | 390 | scene=album-duplicates | 48 cartas montadas |
| `31-filter-favorites-1440.png` | 1440 | scene=album-favorites | 7 cartas montadas |
| `32-sort-ovr-asc-1440.png` | 1440 | scene=album-sort-ovr-asc | 48 cartas montadas |
| `33-sort-copies-1440.png` | 1440 | scene=album-sort-copies | 48 cartas montadas |
| `34-sort-player-1440.png` | 1440 | scene=album-sort-player | 48 cartas montadas |
| `35-filters-panel-open-1440.png` | 1440 | scene=hub-veteran | 48 cartas montadas |
| `35-filters-panel-open-1024.png` | 1024 | scene=hub-veteran | 48 cartas montadas |
| `36-filters-sheet-mobile-390.png` | 390 | scene=hub-veteran | 48 cartas montadas |
| `37-filters-combined-chips-1440.png` | 1440 | scene=album-combined | 16 cartas montadas |
| `37-filters-combined-chips-390.png` | 390 | scene=album-combined | 16 cartas montadas |
| `38-album-load-more-1440.png` | 1440 | scene=hub-veteran | 96 cartas montadas |
| `39-detail-owned-serialized-1440.png` | 1440 | scene=detail-owned | girada=false · favorita=true |
| `39-detail-owned-serialized-1024.png` | 1024 | scene=detail-owned | girada=false · favorita=true |
| `39-detail-owned-serialized-390.png` | 390 | scene=detail-owned | girada=false · favorita=true |
| `40-detail-owned-full-1440.png` | 1440 | scene=detail-owned · página completa | girada=false · favorita=true |
| `41-detail-flip-back-1440.png` | 1440 | scene=detail-owned | girada=true · favorita=true |
| `41-detail-flip-back-1024.png` | 1024 | scene=detail-owned | girada=true · favorita=true |
| `41-detail-flip-back-390.png` | 390 | scene=detail-owned | girada=true · favorita=true |
| `42-detail-unowned-1440.png` | 1440 | scene=detail-unowned | girada=false · favorita=true |
| `42-detail-unowned-1024.png` | 1024 | scene=detail-unowned | girada=false · favorita=true |
| `42-detail-unowned-390.png` | 390 | scene=detail-unowned | girada=false · favorita=true |
| `43-detail-anonymous-public-1440.png` | 1440 | scene=detail-anon | girada=false |
| `43-detail-anonymous-public-1024.png` | 1024 | scene=detail-anon | girada=false |
| `43-detail-anonymous-public-390.png` | 390 | scene=detail-anon | girada=false |
| `44-detail-local-mode-1440.png` | 1440 | scene=detail-local | girada=false |
| `45-detail-duplicates-no-serial-1440.png` | 1440 | scene=detail-duplicates | girada=false · favorita=false |
| `45-detail-duplicates-no-serial-390.png` | 390 | scene=detail-duplicates | girada=false · favorita=false |
| `46-detail-copies-serial-1-1440.png` | 1440 | scene=detail-owned | girada=false · favorita=true |
| `46-detail-copies-serial-1-1024.png` | 1024 | scene=detail-owned | girada=false · favorita=true |
| `46-detail-copies-serial-1-390.png` | 390 | scene=detail-owned | girada=false · favorita=true |
| `47-detail-serial-top10-1440.png` | 1440 | scene=detail-top10 | girada=false · favorita=false |
| `48-detail-serial-top100-1440.png` | 1440 | scene=detail-top100 | girada=false · favorita=false |
| `49-detail-serial-no-prestige-1440.png` | 1440 | scene=detail-serial-plain | girada=false · favorita=false |
| `50-detail-favorite-active-1440.png` | 1440 | scene=detail-favorite-on | girada=false · favorita=true |
| `50-detail-favorite-active-390.png` | 390 | scene=detail-favorite-on | girada=false · favorita=true |
| `51-detail-favorites-unavailable-1440.png` | 1440 | scene=detail-favorites-unavailable | girada=false · favorita=false |
| `52-detail-showcase-full-1440.png` | 1440 | scene=detail-showcase-full | girada=false · favorita=true |
| `53-detail-offline-actions-disabled-1440.png` | 1440 | scene=detail-offline | girada=false · favorita=true |
| `53-detail-offline-actions-disabled-390.png` | 390 | scene=detail-offline | girada=false · favorita=true |
| `54-detail-legendary-1440.png` | 1440 | scene=detail-legendary | girada=false · favorita=true |
| `54-detail-legendary-390.png` | 390 | scene=detail-legendary | girada=false · favorita=true |
| `55-detail-role-flex-1440.png` | 1440 | scene=detail-flex | girada=false · favorita=true |
| `56-detail-player-variants-1440.png` | 1440 | scene=detail-many-variants | girada=false · favorita=false |
| `56-detail-player-variants-390.png` | 390 | scene=detail-many-variants | girada=false · favorita=false |
| `57-detail-sets-and-availability-1440.png` | 1440 | scene=detail-owned | girada=false · favorita=true |
| `57-detail-sets-and-availability-390.png` | 390 | scene=detail-owned | girada=false · favorita=true |
| `58-detail-availability-isolated-1440.png` | 1440 | scene=detail-availability-error | girada=false · favorita=true |
| `59-detail-decks-isolated-1440.png` | 1440 | scene=detail-decks-error | girada=false · favorita=true |
| `60-detail-showcase-added-message-1440.png` | 1440 | scene=detail-message | girada=false · favorita=true |
| `61-detail-loading-1440.png` | 1440 | scene=detail-loading | girada=false · favorita=false |
| `62-detail-reduced-motion-flip-1440.png` | 1440 | scene=detail-owned · reduced-motion | girada=true · favorita=true |
| `63-detail-keyboard-focus-1440.png` | 1440 | scene=detail-owned | foco en «Quitar de favoritos» · girada=false · favorita=true |
| `64-detail-long-labels-1440.png` | 1440 | scene=detail-long-labels | girada=false · favorita=true |
| `64-detail-long-labels-390.png` | 390 | scene=detail-long-labels | girada=false · favorita=true |
| `65-compare-picker-owned-first-1440.png` | 1440 | scene=compare-picker |  |
| `65-compare-picker-owned-first-1024.png` | 1024 | scene=compare-picker |  |
| `65-compare-picker-owned-first-390.png` | 390 | scene=compare-picker |  |
| `66-compare-two-cards-1440.png` | 1440 | scene=compare-two |  |
| `66-compare-two-cards-1024.png` | 1024 | scene=compare-two |  |
| `66-compare-two-cards-390.png` | 390 | scene=compare-two |  |
| `67-compare-player-variants-1440.png` | 1440 | scene=compare-variants |  |
| `67-compare-player-variants-390.png` | 390 | scene=compare-variants |  |
| `68-compare-same-card-1440.png` | 1440 | scene=compare-same |  |
| `69-compare-unowned-1440.png` | 1440 | scene=compare-unowned |  |
| `70-hub-reduced-motion-1440.png` | 1440 | scene=hub-veteran · reduced-motion | 48 cartas montadas |
| `71-hub-keyboard-focus-1440.png` | 1440 | scene=hub-veteran | foco en «Forja» · 48 cartas montadas |
| `72-real-route-card-not-found-1440.png` | 1440 | ruta real: id con formato válido que no existe | carta no encontrada · listo en 4.2 s |
| `72-real-route-card-not-found-390.png` | 390 | ruta real: id con formato válido que no existe | carta no encontrada · listo en 4 s |
| `73-real-route-path-traversal-1440.png` | 1440 | ruta real: id con rutas → carta no encontrada | carta no encontrada · listo en 4.1 s |
| `74-real-route-compare-invalid-1440.png` | 1440 | ruta real: comparador con id no válido | listo en 4.1 s |
| `75-real-route-card-public-no-backend-1440.png` | 1440 | ruta real: ficha pública sin túnel | girada=false · listo en 9 s |
| `75-real-route-card-public-no-backend-390.png` | 390 | ruta real: ficha pública sin túnel | girada=false · listo en 9.1 s |
| `76-real-route-collection-no-backend-1440.png` | 1440 | ruta real `/coleccion` con el túnel CERRADO | 48 cartas montadas · listo en 11.1 s |
| `76-real-route-collection-no-backend-390.png` | 390 | ruta real `/coleccion` con el túnel CERRADO | 48 cartas montadas · listo en 11 s |

Capturas: 131. Con desbordamiento horizontal: 0. Con controles < 44 px: 0. Máximo de cartas montadas a la vez: 96. Errores de consola propios (sin 404 de fotos ni backend ausente): 0.
