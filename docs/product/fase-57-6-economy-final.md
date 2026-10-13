# Fase 57.6 — Economy Final Polish: cierre de la economía de sobres

2026-09-24 · **GO: la economía de sobres queda cerrada.** Sin migraciones y sin escrituras en la BD (solo un SELECT del volcado de pools). Sin commit, push ni deploy.

Evidencia en `docs/product/qa/fase57-6-economy-final/`:

| Fichero | Contenido |
|---|---|
| `baseline.json` | Estado de partida y gates |
| `all-pack-economy-before.json` | Los 32 sobres antes (200.000 aperturas cada uno, pools REALES v942) |
| `all-pack-economy-after.json` | Los 32 sobres después |
| `dominance-analysis.json` | Veredicto de dominancia por sobre |
| `liquidation-analysis.json` | Desguace y venta rápida por sobre |
| `final-pack-economy.json` | Tabla final |
| `runtime.json` | Estado de :3005, túnel y QA |
| `pool-snapshot-v942.json` | Salida de `app_content_distribution_snapshot()` |
| capturas | 1440 y 390 px |

Instrumentos: `scripts/_fase57-6-economy.ts`, `_fase57-6-report.ts` y `_fase57-6-shots.ts`.

## 1. Baseline (antes de tocar nada)

| Comprobación | Resultado |
|---|---|
| Tests | 5036/5036 |
| tsc web y scripts | 0 errores |
| Catálogo | 331 cartas |
| Precios de la línea principal y F57.3 | intactos |
| `marketValue` y desguace | los de F57.5B |
| Mercado y pagos | `GLOBAL_MARKET_ENABLED` = false, `PAYMENTS_ENABLED` = false |
| Cambios desde F57.5B | ningún fichero de economía ha cambiado; solo `src/design/tokens.ts` (sesión paralela, no tocado) |

## 2–3. Problema A — Bronce: se queda como está

Banda de la línea principal (Bronce, Plata, Oro, Masters y Champions): mediana **5,16×**, ±12 % = **4,54–5,78×**.

| Sobre | Valor / precio |
|---|---|
| Bronce | 5,72× (+10,85 %) |
| Plata | 5,18× |
| Oro | 5,16× |
| Masters | 5,10× |
| Champions | 5,12× |
| Icon | 3,84× (excepción premium intencional) |

Bronce queda dentro de la tolerancia, así que no se toca: 1.000 es el precio comercial correcto.

## 4–6. Problema B — sobres especiales (motor real + pools reales de producción)

Los regionales y los Team Packs sortean por bucket de rareza y tienen un **18 % de «rara» por carta**. Con F57.5B, «rara» es la clase **Prime** (future-star). Esto los volvió dominantes:

| Sobre | Estado | Precio | Valor/precio antes | Frente a la mediana | Créditos por Prime |
|---|---|---|---|---|---|
| EMEA | ACTIVE | 3.000 | 6,01× | +16 % | 3.322 |
| Americas | ACTIVE | 3.000 | 6,43× | +25 % | 3.322 |
| Pacific | ACTIVE | 3.000 | 6,22× | +20 % | 3.322 |
| Team Heretics | ACTIVE | 3.000 | 5,83× | +13 % | 3.322 |
| Fnatic | ACTIVE | 3.000 | 6,13× | +19 % | 3.322 |
| G2 | ACTIVE | 3.000 | 6,52× | +26 % | 3.322 |
| Team Liquid | ACTIVE | 3.000 | 5,81× | +12,5 % | 3.322 |
| Karmine Corp | ACTIVE | 3.000 | 6,01× | +16 % | 3.322 |
| EWC | ACTIVE | 6.000 | 5,70× | en banda | 4.680 |
| China | ACTIVE | 3.000 | 2,68× | −48 % | — (sin Prime en su pool) |

**Veredicto:** 8 sobres **ECONOMICALLY DOMINANT**. Superan claramente la banda y se pueden comprar sin límite (no tienen tope, ventana ni restricción de evento: `eventId` es solo de presentación).

Casos aparte:
- **China** queda por debajo de la banda: es una compra peor, pero no se puede explotar.
- Los **DRAFT** (14) y los **RETIRED** (NAVI y Prime) no se venden.
- El **Sobre Inicial** (gratis, 5 cartas) es FTUE y lo reparte el servidor con su regla.

## 7. Cambio de precio aplicado (solo precio; pools, pesos, cartas e identidad intactos)

**EMEA, Americas y Pacific pasan de 3.000 a 3.500**, y con ellos los Team Packs de su familia.

- La economía de un Team Pack es la de su regional: lo exige `teamPackEconomics` y lo fija un test. Ponerlo por debajo de su regional sería incoherente: pagarías menos por el mismo pool más el refuerzo del equipo.
- Cambian **17 sobres**: 3 regionales, 5 Team Packs a la venta, NAVI (retirado) y 8 DRAFT. Los no comprables no afectan a ningún jugador, y así no heredan la dominancia si se activan.
- **China** y sus Team Packs siguen a 3.000.
- La tienda, `/packs`, el servidor (`buyPack` cobra `pack.price`) y `packStats` leen el mismo `PackDef`.

