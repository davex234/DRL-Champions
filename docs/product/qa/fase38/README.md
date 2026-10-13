# QA visual · Fase 38 — Pack Opening Experience 3.0 (The Reveal)

**QA SYNTHETIC**: cada escena del arnés `/design-system/fase38` renderiza las piezas REALES de la apertura (`PackStage`, `CardReveal`, `PackSummary`, `PackStatus`) con planes del dominio REAL (`buildRevealPlan`) sobre RESULTADOS INVENTADOS (`src/app/design-system/fase38/fixtures.ts`). Ninguna captura de esta carpeta es una apertura real ni decide nada del sorteo; cada una lleva la marca «QA SYNTHETIC» abajo a la izquierda.
Las capturas `real-route-*` son la ruta real sin backend. La evidencia contra la BD del VPS con la cuenta QA está en `real/` y en el informe de la fase.
Generadas con `npx tsx scripts/_fase38-visual-qa.ts` contra `next start` en :3005.
Comprobaciones por captura: desbordamiento horizontal, controles < 44 px dentro de la apertura, fase/estado, cartas del resumen, nodos DOM, marca SYNTHETIC.

## Evidencia REAL (separada de las fixtures) — `real/`

App local (`next start` :3005) → túnel SSH → PostgreSQL del VPS, cuenta QA `8c326e52…`, login por el formulario real. Se compró **UN** Sobre Estándar por la ruta real (−750 créditos, `packs_opened` sin cambio) y se abrió en el navegador.

| captura | qué demuestra |
|---|---|
| `real-01-inventory.png` | inventario con el sobre comprado, enlace a `/abrir/estandar` |
| `real-02-pack-ready.png` | sobre sellado real: «Sobre Estándar · 5 cartas» y «ABRIR SOBRE» |
| `real-03-requesting-or-opening.png` | tras el doble clic: «Abriendo tu sobre…», sin rareza ni cartas hasta que el servidor confirma |
| `real-04-hand-face-down.png` | resultado recibido: 5 cartas boca abajo y «Revelar» |
| `recovery-01-inventory-after-open.png` | inventario sin el sobre (consumido una vez) |
| `recovery-03-recovered-summary.png` · `recovery-04-recovered-summary-full.png` | recarga con la apertura pendiente → resumen recuperado de la BD: 5/5 cartas = `user_cards`, 5 nuevas, colección 30 → 35 / 772 |
| `recovery-05-reload-recovered-again.png` | segunda recarga: mismo resumen, sin otra apertura |
| `recovery-06-card-detail.png` | «Ver en mi colección» → ficha real poseída (`pa1ze__emea`) |

BD (solo lectura por SSH): 1 compra y **exactamente 1** `open_pack` pese al doble clic; `packs_opened` 6 → 7; cartas 30 → 35; créditos sin cambio al abrir; reintento con la misma clave → `repeated`, +0 en todo; huella de la cuenta idéntica tras recuperación y reintentos.

**Límite declarado:** el revelado carta a carta de ESTE resultado real no quedó capturado por un fallo del instrumento (esperas con `??` y `&&` sin paréntesis) que ya está corregido; no se compró un segundo sobre. El revelado carta a carta está cubierto por las escenas QA SYNTHETIC de esta carpeta y por las pruebas.

