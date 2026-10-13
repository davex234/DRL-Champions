# FASE 21.1 — CATÁLOGO DE PACKS

**Estado: catálogo funcional entregado.** Sección `/packs` de descubrimiento visual + ficha
`/packs/:packId`, conectadas al flujo de compra existente. Sin tocar motor, probabilidades, pools,
economía ni datos de usuario. `npm test` 904/904, typecheck, build y verifiers en verde.
Validación visual real en navegador incluida.

## Objetivo
Construir una experiencia de catálogo de sobres —real, visual y jugable— usando **los packs que
ya existen**, con la fuente de verdad en el backend y sin duplicar su lógica en frontend.

## Arquitectura utilizada
Todo se DERIVA de lo existente; no hay una segunda fuente de verdad:
- **Catálogo/precios/lifecycle/probabilidades:** `PACKS` (`data/packs`), `isStoreVisible`
  (`domain/packs/lifecycle`, autoridad de ciclo de vida de la Fase 20.4), `packIdentity`
  (categoría/artwork/monograma), `packStats` (reparto medido) y `teamCardCount`.
- **Compra:** el mismo camino que la tienda — con sesión el servidor cobra y valida
  (`buyPackOnline` → RPC), sin ella la economía local (`useGameStore.buyPack`) — centralizado en
  un hook reutilizable, **sin lógica económica nueva**.
- Una capa de presentación pura y testeable (`packCatalog.ts`) agrupa por pestaña; **no define
  ninguna regla**: solo lee y etiqueta.

## Pantallas
- **`/packs`** — catálogo: cabecera, pestañas de categoría (Todos · Rareza · Regiones · Equipos ·
  Eventos, solo las que tienen contenido), y rejilla responsive de cards grandes por grupo.
- **`/packs/:packId`** — ficha: artwork grande, categoría, nombre, descripción, precio, nº de
  cartas, tu saldo, **reparto de rareza real** (barra + leyenda), nota de equipo (probabilidad sin
  garantía) para Team Packs, y CTA. Estados «no encontrado» / «no disponible» a pantalla completa.

## Componentes principales
| fichero | rol |
|---|---|
| `src/components/packs/packCatalog.ts` | modelo de presentación puro (pestañas, visibilidad, CTA-kind) |
| `src/components/packs/PackCatalogCard.tsx` | card visual del catálogo (artwork, nombre, categoría, precio, CTA) |
| `src/lib/game/usePackPurchase.ts` | hook de compra reutilizable (mismo flujo que la tienda) |
| `src/app/packs/page.tsx` | pantalla de catálogo con pestañas + rejilla |
| `src/app/packs/[packId]/page.tsx` | ficha de detalle + CTA + estados |
| `src/design/nav.ts` | +item «Catálogo de sobres» → `/packs` en la sección Tienda |

Reutiliza `SealedPack` (artwork/dibujo procedimental), `Badge`, `Readout`, `NxButton`, `Toast`,
`HydrationGate` (design system existente). **No** se crearon componentes visuales de cero para el
objeto del sobre ni para la apertura.

## Fuente de datos / lifecycle
La visibilidad la decide **exclusivamente** `isStoreVisible` (solo `ACTIVE`), la misma autoridad
que aplica el servidor en `buyPack`/`openPackForUser` (Fase 20.4). El frontend **oculta/representa**
estados, pero la protección real sigue siendo server-side:
- **ACTIVE:** visible, con CTA de compra/apertura por el flujo real.
- **DRAFT:** no aparece en catálogo; su ficha directa muestra «Sobre no disponible» sin revelar
  contenido; comprarlo/abrirlo lo **rechaza el servidor** (404) — no lo replica el frontend.
- **RETIRED:** no aparece como comprable (queda fuera de `isStoreVisible`).
Nada hardcodeado: precio, cartas, categoría y reparto salen del PackDef/packStats.

## Integración con compra
El CTA de la ficha usa `usePackPurchase` → `buyPackOnline` (servidor) o `useGameStore.buyPack`
(local), y luego enruta a `/abrir/:packId` (la ceremonia de apertura existente). Respeta saldo,
ledger, idempotencia, lifecycle y errores del servidor. **No** hay descuento de créditos en
frontend ni sistema de compra paralelo. Los sobres de **evento** no se compran aquí: su CTA lleva
al Centro de Eventos, igual que la tienda.

## Estados de error
- **Saldo insuficiente:** CTA deshabilitado + «Te faltan N créditos» + enlace a DRL Credits.
- **Pack no disponible (DRAFT/RETIRED):** pantalla «Sobre no disponible».
- **Pack no encontrado:** pantalla «Sobre no encontrado».
- **Error de red / servidor / no autenticado:** el mensaje del servidor se muestra en un `Toast`
  natural (nunca un stack trace); la ruta online captura y traduce el error.

