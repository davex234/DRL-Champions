# Limpieza global de cartas — CARD ART = CARD VISUAL · Informe

Fecha: 2026-09-22 · Sin commit, sin push, sin deploy.

## 1. Baseline real
`npm test` antes de tocar nada: **4628/4628** (el 4613 anterior + 15 de NEXUS Arena).

## 2. Renderizadores de carta encontrados
- Imagen del catálogo: `cards/CardVisual.tsx` (`CardFace`, por el que pasan `PlayerCard` y todo `CardVisual`), `cards/CardThumb.tsx`, `cards/CardViewer.tsx` (vía `CardFace`), `duel/DuelCard.tsx`, y `<img>` directas en `store/StoreProducts`, `StoreHero` y `PurchaseModal`.
- Envoltorios: `visual/Card3D.tsx` (rejillas, sobres, mazos, draft, vitrinas…), fichas del editor de mazos (`duel/deck/CollectionPanel`), casillas del draft (`draft/DraftCards`), selector de vitrina (`player/ShowcaseEditor`), marco del serial #1 en la revelación (`packs/CardReveal`), auras del duelo (`duel/MatchBoard`, `duel/DuelMoment`).
- Consumidores revisados (más de 40): colección/álbum, inventario, detalle, comparador, sobres y resumen, tienda, mazos (hub, tablero, colección, hoja de hueco, comparador), draft, Road to Champions (preparación), arena (mano, duelo, filas jugadas, revelación, resultado, repetición), vestíbulo y escaparates, perfil y vitrina, mercado (cerrado), forja, misiones del recorrido.
- Fuera por ser fotos de jugador y no cartas: Tactical Coach (no se toca), retransmisión y revisión del admin.

## 3. Regla canónica
`src/components/cards/CardArt.tsx` + regla global `.nx-card-art` en `globals.css`: `<img>` con las medidas reales del WebP (750×1048), `object-contain`, sin fondo, borde, radio ni sombra de caja. La profundidad y los estados van en `cardArtFilter` con `drop-shadow` sobre la silueta (sombra en reposo o levantada, halo de selección o rareza, apagado por filtro). `CardFace`, `CardThumb` y `DuelCard` la usan; la tienda lleva la misma marca. El contrato `cards/cardArt.contract.test.tsx` barre `src` y falla si alguna `<img>` de carta nueva no pasa por la regla.

## 4. Marcos y fondos eliminados
- `CardFace`: chaflán `nx-clip` (recortaba las esquinas del asset) y `shadow-card` (rectángulo alrededor del margen transparente).
- `CardThumb`: borde del color de la rareza, `rounded-md` y recorte.
- `DuelCard`: `border-2` de la paleta, fondo de la paleta, `rounded-xl` + recorte, anillo de selección `ring-2` y velo rectangular de «Usada».
- `Card3D`: filo interior del color de la rareza, brillo especular rectangular (`mix-blend`), halo legendario con `box-shadow` y barrido, anillo de selección, velo oscuro de bloqueada y sombra en mancha, sustituidos por un único filtro de silueta. Se mantienen los cuños «Nueva», «×n» y el candado, que son indicadores.
- Arena y revelación: auras con `box-shadow` en caja, ahora `glow` sobre la silueta.
- Editor de mazos: anillo dorado de «en el equipo», ahora halo dorado sobre la silueta.
- Draft: casilla con carta sin borde ni fondo (la casilla vacía o actual conserva su diseño).
- Vitrina: ficha del selector sin caja; la elegida brilla sobre su silueta.
- Sobre, serial #1: marco con borde y sombra de caja, ahora luz dorada radial detrás.

## 5–13. Por zona
Arena: mano, duelo, filas jugadas, revelación y resultado sin cajas; aura roja o cian sobre la silueta. Colección y álbum: rejilla, carta. Sobres: revelación y resumen limpios. Mazos: colección, tablero y comparador limpios. Tienda: ya era correcta; se marcó con la regla. Road to Champions: preparación limpia. Draft: opciones y plantilla limpias. Detalle y comparador: asset limpio. Móvil: comprobado en arena, álbum, sobres, campaña, draft y tienda.

## 14. Capturas
`docs/product/qa/card-cleanup/before/` (21, build anterior) y `after/` (40). Comparaciones lado a lado en `compare/`, entre ellas `jinggg-mada-marteen.jpg` (mano y fila jugada de la arena, ampliadas).

## 15. Assets intactos
331 WebP en `public/cards`, ninguno modificado después de empezar este trabajo; no se recortó, regeneró ni reexportó nada.

## 16. Catálogo
331 cartas; catálogo, IDs, estadísticas y roles sin tocar.

## 17–20. Comprobaciones
Tests **4638/4638** (+10 del contrato) · typecheck web + scripts **PASS** · lint **0 errores** (28 avisos preexistentes) · build **PASS**.

## 21. Archivos
Nuevos: `components/cards/CardArt.tsx`, `components/cards/cardArt.contract.test.tsx`, este informe, `docs/product/qa/card-cleanup/**`.
Modificados: `app/globals.css` (+16 líneas al final), `components/cards/{CardVisual,CardThumb}.tsx`, `components/cards/cardVisual.test.tsx` (contrato de medidas actualizado a 750×1048 y `object-contain`), `components/visual/Card3D.tsx`, `components/duel/{DuelCard,MatchBoard,DuelMoment}.tsx`, `components/packs/CardReveal.tsx`, `components/duel/deck/CollectionPanel.tsx`, `components/draft/DraftCards.tsx`, `components/player/ShowcaseEditor.tsx`, `components/store/{StoreProducts,StoreHero,PurchaseModal}.tsx`, `scripts/_fase50-shots.ts` (opciones `--param` y `--scroll-grid`).

## Deudas vistas y no arregladas
- Los arneses `/design-system/fase37?scene=compare-two` y `fase38?scene=reveal-serial-one` ya fallaban antes de este cambio (fixtures anteriores al reemplazo del catálogo), con el mismo error de consola antes y después.
- Las cartas de duelo conservan la tira del trío de combate (SH/GS/EF) sobre el borde inferior: es información de juego que la carta impresa no trae.

## 22. GO / NO-GO
**GO.**
