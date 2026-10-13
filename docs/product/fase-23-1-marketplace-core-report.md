# FASE 23.1 — MARKETPLACE CORE · Mercado entre jugadores

**Estado:** completada (se cierra el hueco de UI que faltaba; el bucle queda cableado de
extremo a extremo) · **Fecha:** 2026-09-13
**Rama:** `arch/stabilization` · **Sin commit/push/deploy** (cambios en árbol de trabajo)

> El bucle objetivo — PACK → CARTA → COLECCIÓN → DUPLICADA → **VENDER** → DRL CREDITS →
> **COMPRAR** → COLECCIÓN — ya estaba construido en su totalidad en el servidor y la base de
> datos, y casi entero en la UI. **Le faltaba una sola puerta: publicar una carta.** Esta
> fase la añade, encima de lo existente, sin sistema nuevo.

---

## 1. Qué se ha construido

Un **compositor de venta** para el mercado entre jugadores (`SellComposer`, dentro de
`PlayerMarket`): elegir una repetida propia, ponerle precio, ver la comisión y el neto, y
publicarla. Es el único eslabón de UI que le faltaba al bucle. Se apoya al 100 % en la
infraestructura ya existente (RPC, libro mayor, idempotencia, banda de precio, RLS).

**No** se ha creado: ni un segundo inventario, ni una segunda economía, ni un segundo sistema
de seriales, ni una fórmula de precio paralela, ni una comisión nueva. **No** se ha tocado
RNG, motor de packs, combate/PvP, Pick'ems ni Trainer. **No** se ha introducido dinero real.
**No** se ha flipado el interruptor del mercado (ver §5).

## 2. Arquitectura reutilizada (auditoría previa)

| Capa | Dónde | Estado encontrado |
|---|---|---|
| RPC de propiedad y dinero | `supabase/migrations/0020_marketplace_v2.sql` (`app_market_list/buy/cancel/expire`) | ✅ completo |
| Servicio de servidor | `src/server/services/market.ts` | ✅ completo |
| Endpoint autoritativo | `src/app/api/game/market/route.ts` (`config/browse/mine/trades/list/cancel/buy`) | ✅ completo |
| Cliente seguro (Fase 11) | `src/lib/game/market.ts` (`/api/game/market` + token + gesto idempotente) | ✅ completo |
| Escaparate / comprar / mis ventas / historial | `src/components/market/PlayerMarket.tsx` | ✅ existían; **faltaba publicar** |
| Valor de referencia | `src/domain/economy/pricing.ts` (`marketValue`, `instanceValue`) | ✅ reutilizado, no recalculado |
| Libro mayor | `_ledger_apply` + `transactions` + `economy_ops` | ✅ reutilizado |
| Interruptor de apertura | `src/config/features.ts` (`GLOBAL_MARKET_ENABLED = false`) + `marketReadiness.ts` | ✅ respetado |

**Tres caminos históricos del mercado, entendidos y respetados:**
- **0004** — mercado directo desde el navegador (`deposit_card`/`create_listing`/`buy_listing`). Inseguro (SEC‑01).
- **0010 (lockdown)** — revoca esas RPC al cliente; el camino legado (`lib/supabase/market.ts`) queda muerto (403). **No se reutiliza.**
- **0020 (Fase 11)** — reconstrucción server‑authoritative (`app_market_*`), la única sobre la que se ha construido.

## 3. Creación de listings (lo nuevo)

`SellComposer` (en `PlayerMarket.tsx`, pestaña **«Mis ventas»**):
- Ofrece **solo las repetidas propias**, derivadas de `ownedCards`/`lockedUids` (que rellena
  `syncFromServer` desde el servidor) con el selector `duplicates()` — el mismo criterio que
  el desguace: se conserva un ejemplar de cada carta. **No hay segundo inventario.**
- **Excluye por partida doble** las cartas retenidas (`lockedUids`) y las ya publicadas
  (tus listados activos), así una carta recién publicada desaparece del formulario aunque el
  estado tarde en sincronizar.
- El precio parte de `marketValue(def)` (el mismo ancla que enseña el escaparate) y exige el
  suelo del mercado; **la banda real y la posesión las valida el servidor** (`_market_check_band`,
  `for update` sobre `user_cards`). El cliente no decide precio, dueño ni disponibilidad.
- Envía **solo `uid` + precio** por `listCardOnMarket` → `/api/game/market` `action:"list"`.
- Muestra la **comisión (5 %) y el neto** — a diferencia del `SellPanel` del mercado local,
  que por diseño no cobra; esconderla aquí sería mentir sobre lo que se cobra.

Antes de publicar, el servidor comprueba: posesión (`user_cards.user_id`), que no esté ya
retenida (`locked`), banda de precio, suelo, techo y límite de frecuencia. **El depósito es
un bloqueo, no un traslado:** la carta se marca `locked=true` y sigue en tu colección.

