# Fase 57.5B — Revalorización de cartas IMPLEMENTADA + desguace alineado

2026-09-24 · implementación de la propuesta aprobada en la F57.5 (`fase-57-5-card-value-audit.md`). Sin migraciones, sin
cambios de precios ni probabilidades, sin commit/push/deploy. Evidencia en `docs/product/qa/fase57-5-card-value-implementation/`
(generada por `scripts/_fase57-5b-implementation.ts`, 200.000 aperturas por sobre).

## 1–2. Fórmulas

| | Fórmula |
|---|---|
| Valor anterior | `max(25, redondeo_25(50 × 1,45^(rank−1) × 1,06^(OVR−60)))` |
| **Valor nuevo** | `gameRound(50 × MULT[packCardClass] × 1,13^(OVR−70))`, MULT = Base 1 · Plata 1 · Oro 1 · Masters 4 · Champions 10 · Prime 18 · Icon 25 |
| Redondeo | paso 1 < 50 ≤ 5 < 100 ≤ 10 < 1.000 ≤ 50 < 10.000 ≤ 100 |
| Desguace anterior | tabla por bucket de rareza: 30 / 70 / 200 / 600 / 1.600 |
| **Desguace nuevo** | `max(5, redondeo(6 % × marketValue))`, redondeo a 5 < 100 ≤ 10 < 1.000 ≤ 50 |

- La clase sale de `packCardClass`, sin otra clasificación. Si una carta de edición `base` tiene un OVR fuera de 70–92 (p. ej. creada en el admin), usa el multiplicador 1.
- Las variantes fuera del catálogo diseñado (bronze, regionales, winner, MVP) conservan la tasación heredada (`legacyRankValue`). No afecta a ninguna de las 331 cartas; queda documentado en `pricing.ts`.
- **Prueba de que coincide con lo aprobado:** el script de la auditoría F57.5, apuntado ahora a `marketValue` de producción, regenera los 8 ficheros de evidencia **idénticos byte a byte** (md5).

## 3. Runtime modificado

| Fichero | Cambio |
|---|---|
| `src/domain/economy/pricing.ts` | fórmula canónica (`marketValue`, `classValue`, `gameRound`, `valueClass`, `legacyRankValue`) |
| `src/domain/economy/salvage.ts` | desguace = 6 % de `marketValue`; se elimina `SALVAGE_BY_BUCKET` |
| `src/domain/economy/marketReadiness.ts` | `salvageBelowReference` carta a carta |
| `src/domain/economy/simulator.ts` | `salvageOf` por carta |
| `src/domain/economy/catalog.ts` | rango del desguace leído de las cartas |
| `src/data/packStats.ts` | regenerado; solo cambian `meanValue` y `meanSalvage` |
| `src/server/services/economy.ts` | solo un comentario |
| `src/app/inventario/page.tsx` | texto del desguace: «una pequeña parte del valor de mercado (un 6 %)» en vez de «una tarifa por rareza» |

- **Eliminados:** `src/domain/economy/cardValueProposal.ts` y su test. Así no quedan dos fórmulas.
- **Scripts:**
  - `scripts/economy-model.ts`: desguace medio por bucket.
  - `scripts/_fase57-5-card-value.ts`: «actual» = `legacyRankValue`.
  - `scripts/_fase57-5b-implementation.ts`: nuevo.

## 4–7. Distribución (`class-distribution-after.json`)

| Clase | Mediana antes → después | Media antes → después |
|---|---|---|
| Base | 150 → 130 | 140 → 132 |
| Plata | 200 → 280 | 199 → 264 |
| Oro | 250 → 450 | 254 → 450 |
| Masters | 775 → 1.800 | 769 → 1.869 |
| Champions | 7.675 → **5.100** | 7.751 → 5.518 |
| Prime | 2.825 → **11.700** | 2.903 → 12.625 |
| Icon | 33.200 → 26.500 | 31.425 → 23.800 |

- Las medianas y las medias quedan estrictamente ordenadas.
- **Champions vs Prime:** la mediana de Prime pasa de 0,37× a **2,29×** la de Champions. P(Champions > Prime), comparando una carta al azar de cada, baja del **100 % al 7,25 %**.

## 8–10. Top 25 y cambios (`top25-after.json`)

