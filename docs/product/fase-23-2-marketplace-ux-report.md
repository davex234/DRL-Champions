# FASE 23.2 — MARKETPLACE UX · Experiencia completa de mercado

**Estado:** completada · **Fecha:** 2026-09-13
**Rama:** `arch/stabilization` · **Sin commit/push/deploy** (cambios en árbol de trabajo)

> Completa la EXPERIENCIA del mercado entre jugadores construido en 23.1, dejándola lista
> para el día que Operaciones active `GLOBAL_MARKET_ENABLED`. **El interruptor NO se toca**,
> no hay bypass, y no se modifica backend, economía, ledger, seriales ni `marketReadiness.test.ts`.

---

## 1. Experiencia (qué se ha construido)

Sobre el `PlayerMarket` de la Fase 11/23.1 (escaparate + comprar + mis-ventas + historial +
`SellComposer`), se añade la capa de UX que faltaba, todo en cliente y sin tocar el servidor:

- **Ficha de detalle + compra** (`ListingDetail`, componente nuevo): carta grande, estadísticas,
  atributos, las **tres cifras** (precio / valor de mercado / valor de instancia), y la compra por
  pasos **ver → confirmar → resultado**.
- **Confirmación de compra** con saldo **antes y después**, saldo insuficiente detectado, sin
  compra optimista.
- **Éxito** («Carta adquirida» + Ver en colección / Volver) y **errores humanos** (sin stack traces).
- **Filtros de cliente** por rareza y media, sobre lo ya cargado (sin N+1), junto a los de
  servidor (región/orden/búsqueda) que ya existían.
- **Historial** con separación **Mis compras / Mis ventas** reutilizando los mismos trades.
- **Retirar con confirmación** (§21).
- **Mensaje de mercado cerrado** premium («abrirá próximamente»), microinteracciones con
  `reduced-motion`, y accesibilidad (diálogo, teclado, foco, 44 px).

## 2. Estado del feature flag

`GLOBAL_MARKET_ENABLED` **permanece en `false`, sin cambios**. No se pone en `true`, no se
mockea un mercado abierto, no se saltó el cierre ni se tocó `marketReadiness.test.ts`. Toda la
UX de compra/venta está **cableada pero desactivada por el flag** (botones visibles, en estado
desactivado con su motivo). El día que el flag sea `true`, la experiencia aparece completa sin
una segunda implementación (§6). Un test (`marketUx.test.tsx › NO BYPASS`) verifica que el CTA
de compra depende **solo** del flag y que no hay `= true`, `canBuy={true}` ni mock en el código.

## 3. Mercado (escaparate)

Vista pública como casa de transferencias: búsqueda (jugador/equipo, al servidor), filtros de
región (servidor) + **rareza y media (cliente, sin peticiones extra)**, orden
recientes/precio↑/precio↓/media, y una rejilla de cartas (`PlayerCard` + `Card3D`) con precio,
referencia y señal de si está por encima/por debajo. Cada carta es un **botón** que abre la
ficha; nunca muestra IDs internos, seller IDs ni datos privados. Cuando `GLOBAL_MARKET_ENABLED`
es `false`, arriba se anuncia que el mercado abrirá próximamente y la carta invita a «Ver carta ·
cerrado» — el escaparate sigue explorable, no una tienda falsa.

## 4. Detalle de listing (§7/§8)

`ListingDetail` es un **diálogo modal** (no una ruta nueva, para no tocar backend: no hay acción
«un listado» en el API y añadirla estaba fuera de alcance — deep-link queda como P2). Muestra:
carta grande, artwork, jugador, equipo, región, rareza, OVR, **estadísticas** (DMG/ACS/COM/HS/
AST/CLU), serial (`#12 / 500` cuando la variante es serializada), y las **tres cifras separadas**
(§22): **Precio de venta** (del listing real), **Valor de mercado** (`marketValue`) y **Valor de
instancia** (`instanceValue`). No recalcula fórmulas: llama a las del dominio. CTA **Comprar**
cuando el mercado está abierto; **No disponible · mercado cerrado** (desactivado) cuando no.

## 5. Compra (§9/§10/§11/§12)

Flujo por pasos, exclusivamente contra el endpoint existente (`buyFromMarket` → `/api/game/market`):

1. **Ver carta** (ficha).
2. **Comprar** → **Confirmar**: precio, tu saldo, saldo **después**; si no llega, botón bloqueado
   con «Créditos insuficientes».
3. **Comprar** (confirmar): botón `disabled` mientras la petición está en vuelo (**anti doble
   clic**, idempotencia también en el servidor); el precio es el del listing, **sin compra optimista**.
4. **Éxito**: «Carta adquirida» + precio + saldo actualizado + acciones (Ver en colección /
   Volver). La carta llega por `syncFromServer`; **no se crea una segunda instancia ni se cambia
   el serial** en el cliente.
5. **Fallo**: mensaje **humano** (el servicio ya traduce «ya no está disponible», «créditos
   insuficientes», etc.), anunciado con `role="alert"`; sin stack traces.

## 6. Mis ventas (§13)

`SellComposer` (23.1) para publicar, y debajo los listados en todos los estados reales —**En
venta / Vendida / Retirada / Caducada**— con su color y etiqueta. **Retirar** ahora pide
confirmación inline («¿Retirar del mercado?») antes de llamar al servidor; libera el `locked` y
no genera créditos ni instancias. No se inventan estados que el backend no tenga (§25).

## 7. Mis compras (§14)

El **Historial** gana un filtro segmentado **Todo / Mis compras / Mis ventas** sobre los mismos
`trades` (que salen de `transactions`, el registro real). **No se crea un segundo ledger** ni una
migración: es una vista del historial que ya existía.