## 4. Compra / transferencia (ya existente, verificado)

`buyFromMarket` → `app_market_buy`: `select … for update` sobre el listado (candado de
concurrencia), transferencia atómica de propiedad (`update user_cards set user_id …`),
cobro/abono por `_ledger_apply`, marca `sold`, asiento en `transactions`, idempotencia por
`economy_ops`. La carta cambia de dueño **conservando `uid`, `serial` y `minted_version`**
(no hay remint). El comprador recibe **la misma instancia**.

## 5. Economía / ledger / idempotencia — y el interruptor

- **Ledger único:** toda operación pasa por `_ledger_apply` (tres asientos por venta:
  transfer_out comprador, transfer_in vendedor, comisión). El historial (`transactions`)
  distingue compra/venta. **No se ha creado un segundo ledger.**
- **Idempotencia:** publicar y comprar llevan clave de gesto (`newGesture()` en el cliente,
  `economy_ops` en la RPC): doble clic / reintento / refresh producen un único resultado.
- **Comisión:** la del sistema (5 %, `market_config.tax_bps`). **No se ha inventado ninguna.**
- **Venta rápida (§6):** NEXUS ya tiene **desguace** server‑side (`/lib/game/economy`,
  `fetchSalvagePreview`/`salvage`), anclado al **precio del sobre**, no al valor de mercado.
  Es deliberado: el valor de mercado de lo que sale de un sobre está 7–15× por encima de su
  coste (`economy.md` §6), así que pagar el 80 % del valor de mercado (lo que sugería §6)
  **convertiría la tienda en una impresora de dinero**. Por eso **NO se implementa** el quick
  sell del 80 %: el desguace existente ES la venta rápida y encaja limpiamente; el otro no.
- **El interruptor NO se ha flipado.** `GLOBAL_MARKET_ENABLED = false` está gobernado por
  `marketReadiness.ts`: **9 de 10 criterios de apertura se cumplen**; el único que falta —
  criterio 10, **masa de jugadores para descubrir precios**— **no es técnico** y no se puede
  resolver desde el repositorio (necesita telemetría de producción). Veredicto documentado:
  **«NO ABRIR TODAVÍA»**. Además, `marketReadiness.test.ts` es un **cerrojo**: si el
  interruptor estuviera en `true` con un criterio `unknown`, `npm test` cae. Flipar el flag
  habría exigido tocar ese test para forzar verde, algo que §32 prohíbe explícitamente. Por
  eso el bucle queda **cableado y listo**, y comprar/publicar están **desactivados con su
  motivo escrito** (simétrico al botón de comprar) hasta que Operaciones abra el mercado — un
  cambio de una línea el día que el criterio 10 se cumpla.

## 6. Filtros / búsqueda / ordenación (ya existentes)

Escaparate (`PlayerMarket`): búsqueda por jugador/equipo (filtrado en cliente, sin request
por tecla), filtro por región, orden recientes/precio↑/precio↓/media. El precio y el orden
por precio los aplica la base de datos; región/media/nombre se filtran en Node sobre el
catálogo (documentado como lo primero a mover a BD si el volumen crece). Sin N+1: las
versiones acuñadas de los listados se resuelven en **una** consulta (`mintedVersions`).

## 7. Mis ventas / cancelación (ya existente + entrada de venta nueva)

Pestaña «Mis ventas»: ahora encabezada por el `SellComposer`, y debajo tus listados en todos
los estados (En venta / Vendida / Retirada / Caducada). **Retirar** (`cancelMyListing` →
`app_market_cancel`) solo lo permite el propietario, solo sobre un listado activo; quita la
marca `locked` (la carta vuelve a estar disponible) sin generar créditos ni instancias. **No
hay reedición de precio:** el precio se fija al publicar (§27/§21).

## 8. Serial / minted_version / instanceValue

Intactos y garantizados por el servidor: la venta transfiere la **misma fila** de
`user_cards` (mismo `uid`), sin cambiar `serial` ni `minted_version` ni remintar. `#1/500`
sigue siendo `#1/500` para el comprador. `instanceValue` no se recalcula en el frontend; la
referencia que enseña el formulario es `marketValue`, solo un punto de partida.

## 9. Resultado de la prueba REAL

**Limitación honesta del entorno (no es un defecto de la fase):** el mercado entre jugadores
es server‑authoritative de extremo a extremo (auth + RPC), y en esta máquina el **Supabase
local (`127.0.0.1:54521`) está caído** (Docker desinstalado). Sin backend no hay sesión, y la
pestaña **«Global»** (donde vive el `SellComposer`) **solo aparece con usuario autenticado**
(`online = isSupabaseConfigured() && !!user`) — comportamiento correcto (sin cuenta, no hay
mercado entre jugadores). Además, aunque hubiera sesión, el mercado está **cerrado por
bandera**, así que publicar/comprar están desactivados.

