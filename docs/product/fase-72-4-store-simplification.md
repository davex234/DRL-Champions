# F72.4 · Store Simplification — visual first, details on purchase

Fecha: 2026-09-29 · Sin migración (cabeza `0058_hardening_grants`) · Sin commit, push ni deploy. Evidencia: `docs/product/qa/fase72-4/`.

## Arquitectura (real, no CSS)

```
CATÁLOGO (OfferCard: arte · nombre · precio · COMPRAR)
   └─ COMPRAR = onSelect(product)  → no compra
DETALLE (PurchaseDetails): imagen grande, contenido, PROBABILIDADES (productOdds), precio, saldo → después
   └─ «Confirmar compra · N» = onConfirm → buyPackOnline → /api/game/packs → app_buy_pack (servidor)
```

- **Una sola tarjeta** (`OfferCard` en `StoreProducts.tsx`) para las cuatro clases reales de producto (`PACK`, `BOX`, `CARD`, `BUNDLE`);
  cada clase solo aporta su arte. La información no se oculta con CSS: **ya no se renderiza** en la tarjeta. Un sobre publicado desde el
  panel (`applyRuntimePacks` → `resolveAll`) adopta tarjeta y detalle sin tocar el frontend (test S5, con un clon de plantilla de clase y
  otro de rareza).
- **Precio de tarjeta** (`catalogPrice`): uno solo — créditos si el producto los acepta con precio; si no, euros con precio; si no, «Precio
  por anunciar». Los precios salen del mismo `ResolvedProduct` (PackDef / configuración); no se tocó ninguno.
- **Probabilidades** (`productOdds` → `packOddsFor(pack, packStats(pack.id), equipo)`, la MISMA llamada que `/packs/[packId]`):
  - Línea principal (Bronce, Plata, Oro, Masters, Champions, Icon + clones CMS por alias): `mainPackDistribution`, la tabla con la que
    `openPack` sortea cada hueco → porcentaje exacto.
  - Resto (regionales, equipos, EWC): el motor sortea por pesos + pool + garantía + pity y no declara «X %»; se enseña el reparto
    **medido** con el motor real (`PACK_STATS`, 20.000 aperturas, revalidado por `packStats.test`), rotulado como tal.
  - Sobre Inicial (sin medición): pesos declarados normalizados (misma rama de `packOddsFor`).
- Caja: la tabla de su sobre. Pack: una tabla por tipo de sobre que entrega. Carta: edición, rareza, OVR, equipo y rol (solo en el detalle).

## Qué salió del catálogo

Categoría y nº de cartas; las 7 líneas de % (o las rarezas posibles); la placa «€ · Por anunciar»; el contenido de cajas («10 × Sobre … ·
50 cartas», «Se guardan sin abrir») y de packs (tagline + lista); edición · rareza · equipo de las cartas; «Comprar o abrir»/«Ver detalles».
Todo sigue en el detalle, antes de confirmar. Insignias (Destacado, Nuevo, Próximamente, N sin abrir): fichas pequeñas sobre el arte.
Héroe Champions S: se quitan la línea «edición · rareza · N cartas» (repetía el título), el párrafo de descripción y el pie decorativo;
quedan arte, «Destacado», título, subtítulo y CTA. La configuración (`storeCatalog.ts`) no cambia.

Antes/después medido a 1440 (Sobre Bronce): tarjeta 425 px con el arte a 176 px (41 %) y ~25 palabras → arte 64–69 % de la tarjeta y
≤ 9 palabras («SOBRE BRONCE 1.000 COMPRAR» + insignia). Sobres a la vista sin desplegar: 4 → 8. Móvil: rejilla de 2 columnas (antes
carrusel horizontal).

## Defectos encontrados y corregidos en la QA real

1. Arte recortado (sobres cortados abajo; la carta perdía la fila de stats): la zona de arte era grid con fila `auto` y el `h-full` no
   resolvía → flex con altura fija; nuevo check «arte entero, sin recortar».
2. «SOBRE CHAMPIO…» cortado en 390 → nombre hasta 2 líneas con hueco fijo en móvil; check «ningún nombre cortado».
3. Detalle más alto que la pantalla desbordaba HACIA ARRIBA (fuera de alcance) con `place-items-center` → centrado con `m-auto`.
4. Al abrir, el foco en «Cancelar» desplazaba el detalle hasta los botones y el jugador saltaba las probabilidades → `focus({ preventScroll })`
   y el detalle empieza arriba.
5. El detalle de un pack no tenía imagen (ya en F49) → `BundleArt` compartido entre tarjeta y detalle.

## Compra real (QA D, 1440)

7.430 → abrir detalle (odds 7 filas, 7.430 → 6.430) → Cancelar → 7.430 intacto → reabrir → 2 clics + dblclick + Enter ×4 sobre
«Confirmar compra» → **un** cargo: 6.430, Sobre Bronce 0 → 1 → recarga: 6.430 y «1 sin abrir» en API y página. Una segunda pasada
tras corregir el instrumento: 6.430 → 5.430, 1 → 2 (7/7). Las compras son reales y se conservan (cuenta QA, economía sin tocar).
`gate:browser` compró además un Bronce con su propia cuenta QA (3.490 → 2.490). Protección: `inFlight` + clave de gesto por apertura
(F68) en el cliente y deduplicación `economy_ops` en el servidor, sin cambios.

## Pruebas

- Nuevo `src/components/store/f724.storeSimplification.test.tsx` (S1–S5): tarjeta mínima de TODOS los productos; COMPRAR no compra;
  contrato UI ≡ servidor para cada sobre vendido (también en cajas y packs); el `openPack` real (6 sobres × 1.500 aperturas) reproduce la
  tabla de la UI a ±2,5 pp; detalle completo; CMS.
- `store.contract.test.tsx`: SOBRE/CAJA/PACK/PRECIOS reescritos a la nueva invariante (fijaban justo la información que sale).
- `scripts/ops/browser-gate.ts`: acepta «Confirmar compra ·» (el `aria-label` «Comprar Sobre Bronce» no cambia).
- Suite 5.542/5.542 · tsc web+scripts 0 · lint 0 errores · build `drl-0.1.1-1-c641ce42` (supervisor F70.2) · smoke 74/74 ·
  production:check 17/0/0 · gate:browser 56/56 · QA real `_f724-qa.ts after` 93/93 (1440/1024/390) · `buy` 7/7 · health 200 · ready 0058.

## Ficheros

Nuevos: `src/components/store/f724.storeSimplification.test.tsx`, `scripts/_f724-{qa,evidence}.ts`, `docs/product/qa/fase72-4/*`, este
informe. Modificados: `src/components/store/{StoreProducts,PurchaseModal,StoreHero}.tsx`, `src/components/store/{storeView,storeClasses}.ts`,
`src/components/store/store.contract.test.tsx`, `src/app/tienda/{page.tsx,store.css}`, `scripts/ops/browser-gate.ts`.

F72.4 — CERRADA (GO)