## 8. Filtros / búsqueda / ordenación (§15/16/17)

- **Búsqueda** por jugador/equipo (al servidor, `browse`); volumen actual pequeño, sin request
  por tecla.
- **Filtros**: región (servidor) + rareza y media (cliente, sobre lo cargado). Rareza
  **data-driven** (de las variantes presentes, ordenadas por rango): no inventa rarezas ni se
  queda obsoleta. **Sin N+1**.
- **Orden**: recientes / precio↑ / precio↓ / media.
- **Paginación** (§18): el volumen actual no la requiere; el `browse` ya limita a 60 y la rejilla
  crece sola. No se añade infraestructura innecesaria; queda como P2 si el mercado crece.

## 9. Resultado de validación REAL (§33)

Navegador real (`next start`, `/mercado`, 1440 y ~555 px):
- La página **carga sin errores de consola** y renderiza el mercado (cabecera premium, cartas,
  filtros, búsqueda).
- **Responsive**: a ~555 px las cartas se apilan a 2 columnas, **sin overflow horizontal**.
- **Regresión** (§34): `/coleccion`, `/inventario`, `/packs`, `/duelos`, `/progresion`, `/tienda`
  responden 200.

**Limitación honesta (documentada, no un defecto):** el mercado entre jugadores es
server-authoritative y su pestaña **«Global» solo se muestra con usuario autenticado**
(`online = isSupabaseConfigured() && !!user`). En esta máquina el **Supabase local está caído**
(Docker desinstalado), así que no hay sesión y no se puede abrir la pestaña Global en vivo; y,
aunque la hubiera, el mercado está **cerrado por bandera**, así que comprar/publicar están
desactivados por diseño. Conforme a §33, **no se cambió el flag** para fingir una compra. La UX
nueva (ficha de detalle, confirmación, saldo antes/después, éxito/error, filtros cliente,
historial de compras/ventas, mercado cerrado, reduced-motion, accesibilidad) queda validada por
**15 pruebas** que se ejecutan sin backend (render + invariantes de código), más `typecheck` y
`build`. La transferencia atómica, idempotencia, concurrencia y conservación de serial/versión
siguen cubiertas por el servidor (0020) y `economy:verify` (que requiere Supabase vivo).

## 10. Tests (§32)

Nuevo `src/components/market/marketUx.test.tsx` — **15 pruebas**: mercado cerrado, no-bypass del
flag, CTA desactivado sin compra falsa, ficha de detalle, tres cifras (precio real), confirmación
con saldo antes/después sin compra optimista, saldo insuficiente, anti doble clic, éxito sin
segunda instancia, error humano con `role="alert"`, filtros cliente sin N+1, historial
compras/ventas, cancelar con confirmación, reduced-motion, accesibilidad (diálogo/teclado/foco).

Mapa §32 → cobertura: 1 (cerrado), 2/20 (flag/no-bypass), 3 (Global solo autenticado), 4
(detalle), 5/6/7 (filtros/búsqueda/orden), 8/9/10 (compra/confirmación/doble clic), 11/12/25
(estados de listing: `statusLabel`), 13 (mis ventas + `SellComposer` de 23.1), 14 (mis compras),
15/23 (comisión real: `SellComposer` + valor de mercado), 16/22 (precio real, tres cifras), 17
(serial: misma fila, sin remint — 23.1 + servidor), 18 (reduced-motion), 19 (responsive).

**Ejecución:**
- `npm test` → **968/968** ✓ (953 previos + 15 nuevos)
- `typecheck` ✓ · `build` ✓ (`/mercado` compila) · `security:verify` ✓ · `pack:verify` ✓ ·
  `content:verify` ✓ · `distribution:verify` ✓ (30/0)

**No se modificó ningún test existente para forzar verde** (§32). No se tocó
`marketReadiness.test.ts` ni el interruptor que protege.

## 11. Seguridad (§30)

Nada de autoridad en el frontend: propietario, precio, listado, saldo, estado, concurrencia e
idempotencia los sigue validando el servidor (0020). La ficha pinta el `ListingView` resuelto y
compra por el único endpoint; el «después» es solo presentación (saldo − precio del listing). No
se toca el modelo de seguridad.

## 12. P2 reales restantes

- **Abrir el mercado**: decisión de Operaciones (criterio 10, masa de jugadores). Al cumplirse,
  `GLOBAL_MARKET_ENABLED = true` activa toda esta UX sin más trabajo.
- **Validación viva del flujo de compra** (dos cuentas, mercado abierto): pendiente de entorno con
  Supabase operativo.
- **Ruta de detalle deep-linkable** `/mercado/:listingId`: hoy es un modal; una ruta propia
  requeriría una acción «un listado» en el API (fuera de alcance: no tocar backend).
- **Paginación real**: innecesaria al volumen actual; prevista para cuando crezca.
- **Gráfica de precio / ofertas**: existen componentes legados (`PriceChart`, `OfferPanel`,
  `OnlineCardDetail`) atados al camino revocado 0004; su reintegración al camino seguro es P2.

## 13. Archivos modificados

- `src/components/market/ListingDetail.tsx` — **(nuevo)** ficha de detalle + compra por pasos.
- `src/components/market/PlayerMarket.tsx` — **(modificado)** ficha abrible desde la rejilla,
  filtros de rareza/media, historial compras/ventas, retirar con confirmación, banner de cierre
  premium; expone la compra a la ficha (`buyListing`). Sin tocar el camino de servidor.
- `src/components/market/marketUx.test.tsx` — **(nuevo)** 15 pruebas de la experiencia.
- `docs/product/fase-23-2-marketplace-ux-report.md` — **(nuevo)** este informe.

Sin `git commit`, sin `push`, sin `deploy`. Cambios en el árbol de trabajo.