## 8. Después (200.000 aperturas por sobre, pools reales)

| Sobre | Tipo | Precio | Cartas | EV | EV/precio | Desguace EV | Desguace/precio | Prime % | Icon % | Estado |
|---|---|---|---|---|---|---|---|---|---|---|
| Bronce | principal | 1.000 | 5 | 5.723 | 5,72 | 344 | 34,4 % | 3,0 | 1,0 | OK |
| Plata | principal | 2.500 | 6 | 12.958 | 5,18 | 779 | 31,2 % | 5,0 | 3,0 | OK |
| Oro | principal | 4.000 | 5 | 20.652 | 5,16 | 1.240 | 31,0 % | 10,0 | 7,0 | OK |
| Masters | principal | 5.000 | 5 | 25.503 | 5,10 | 1.533 | 30,7 % | 12,0 | 8,0 | OK |
| Champions | principal | 8.000 | 5 | 40.963 | 5,12 | 2.462 | 30,8 % | 20,1 | 15,0 | OK |
| Icon | principal | 12.500 | 3 | 47.943 | 3,84 | 2.877 | 23,0 % | 70,0 | 30,0 | PREMIUM |
| EWC | evento | 6.000 | 5 | 34.202 | 5,70 | 2.054 | 34,2 % | 25,6 | 5,1 | OK |
| EMEA | regional | **3.500** | 5 | 18.026 | 5,15 | 1.082 | 30,9 % | 18,1 | 1,0 | OK |
| Americas | regional | **3.500** | 5 | 19.299 | 5,51 | 1.158 | 33,1 % | 18,1 | 1,0 | OK |
| Pacific | regional | **3.500** | 5 | 18.649 | 5,33 | 1.121 | 32,0 % | 18,1 | 1,0 | OK |
| China | regional | 3.000 | 5 | 8.054 | 2,68 | 486 | 16,2 % | 0 | 0 | OK |
| Team Heretics | equipo | **3.500** | 5 | 17.477 | 4,99 | 1.049 | 30,0 % | 18,1 | 1,0 | OK |
| Fnatic | equipo | **3.500** | 5 | 18.382 | 5,25 | 1.104 | 31,5 % | 18,1 | 1,0 | OK |
| G2 | equipo | **3.500** | 5 | 19.549 | 5,59 | 1.174 | 33,5 % | 18,1 | 1,0 | OK |
| Team Liquid | equipo | **3.500** | 5 | 17.420 | 4,98 | 1.045 | 29,9 % | 18,1 | 1,0 | OK |
| Karmine Corp | equipo | **3.500** | 5 | 18.038 | 5,15 | 1.083 | 30,9 % | 18,1 | 1,0 | OK |
| Inicial | inicial | 0 | 5 | — | — | — | — | 3,5 | 0 | RECOMPENSA |
| NAVI, Prime y 14 DRAFT | — | 3.500 / 10.000 / 3.000–3.500 | — | — | — | — | — | — | — | NO COMPRABLE |

- P10, P50, P90, P99, mínimo, máximo, OVR medio y tamaño del pool de cada sobre están en `all-pack-economy-after.json`.
- **Ningún sobre comprable supera la banda.** El máximo es G2 con 5,59×, frente a un techo de 5,78×.
- **Dato que queda a la vista, no es un bucle:** el regional sigue siendo la vía más barata hacia una Prime **de su región** (unos 3.875 créditos por Prime, frente a 5.957 del Icon y más de 6.689 de la línea principal). Es la consecuencia de sus pesos (rara 18 %), que esta fase no puede tocar. A cambio el jugador renuncia a las otras regiones y a los Icon (1 %). No es arbitraje: sigue siendo aleatorio y el valor por crédito ya está en banda.

## 9–11. Problema C — venta rápida local

**Dónde vivía:** `pricing.quickSellValue`, que pagaba el **80 % de `instanceValue`**. La usaban:
- `useGameStore.quickSell`/`quickSellMany`, a través del botón «Vender todos» de `/inventario`, **solo sin cuenta**;
- `craft/materials.salvageYield` (receta «Reciclar duplicado» de la Forja en `/coleccion`, local; con cuenta, el sincronizado con el servidor la pisa).

No compartía código con el servidor y no llegaba a la economía autenticada. Pero **era un bucle sistemático en el modo local**: comprar, abrir y vender devolvía **3,1–5,2× el precio de todos los sobres comprables**, con una probabilidad del 64–100 % de recuperar el precio en UNA sola apertura.

**Ahora:**
- `quickSellValue` y `QUICK_SELL_RATE` **ya no existen**.
- El modo local, la Forja y el servidor pagan lo mismo: **`salvageValue(card)` = max(5, redondeo(6 % × marketValue))**. Es la única fuente de verdad de «destruir una carta a cambio de créditos».
- El botón local pasa de «Vender todos» a «Desguazar N» y muestra la misma explicación breve del 6 %.
- Comprobado en headless: 3 duplicados (2 × xross Prime 95 + 1 × mada Icon 95) muestran «Desguazar 3 · 🪙 3.900». Con el 80 % habría pagado unos 51.760.