**Top 25:**

| Puestos | Cartas |
|---|---|
| 1–2 | mada y marteen (Icon 95, 26.500) |
| 3–5 | Lar0k, Sato y Xross (Prime 95, 19.100) |
| 6 | PatMen (Icon 92, 18.400) |
| 7–14 | Prime de 94 a 91 |
| 15–16 | slowly y splash (Champions 95, 10.600) |
| 17–25 | Prime de 90 a 88 intercaladas con Champions 94 y 93 |

**Mayores subidas:** las Future Star, de +241 % a +434 %, y los Masters 95 (+262 %).

**Mayores bajadas:**
- SiuFatBB (Champions 80): −63 %.
- Champions de OVR 84 a 88: de −52 % a −38 %.
- Base de OVR 70 a 74: de −50 % a −35 %.
- PatMen: −34 %.

## 11–12. Sobres después (motor real, 200.000 aperturas; `pack-economy-after.json`)

| Sobre | Precio | EV | EV/precio | P10 | P25 | P50 | P75 | P90 | P95 | P99 | EV F57.5 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Bronce | 1.000 | 5.723 | 5,72× | 835 | 1.050 | 2.090 | 7.790 | 17.300 | 22.470 | 32.220 | 5.723 |
| Plata | 2.500 | 12.958 | 5,18× | 1.970 | 3.270 | 8.850 | 19.940 | 30.080 | 37.030 | 53.230 | 12.958 |
| Oro | 4.000 | 20.652 | 5,16× | 4.090 | 7.660 | 17.500 | 30.110 | 41.300 | 49.250 | 64.800 | 20.652 |
| Masters | 5.000 | 25.503 | 5,10× | 7.490 | 12.940 | 23.050 | 34.800 | 47.170 | 55.200 | 69.950 | 25.503 |
| Champions | 8.000 | 40.963 | 5,12× | 18.070 | 27.320 | 39.480 | 52.650 | 65.700 | 73.700 | 88.880 | 40.963 |
| Icon | 12.500 | 47.943 | 3,84× | 33.900 | 39.600 | 47.300 | 55.300 | 63.400 | 66.200 | 72.100 | 47.943 |

- **Banda de F57.4:** los cinco quedan a ±10,85 % de su mediana (5,16×). Icon queda a 0,74× esa mediana. Icon Pack: mínimo 21.600, máximo 79.500.
- **Coste de conseguir Prime/Icon:** no cambia (depende de precio y probabilidades).
- **Coherencia con `packStats`:** `meanValue` de `packStats` (20.000 aperturas, semilla 90210) está a menos del 1 % del EV simulado.

**Hallazgo para la F57.6.** Los sobres regionales y de equipo (3.000 créditos, a la venta) pasan de 2,8× a **6,0–6,4×** en valor/precio y superan a la línea principal (≈5,1×). China/XLG/TYL/BLG/TE/JDG quedan en 2,7×. No afecta a los precios aprobados; queda como pendiente.

## 15–18. Desguace

**Auditoría:**
- El importe lo calcula Node (`salvageValue`) y lo cobra `app_salvage_cards(p_total)`. Cambiarlo NO requiere migración.
- El servidor tasa por versión acuñada de cada ejemplar.
- Solo se desguazan duplicados.

| Clase | Mediana antes → después | Media después | Rango después |
|---|---|---|---|
| Base | 30 → 10 | 7,9 | 5–10 |
| Plata | 30 → 15 | 16 | 15–20 |
| Oro | 30 → 25 | 26,6 | 20–45 |
| Masters | 70 → 110 | 112,7 | 30–260 |
| Champions | 600 → **310** | 332,5 | 100–640 |
| Prime | 200 → **700** | 755,5 | 430–1.150 |
| Icon | 1.600 → 1.600 | 1.433 | 1.100–1.600 |

**Bucle «comprar → abrir → desguazar TODO»** (peor caso: todo se trata como duplicado; `salvage-pack-loop-analysis.json`):