Lo que **sí** se validó en navegador (`next start`, 1440×960, `/mercado`):
- La página **carga sin errores de consola** y renderiza el mercado **local** (Comprar / Mis
  anuncios / Historial) con cartas, precios, referencia, filtros y búsqueda.
- La pestaña **«Global» (P2P) se oculta correctamente sin sesión** — autoridad del servidor:
  el mercado entre jugadores no existe sin cuenta.
- La cabecera y las salas del mercado se muestran con la estética NEXUS (no un backoffice).

El comportamiento del `SellComposer` (wiring server‑authoritative, gating por interruptor,
comisión/neto, exclusión de repetidas ya listadas/bloqueadas, accesibilidad, forma vacía)
queda cubierto por **11 pruebas** que sí se ejecutan sin backend (§10), más `typecheck` y
`build`. La transferencia atómica, la concurrencia, la idempotencia y la conservación de
serial/versión están cubiertas por `economy:verify` + las RPC + `marketReadiness.test.ts`.
`economy:verify` requiere Supabase vivo, así que aquí devolvió `fetch failed` (mismo motivo);
no está entre los verificadores exigidos por esta fase.

## 10. Tests

Nuevo: `src/components/market/playerMarket.sell.test.tsx` — **11 pruebas** del compositor de
venta: server‑authority (pasa por `/api/game/market`, nunca RPC directa ni camino legado),
solo uid+precio, idempotencia, propiedad (repetidas del estado sincronizado), sin doble
listado, sin reedición de precio, suelo de precio con banda del servidor, comisión/neto
honestos, gating por interruptor con motivo (no solo color), forma vacía, accesibilidad
(listbox, etiqueta de precio, foco).

Mapa de los 23 escenarios de §32 → cobertura: 1/3/14/15 (RPC `for update` + `economy_ops` +
`economy:verify`), 2 (suelo cliente + `app_market_list`), 4/5/6 (`browse`/filtros + tests),
7/8/9/10/11/12 (`app_market_buy` + `economy:verify`), 13 (candado de estado), 16/17
(`app_market_cancel` + RLS), 18/19/20 (misma fila `user_cards`), 21 (sin reedición, test),
22 (desguace server‑side, no se implementa el 80 %), 23 (`security:verify` + RLS de 0020).

**Ejecución:**
- `npm test` → **953/953** ✓ (942 previos + 11 nuevos)
- `typecheck` ✓ · `build` ✓ (`/mercado` compila; «Compiled successfully»)
- `security:verify` ✓ · `pack:verify` ✓ · `content:verify` ✓ · `distribution:verify` ✓ (30/0)
- `economy:verify` — **bloqueado por entorno** (necesita Supabase vivo; no exigido por esta fase)

**No se modificó ningún test existente para forzar verde** (§32). En particular, no se tocó
`marketReadiness.test.ts` ni se flipó el interruptor que ese cerrojo protege.

## 11. Validación visual

`/mercado` con la estética NEXUS (casa de transferencias, no CRM): cartas con `PlayerCard`,
media/rareza/equipo/región, precio y referencia. El `SellComposer` reutiliza `PlayerCard`
(sin componente visual paralelo), con selector de cartas en carrusel accesible, precio,
referencia, neto y botón de publicar; responsive por construcción (`flex-wrap` +
`overflow-x-auto`), consistente con la rejilla existente (`grid-cols-2 … lg:grid-cols-5`).

## 12. P2 reales restantes

- **Abrir el mercado:** decisión de Operaciones, no de código. Bloqueada por el criterio 10
  (masa de jugadores). Al cumplirse: `GLOBAL_MARKET_ENABLED = true` (una línea) → el bucle,
  ya cableado, queda operativo sin más UI.
- **Validación viva del bucle P2P** (publicar→comprar entre dos cuentas): pendiente de un
  entorno con Supabase operativo (Docker local o autorización de escritura al VPS). No
  bloquea esta entrega.
- **Filtros en BD:** hoy región/media/nombre se filtran en Node; documentado como lo primero
  a mover a la base de datos si el volumen de listados crece.
- **Ofertas** (`make_offer`/`accept_offer`) existen en el esquema pero fuera del alcance de
  esta fase; permanecen revocadas.

## 13. Archivos modificados

- `src/components/market/PlayerMarket.tsx` — **(modificado)** añade `SellComposer` (venta P2P),
  cómputo de repetidas vendibles desde el estado sincronizado, y `publish()` vía
  `listCardOnMarket`; monta el compositor en «Mis ventas». Exporta `SellComposer` y
  `SellableInstance` para los tests.
- `src/components/market/playerMarket.sell.test.tsx` — **(nuevo)** 11 pruebas del compositor.
- `docs/product/fase-23-1-marketplace-core-report.md` — **(nuevo)** este informe.

Sin `git commit`, sin `push`, sin `deploy`. Cambios en el árbol de trabajo.