## 12–14. Liquidación, bucles y premios

- **Desguace/precio de todos los sobres comprables:** entre 16 % y 34,4 %. El máximo es Bronce, y la mayoría está en 30–34 %. Ninguno llega al 70 %; todos dentro del objetivo del 20–40 % salvo China (16 %).
- **Ningún bucle sistemático:**
  - no se puede comprar ninguna carta concreta con créditos (cartas, cajas y lotes: solo dinero real, y está OFF);
  - el mercado está OFF;
  - el desguace de cualquier carta es como mucho el 10 % de su valor (por debajo de la banda mínima del mercado, 0,2);
  - el peor sobre posible nunca paga su precio.
- **Premios individuales (aleatorios, no arbitraje):** probabilidad de que desguazar UNA apertura devuelva al menos su precio:
  - Bronce **10,3 %** (una Icon o una Prime alta en un sobre de 1.000; máximo 4.835);
  - Plata 3,0 %, Oro 0,8 %, regionales 0,3–0,7 %, Masters 0,2 %;
  - Champions e Icon, 0 %.

  El jugador no puede elegir ese resultado. El EV sigue en el 34 %, así que repetirlo pierde créditos. Además solo se desguazan **duplicados**: la primera copia de una carta nunca paga.

## 15–21. Qué sigue intacto

| Elemento | Estado |
|---|---|
| F57.3 (probabilidades) | intacta; test A |
| F57.4 (precios de la línea principal) | intactos; test B. Cambio explícito solo en la familia EMEA/Americas/Pacific |
| F57.5B (`marketValue`) | intacto; test C |
| Icon | 12.500 créditos, 3 cartas, 70/30; test E |
| Pools, pesos, restricciones, equipo y ciclo de vida de los especiales | intactos; test J |
| Sobre Inicial / FTUE | 0 créditos, 5 cartas, regla del servidor; test L |
| `packStats` | regenerado: cambian solo `price` y `costPerRarity` de los 17 sobres; `drawn`, `meanValue` y `meanSalvage` idénticos (test K: `packStats` = `PackDef` = tienda) |

La ficha de `/packs` ya dice «unos 3928 créditos por carta» para la rara de EMEA.

## 22–30. Gates y estado

| Gate / estado | Resultado |
|---|---|
| Tests | 5036 → **5050/5050** (+14 en `economyFinal.test.ts`, A–N + dominancia) |
| tsc web y scripts | 0 errores |
| eslint | 0 errores, los mismos 27 avisos |
| build | PASS |
| Catálogo | 331 |
| Migraciones | 0 (siguen 54) |
| Mercado y pagos | OFF |
| Cuenta del usuario | **NO** modificada: saldo 943.575 y 11 duplicados, antes y después |
| Cuenta QA | NO modificada |
| BD | solo un SELECT del volcado de pools |

## 33–35. Runtime y QA

- **:3005:** se paró el `next start` propio (PID 25176, línea de comandos comprobada), se reconstruyó y se relanzó (PID 33016). `/api/game/state` responde 401.
- **Túnel:** activo (REST 200), no se ha tocado.
- **QA con la sesión del usuario (Chrome):**
  - `/packs`: precios nuevos.
  - `/tienda`: la línea principal, bien.
  - `/inventario`: desguace del servidor sin cambios, con el texto del 6 %.
  - `/coleccion`: se ve.
- **QA headless** (perfil temporal, sin sesión, modo local), `/tienda`, `/packs`, `/inventario` y `/coleccion` a 1440 y 390 px: sin scroll horizontal ni errores de consola.
- **Problemas de la herramienta de QA, no del producto:**
  - la extensión captura el velo de transición justo tras navegar;
  - la extensión no aplica `resize_window` a 390 px; ese ancho se validó en headless.

## 36. Ficheros

| Tipo | Ficheros |
|---|---|
| Runtime | `src/data/packs.ts` (17 precios + comentarios), `src/data/packStats.ts` (regenerado), `src/domain/economy/pricing.ts` (se elimina la venta rápida), `src/store/useGameStore.ts`, `src/app/inventario/page.tsx`, `src/craft/materials.ts`, `src/craft/types.ts` (comentario) |
| Tests | `src/domain/economy/economyFinal.test.ts` (nuevo), `pricing.test.ts`, `salvage.test.ts`, `src/data/teamPackCatalog.test.ts`, `src/data/teamPackOffer.test.ts`, `src/domain/packs/packEconomy.test.tsx` |
| Scripts | `scripts/economy-model.ts` (texto), `_fase57-6-*.ts` (nuevos) |
| No tocado | `src/design/tokens.ts`: lo modificó otra sesión (12:20 y 12:43) |

## 37–38. Veredicto

**GO. La economía de sobres queda cerrada.**

¿Queda algún problema económico CRÍTICO? **NO**: no hay exploit, ni bucle, ni tests rotos, ni build roto, ni datos dañados.

Quedan dos datos visibles, no críticos:
- China vale 2,68× (limitación de su pool, peor compra).
- El regional es la vía más barata hacia una Prime de su región (consecuencia de sus pesos, que no se pueden tocar sin cambiar probabilidades).