| Sobre | EV desguace / precio | P50 | P99 | P(desguace ≥ precio) |
|---|---|---|---|---|
| Bronce | **34 %** | 125 | 1.940 | 10,3 % (premio puntual; el EV es 0,34) |
| Plata | 31 % | 530 | 3.200 | 3,0 % |
| Oro | 31 % | 1.050 | 3.895 | 0,8 % |
| Masters | 31 % | 1.380 | 4.210 | 0,2 % |
| Champions | 31 % | 2.370 | 5.345 | 0 % |
| Icon | 23 % | 2.840 | 4.350 | 0 % |

- **Todos los sobres de pago** (31, según `packStats`): el peor es Americas / G2 / LOUD / 100T / LEV, con el **38,4 %**.
- Ninguno llega al 70 %: **no hay bucle rentable**.
- El desguace de cada carta es como mucho el 10 % de su valor (suelo de 5 sobre Base 70 = 50). Queda por debajo de la banda inferior del mercado (`min_price_mult` 0,2), así que comprar en el mercado para desguazar tampoco rinde.
- Cumple A–F: desguace < valor en las 331 cartas; EV < 70 % en todos los sobres; jerarquía de medianas y medias; sin bucle; > 0; valores redondos.
- **Efecto a comunicar:** los duplicados comunes pagan menos (Base 30 → 5–10) y los Prime mucho más (200 → 430–1.150). La recuperación total de un Bronce baja del 38 % al 34 %.

## 19–21. `packStats`, anclas y `marketReadiness`

**`packStats`:** regenerado con `npm run economy:model -- --emit`. `drawn` y `costPerRarity` quedan idénticos (F57.3 intacta); solo cambian `meanValue` y `meanSalvage`.

**Anclas del mercado:** consulta de solo lectura a la BD real (VPS):

| Tabla | Filas |
|---|---|
| `card_reference` | 0 |
| `content_card_market_anchor` | 0 |
| `card_price_stats` | 0 |
| `market_listings` | 0 |

No hay ningún ancla persistida que haya quedado obsoleta, así que **no se ha ejecutado** `sync-reference`. Si se ejecutara, crearía 331 filas nuevas y no corregiría nada. Queda como paso de apertura del mercado: es un mecanismo oficial e idempotente que solo escribe `card_reference`.

**`marketReadiness`:**
- Ancla de las 5 rarezas: 1,03 / 0,65 / 1,83 / 1,12 / 1,20, dentro de la banda 0,2–2,5.
- Desguace/referencia: peor caso 0,10.
- `anchor-calibrated` y `salvage-safe` = **met**.
- `GLOBAL_MARKET_ENABLED` = false y `PAYMENTS_ENABLED` = false.

## 22. `instanceValue`

Sin serie es igual a `marketValue`; con serie aplica `serialMultiplier` sobre el valor nuevo (test J). La venta rápida sigue siendo el 80 %.

**Deuda preexistente, no introducida:** en el modo LOCAL sin cuenta, la venta rápida (80 % del valor) ya devolvía unas 3,6 veces el precio de un sobre y ahora unas 4,6 veces. Esos créditos son locales, no los del servidor.

## 23–33. Gates y estado

| Gate / estado | Resultado |
|---|---|
| Tests | 5026 (fin de la F57.5) → **5036/5036** |
| `tsc` web | 0 errores |
| `tsc` scripts | 0 errores |
| `eslint src` | 0 errores, los mismos 27 avisos |
| `npm run build` | PASS |
| Catálogo | 331 cartas |
| Migraciones | 0 nuevas (54) |
| BD | sin escrituras (solo SELECT) |
| Mercado y pagos | OFF |
| Cuenta del usuario | no tocada: saldo 943.575 y 11 duplicados, igual antes y después; no se abrió, compró ni desguazó nada |

**Tests añadidos:** A–Q en `pricing.test.ts` y R–V en `salvage.test.ts`. Se actualizaron `catalog.test`, `economy41.matrix.test` y `marketReadiness.test` (el texto del detalle).

**Entorno:**
- :3005 y el túnel estaban caídos al empezar; no los paró esta sesión.
- Se levantaron con `Start-Process`: túnel SSH con keepalive y `node next start -p 3005`.
- :3005 se paró una vez (PID propio 28580) para reconstruir con el texto nuevo del desguace y se relanzó.

**Ajeno:** `src/design/tokens.ts` volvió a cambiar hoy a las 12:20, durante esta sesión, y no lo ha tocado esta fase. Hay otra sesión en paralelo escribiendo en el repo.