## Team Heretics
Aparece correctamente en la pestaña **Equipos** (junto a Fnatic, NAVI, G2 — los 4 Team Packs
ACTIVE) usando el producto existente `team-heretics`; **no se creó un segundo Team Pack ni se tocó
su pool**. Su ficha muestra: categoría EQUIPO · TH, precio 3.000, 5 cartas, reparto real
35/40/18/6/1 y la nota «11 cartas de Team Heretics… más probables… no están garantizadas». Sirve
de referencia visual de calidad. Los 15 Team Packs DRAFT (Olas 1–3) **no** aparecen.

## Responsive
Rejilla `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` (2 columnas en móvil → 4 en desktop), cabecera
y pestañas con `flex-wrap`, ficha en una columna en móvil y dos en `md`. Gutter lateral constante.
Desktop es la experiencia principal, verificado en navegador a 1440.

## Tests
- **Nuevos:** `src/components/packs/packCatalog.test.ts` — 7 tests cubriendo lo pedido:
  1. ACTIVE aparece · 2. DRAFT no se filtra · 3. RETIRED no comprable · 4. precio = backend ·
  5. CTA por tipo (evento/gratis/compra) · 6. no-visible/ inexistente distinguido · 7. Team Heretics
  en Equipos y ACTIVE + categorías cubren lo visible.
- **Suite:** `npm test` **904/904** ✅ · `typecheck` ✅ · `build` ✅ (rutas `/packs` y
  `/packs/[packId]` registradas) · `security:verify` ✅ · `pack:verify` ✅ · `content:verify` ✅ ·
  `distribution:verify` ✅ (30/0).
- No se modificó ningún test existente para forzar verde.

## Validación visual (navegador real, `next start` a 1440)
- **`/packs`**: cabecera «Sobres», pestañas, sección Rareza (Inicial gratis/Estándar/Premium/Icon
  con artwork, precios, badges «sin abrir», CTAs) y Regiones. ✅
- **Pestaña Equipos**: los **4 Team Packs ACTIVE** (Team Heretics TH, Fnatic FNC, NAVI, G2); los
  DRAFT **no** aparecen. ✅
- **`/packs/team-heretics`**: ficha completa (identidad, precio, cartas, reparto real, nota de
  equipo, CTA «Comprar y abrir»). ✅
- **`/packs/team-loud` (DRAFT)**: «Sobre no disponible» — no se filtra contenido. ✅
- Capturas guardadas en el scratchpad de la sesión.

## Cambios realizados
5 ficheros nuevos (`packCatalog.ts`, `packCatalog.test.ts`, `PackCatalogCard.tsx`,
`usePackPurchase.ts`, `app/packs/page.tsx`, `app/packs/[packId]/page.tsx`) + 1 línea de navegación
(`design/nav.ts`). **Ningún** cambio en motor, pools, probabilidades, economía, cartas o datos de
usuario.

## Cambios NO realizados
Sin tocar: pack draw engine, RNG, probabilidades, pools, minting, `user_cards`, `card_mints`,
market, mastery, combat, PvP, trainer, Pick'ems, economía global, roster, `teamIdentities`. No se
resolvieron los 6 Team Packs BLOCKED, no se modificó Fnatic ni Leviatán, no se creó Ola 4, no se
generó artwork, no se modificó `CardVisual`/assets. La tienda existente (`/tienda`) queda intacta.
Sin commit/push/deploy.

## P2 reales restantes
- **Rareza declarada sin cartas:** algunos Team Packs ACTIVE (G2, NAVI) y varios regionales
  declaran rarezas que su plantilla no tiene; la ficha lo **advierte con honestidad**
  («No contiene …», vía `packStats.impossible`) — comportamiento existente, no corregido aquí.
- **Artwork de Team Packs:** los 4 ACTIVE usan monograma (TH/FNC/NAVI/G2), pendientes del logo
  oficial (deuda de la Fase 20.1). El catálogo los pinta correctamente con ese respaldo.
- **Captura responsive:** el `next start` renderizó a 1440; la verificación a 390 px depende de las
  clases responsive (2 columnas en móvil), correctas en el build. Screenshot a ancho estrecho no
  capturado por limitación del viewport de la extensión.

## Estado final
Catálogo de Packs funcional: ACTIVE visible y comprable por el flujo real, DRAFT/RETIRED sin
filtrarse, Team Heretics correcto, categorías operativas, ficha de detalle con CTA conectado,
responsive, sin duplicar backend ni alterar probabilidades/pools/economía. Tests verdes y
validación visual realizada.