| captura | ancho | escena | comprobaciones |
|---|---|---|---|
| `01-stage-ready-1440.png` | 1440 | scene=stage-ready | fase ready · 207 nodos |
| `01-stage-ready-1024.png` | 1024 | scene=stage-ready | fase ready · 207 nodos |
| `01-stage-ready-390.png` | 390 | scene=stage-ready | fase ready · 203 nodos |
| `02-stage-ready-premium-1440.png` | 1440 | scene=stage-ready-premium | fase ready · 207 nodos |
| `02-stage-ready-premium-390.png` | 390 | scene=stage-ready-premium | fase ready · 203 nodos |
| `03-stage-ready-team-1440.png` | 1440 | scene=stage-ready-team | fase ready · 207 nodos |
| `03-stage-ready-team-390.png` | 390 | scene=stage-ready-team | fase ready · 203 nodos |
| `04-stage-requesting-1440.png` | 1440 | scene=stage-requesting | fase requesting · 206 nodos |
| `04-stage-requesting-1024.png` | 1024 | scene=stage-requesting | fase requesting · 206 nodos |
| `04-stage-requesting-390.png` | 390 | scene=stage-requesting | fase requesting · 202 nodos |
| `05-stage-opening-1440.png` | 1440 | scene=stage-opening | fase opening · 214 nodos |
| `05-stage-opening-1024.png` | 1024 | scene=stage-opening | fase opening · 214 nodos |
| `05-stage-opening-390.png` | 390 | scene=stage-opening | fase opening · 210 nodos |
| `06-stage-hand-low-1440.png` | 1440 | scene=stage-hand-low | fase hand · 232 nodos |
| `06-stage-hand-low-390.png` | 390 | scene=stage-hand-low | fase hand · 228 nodos |
| `07-stage-hand-mid-1440.png` | 1440 | scene=stage-hand-mid | fase hand · 232 nodos |
| `07-stage-hand-mid-1024.png` | 1024 | scene=stage-hand-mid | fase hand · 232 nodos |
| `07-stage-hand-mid-390.png` | 390 | scene=stage-hand-mid | fase hand · 228 nodos |
| `08-stage-hand-high-1440.png` | 1440 | scene=stage-hand-high | fase hand · 232 nodos |
| `08-stage-hand-high-1024.png` | 1024 | scene=stage-hand-high | fase hand · 232 nodos |
| `08-stage-hand-high-390.png` | 390 | scene=stage-hand-high | fase hand · 228 nodos |
| `09-stage-hand-legendary-1440.png` | 1440 | scene=stage-hand-legendary | fase hand · 233 nodos |
| `09-stage-hand-legendary-1024.png` | 1024 | scene=stage-hand-legendary | fase hand · 233 nodos |
| `09-stage-hand-legendary-390.png` | 390 | scene=stage-hand-legendary | fase hand · 229 nodos |
| `10-stage-reduced-ready-1440.png` | 1440 | scene=stage-reduced-ready · reduced-motion | fase ready · 190 nodos |
| `10-stage-reduced-ready-390.png` | 390 | scene=stage-reduced-ready · reduced-motion | fase ready · 186 nodos |
| `11-stage-reduced-hand-1440.png` | 1440 | scene=stage-reduced-hand · reduced-motion | fase hand · 232 nodos |
| `11-stage-reduced-hand-1024.png` | 1024 | scene=stage-reduced-hand · reduced-motion | fase hand · 232 nodos |
| `11-stage-reduced-hand-390.png` | 390 | scene=stage-reduced-hand · reduced-motion | fase hand · 228 nodos |
| `12-reveal-back-common-1440.png` | 1440 | scene=reveal-back-common | fase reveal · 283 nodos |
| `12-reveal-back-common-1024.png` | 1024 | scene=reveal-back-common | fase reveal · 283 nodos |
| `12-reveal-back-common-390.png` | 390 | scene=reveal-back-common | fase reveal · 279 nodos |
| `13-reveal-back-legendary-1440.png` | 1440 | scene=reveal-back-legendary | fase reveal · 291 nodos |
| `13-reveal-back-legendary-1024.png` | 1024 | scene=reveal-back-legendary | fase reveal · 291 nodos |
| `13-reveal-back-legendary-390.png` | 390 | scene=reveal-back-legendary | fase reveal · 287 nodos |
| `14-reveal-back-serial-one-1440.png` | 1440 | scene=reveal-back-serial-one | fase reveal · 311 nodos |
| `14-reveal-back-serial-one-1024.png` | 1024 | scene=reveal-back-serial-one | fase reveal · 311 nodos |
| `14-reveal-back-serial-one-390.png` | 390 | scene=reveal-back-serial-one | fase reveal · 307 nodos |
| `15-reveal-common-1440.png` | 1440 | scene=reveal-common | fase reveal · 290 nodos |
| `15-reveal-common-1024.png` | 1024 | scene=reveal-common | fase reveal · 290 nodos |
| `15-reveal-common-390.png` | 390 | scene=reveal-common | fase reveal · 286 nodos |
| `16-reveal-uncommon-1440.png` | 1440 | scene=reveal-uncommon | fase reveal · 309 nodos |
| `16-reveal-uncommon-390.png` | 390 | scene=reveal-uncommon | fase reveal · 305 nodos |
| `17-reveal-rare-1440.png` | 1440 | scene=reveal-rare | fase reveal · 344 nodos |
| `17-reveal-rare-1024.png` | 1024 | scene=reveal-rare | fase reveal · 344 nodos |
| `17-reveal-rare-390.png` | 390 | scene=reveal-rare | fase reveal · 340 nodos |
| `18-reveal-epic-1440.png` | 1440 | scene=reveal-epic | fase reveal · 349 nodos |
| `18-reveal-epic-1024.png` | 1024 | scene=reveal-epic | fase reveal · 349 nodos |
| `18-reveal-epic-390.png` | 390 | scene=reveal-epic | fase reveal · 345 nodos |
| `19-reveal-legendary-1440.png` | 1440 | scene=reveal-legendary | fase reveal · 356 nodos |
| `19-reveal-legendary-1024.png` | 1024 | scene=reveal-legendary | fase reveal · 356 nodos |
| `19-reveal-legendary-390.png` | 390 | scene=reveal-legendary | fase reveal · 352 nodos |
| `20-reveal-new-1440.png` | 1440 | scene=reveal-new | fase reveal · 387 nodos |
| `20-reveal-new-1024.png` | 1024 | scene=reveal-new | fase reveal · 387 nodos |
| `20-reveal-new-390.png` | 390 | scene=reveal-new | fase reveal · 383 nodos |
| `21-reveal-duplicate-1440.png` | 1440 | scene=reveal-duplicate | fase reveal · 334 nodos |
| `21-reveal-duplicate-1024.png` | 1024 | scene=reveal-duplicate | fase reveal · 334 nodos |
| `21-reveal-duplicate-390.png` | 390 | scene=reveal-duplicate | fase reveal · 330 nodos |
| `22-reveal-new-variant-1440.png` | 1440 | scene=reveal-new-variant | fase reveal · 346 nodos |
| `22-reveal-new-variant-1024.png` | 1024 | scene=reveal-new-variant | fase reveal · 346 nodos |
| `22-reveal-new-variant-390.png` | 390 | scene=reveal-new-variant | fase reveal · 342 nodos |
| `23-reveal-same-twice-first-1440.png` | 1440 | scene=reveal-same-twice-first | fase reveal · 328 nodos |
| `23-reveal-same-twice-first-1024.png` | 1024 | scene=reveal-same-twice-first | fase reveal · 328 nodos |
| `23-reveal-same-twice-first-390.png` | 390 | scene=reveal-same-twice-first | fase reveal · 324 nodos |
| `24-reveal-same-twice-second-1440.png` | 1440 | scene=reveal-same-twice-second | fase reveal · 329 nodos |
| `24-reveal-same-twice-second-1024.png` | 1024 | scene=reveal-same-twice-second | fase reveal · 329 nodos |
| `24-reveal-same-twice-second-390.png` | 390 | scene=reveal-same-twice-second | fase reveal · 325 nodos |
| `25-reveal-serial-normal-1440.png` | 1440 | scene=reveal-serial-normal | fase reveal · 378 nodos |
| `25-reveal-serial-normal-1024.png` | 1024 | scene=reveal-serial-normal | fase reveal · 378 nodos |
| `25-reveal-serial-normal-390.png` | 390 | scene=reveal-serial-normal | fase reveal · 374 nodos |
| `26-reveal-serial-top100-1440.png` | 1440 | scene=reveal-serial-top100 | fase reveal · 381 nodos |
| `26-reveal-serial-top100-390.png` | 390 | scene=reveal-serial-top100 | fase reveal · 377 nodos |
| `27-reveal-serial-top10-1440.png` | 1440 | scene=reveal-serial-top10 | fase reveal · 383 nodos |
| `27-reveal-serial-top10-1024.png` | 1024 | scene=reveal-serial-top10 | fase reveal · 383 nodos |
| `27-reveal-serial-top10-390.png` | 390 | scene=reveal-serial-top10 | fase reveal · 379 nodos |
| `28-reveal-serial-one-1440.png` | 1440 | scene=reveal-serial-one | fase reveal · 385 nodos |
| `28-reveal-serial-one-1024.png` | 1024 | scene=reveal-serial-one | fase reveal · 385 nodos |
| `28-reveal-serial-one-390.png` | 390 | scene=reveal-serial-one | fase reveal · 381 nodos |
| `29-reveal-unknown-status-1440.png` | 1440 | scene=reveal-unknown-status | fase reveal · 385 nodos |
| `29-reveal-unknown-status-1024.png` | 1024 | scene=reveal-unknown-status | fase reveal · 385 nodos |
| `29-reveal-unknown-status-390.png` | 390 | scene=reveal-unknown-status | fase reveal · 381 nodos |
| `30-reveal-artwork-fallback-1440.png` | 1440 | scene=reveal-artwork-fallback | fase reveal · 349 nodos |
| `30-reveal-artwork-fallback-390.png` | 390 | scene=reveal-artwork-fallback | fase reveal · 345 nodos |
| `31-reveal-long-names-1440.png` | 1440 | scene=reveal-long-names | fase reveal · 327 nodos |
| `31-reveal-long-names-1024.png` | 1024 | scene=reveal-long-names | fase reveal · 327 nodos |
| `31-reveal-long-names-390.png` | 390 | scene=reveal-long-names | fase reveal · 323 nodos |
| `32-reveal-reduced-legendary-1440.png` | 1440 | scene=reveal-reduced-legendary · reduced-motion | fase reveal · 298 nodos |
| `32-reveal-reduced-legendary-1024.png` | 1024 | scene=reveal-reduced-legendary · reduced-motion | fase reveal · 298 nodos |
| `32-reveal-reduced-legendary-390.png` | 390 | scene=reveal-reduced-legendary · reduced-motion | fase reveal · 294 nodos |
| `33-reveal-reduced-back-1440.png` | 1440 | scene=reveal-reduced-back · reduced-motion | fase reveal · 288 nodos |
| `33-reveal-reduced-back-1024.png` | 1024 | scene=reveal-reduced-back · reduced-motion | fase reveal · 288 nodos |
| `33-reveal-reduced-back-390.png` | 390 | scene=reveal-reduced-back · reduced-motion | fase reveal · 284 nodos |
| `34-summary-mixed-1440.png` | 1440 | scene=summary-mixed | 5 cartas en el resumen · 618 nodos |
| `34-summary-mixed-1024.png` | 1024 | scene=summary-mixed | 5 cartas en el resumen · 618 nodos |
| `34-summary-mixed-390.png` | 390 | scene=summary-mixed | 5 cartas en el resumen · 614 nodos |
| `35-summary-all-new-1440.png` | 1440 | scene=summary-all-new | 5 cartas en el resumen · 629 nodos |
| `35-summary-all-new-1024.png` | 1024 | scene=summary-all-new | 5 cartas en el resumen · 629 nodos |
| `35-summary-all-new-390.png` | 390 | scene=summary-all-new | 5 cartas en el resumen · 625 nodos |
| `36-summary-all-duplicates-1440.png` | 1440 | scene=summary-all-duplicates | 5 cartas en el resumen · 585 nodos |
| `36-summary-all-duplicates-1024.png` | 1024 | scene=summary-all-duplicates | 5 cartas en el resumen · 585 nodos |
| `36-summary-all-duplicates-390.png` | 390 | scene=summary-all-duplicates | 5 cartas en el resumen · 581 nodos |
| `37-summary-same-twice-1440.png` | 1440 | scene=summary-same-twice | 5 cartas en el resumen · 617 nodos |
| `37-summary-same-twice-390.png` | 390 | scene=summary-same-twice | 5 cartas en el resumen · 613 nodos |
| `38-summary-first-legendary-1440.png` | 1440 | scene=summary-first-legendary | 5 cartas en el resumen · 629 nodos |
| `38-summary-first-legendary-1024.png` | 1024 | scene=summary-first-legendary | 5 cartas en el resumen · 629 nodos |
| `38-summary-first-legendary-390.png` | 390 | scene=summary-first-legendary | 5 cartas en el resumen · 625 nodos |
| `39-summary-serial-one-1440.png` | 1440 | scene=summary-serial-one | 4 cartas en el resumen · 573 nodos |
| `39-summary-serial-one-1024.png` | 1024 | scene=summary-serial-one | 4 cartas en el resumen · 573 nodos |
| `39-summary-serial-one-390.png` | 390 | scene=summary-serial-one | 4 cartas en el resumen · 569 nodos |
| `40-summary-set-complete-1440.png` | 1440 | scene=summary-set-complete | 3 cartas en el resumen · 481 nodos |
| `40-summary-set-complete-1024.png` | 1024 | scene=summary-set-complete | 3 cartas en el resumen · 481 nodos |
| `40-summary-set-complete-390.png` | 390 | scene=summary-set-complete | 3 cartas en el resumen · 477 nodos |
| `41-summary-open-another-1440.png` | 1440 | scene=summary-open-another | 5 cartas en el resumen · 619 nodos |
| `41-summary-open-another-1024.png` | 1024 | scene=summary-open-another | 5 cartas en el resumen · 619 nodos |
| `41-summary-open-another-390.png` | 390 | scene=summary-open-another | 5 cartas en el resumen · 615 nodos |
| `42-summary-inventory-1440.png` | 1440 | scene=summary-inventory | 5 cartas en el resumen · 618 nodos |
| `42-summary-inventory-390.png` | 390 | scene=summary-inventory | 5 cartas en el resumen · 614 nodos |
| `43-summary-no-more-1440.png` | 1440 | scene=summary-no-more | 5 cartas en el resumen · 629 nodos |
| `43-summary-no-more-1024.png` | 1024 | scene=summary-no-more | 5 cartas en el resumen · 629 nodos |
| `43-summary-no-more-390.png` | 390 | scene=summary-no-more | 5 cartas en el resumen · 625 nodos |
| `44-summary-recovered-1440.png` | 1440 | scene=summary-recovered | 5 cartas en el resumen · 619 nodos |
| `44-summary-recovered-1024.png` | 1024 | scene=summary-recovered | 5 cartas en el resumen · 619 nodos |
| `44-summary-recovered-390.png` | 390 | scene=summary-recovered | 5 cartas en el resumen · 615 nodos |
| `45-summary-repeated-1440.png` | 1440 | scene=summary-repeated | 5 cartas en el resumen · 619 nodos |
| `45-summary-repeated-390.png` | 390 | scene=summary-repeated | 5 cartas en el resumen · 615 nodos |
| `46-summary-collection-unavailable-1440.png` | 1440 | scene=summary-collection-unavailable | 5 cartas en el resumen · 584 nodos |
| `46-summary-collection-unavailable-1024.png` | 1024 | scene=summary-collection-unavailable | 5 cartas en el resumen · 584 nodos |
| `46-summary-collection-unavailable-390.png` | 390 | scene=summary-collection-unavailable | 5 cartas en el resumen · 580 nodos |
| `47-summary-long-names-1440.png` | 1440 | scene=summary-long-names | 3 cartas en el resumen · 478 nodos |
| `47-summary-long-names-1024.png` | 1024 | scene=summary-long-names | 3 cartas en el resumen · 478 nodos |
| `47-summary-long-names-390.png` | 390 | scene=summary-long-names | 3 cartas en el resumen · 474 nodos |
| `48-summary-reduced-1440.png` | 1440 | scene=summary-reduced · reduced-motion | 5 cartas en el resumen · 629 nodos |
| `48-summary-reduced-1024.png` | 1024 | scene=summary-reduced · reduced-motion | 5 cartas en el resumen · 629 nodos |
| `48-summary-reduced-390.png` | 390 | scene=summary-reduced · reduced-motion | 5 cartas en el resumen · 625 nodos |
| `49-status-recovering-1440.png` | 1440 | scene=status-recovering | estado recovering · 171 nodos |
| `49-status-recovering-1024.png` | 1024 | scene=status-recovering | estado recovering · 171 nodos |
| `49-status-recovering-390.png` | 390 | scene=status-recovering | estado recovering · 167 nodos |
| `50-status-network-error-1440.png` | 1440 | scene=status-network-error | estado error · 173 nodos |
| `50-status-network-error-1024.png` | 1024 | scene=status-network-error | estado error · 173 nodos |
| `50-status-network-error-390.png` | 390 | scene=status-network-error | estado error · 169 nodos |
| `51-status-server-error-1440.png` | 1440 | scene=status-server-error | estado error · 173 nodos |
| `51-status-server-error-1024.png` | 1024 | scene=status-server-error | estado error · 173 nodos |
| `51-status-server-error-390.png` | 390 | scene=status-server-error | estado error · 169 nodos |
| `52-status-already-opened-1440.png` | 1440 | scene=status-already-opened | estado no_pack · 173 nodos |
| `52-status-already-opened-1024.png` | 1024 | scene=status-already-opened | estado no_pack · 173 nodos |
| `52-status-already-opened-390.png` | 390 | scene=status-already-opened | estado no_pack · 169 nodos |
| `53-status-missing-1440.png` | 1440 | scene=status-missing | estado missing · 173 nodos |
| `53-status-missing-1024.png` | 1024 | scene=status-missing | estado missing · 173 nodos |
| `53-status-missing-390.png` | 390 | scene=status-missing | estado missing · 169 nodos |
| `54-status-unavailable-1440.png` | 1440 | scene=status-unavailable | estado unavailable · 173 nodos |
| `54-status-unavailable-390.png` | 390 | scene=status-unavailable | estado unavailable · 169 nodos |
| `55-status-not-found-1440.png` | 1440 | scene=status-not-found | estado not_found · 173 nodos |
| `55-status-not-found-390.png` | 390 | scene=status-not-found | estado not_found · 169 nodos |
| `56-status-offline-1440.png` | 1440 | scene=status-offline | estado error · 173 nodos |
| `56-status-offline-390.png` | 390 | scene=status-offline | estado error · 169 nodos |
| `57-summary-keyboard-focus-1440.png` | 1440 | scene=summary-mixed | foco en «Ver la carta Chronicle» · 5 cartas en el resumen · 618 nodos |
| `58-reveal-landscape-mobile-844x390.png` | 844 | scene=reveal-legendary · apaisado | fase reveal · 354 nodos |
| `59-summary-landscape-mobile-844x390.png` | 844 | scene=summary-mixed · apaisado | 5 cartas en el resumen · 616 nodos |
| `60-real-route-open-no-backend-1440.png` | 1440 | ruta real `/abrir/estandar` sin túnel (sin sesión: inventario local) | fase ready · 116 nodos |
| `60-real-route-open-no-backend-390.png` | 390 | ruta real `/abrir/estandar` sin túnel (sin sesión: inventario local) | fase ready · 116 nodos |
| `61-real-route-pack-not-found-1440.png` | 1440 | ruta real con un sobre inexistente | estado not_found · 81 nodos |

Capturas: 161. Con desbordamiento horizontal: 0. Con controles < 44 px: 0. Máximo de nodos DOM: 629. Errores de consola propios (sin 404 de fotos ni backend ausente): 0.
