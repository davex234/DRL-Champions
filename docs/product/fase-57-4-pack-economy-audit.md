# Fase 57.4 — Balance económico de la línea principal (auditoría + implementación)

2026-09-23 · **estado: GO** (precios aplicados tras la decisión de producto; ver «Implementación» al final). Las secciones 1–12 son la auditoría ANTES del cambio · sin commit, sin push, sin deploy · 0 migraciones · ninguna cuenta tocada.

Evidencia: `docs/product/qa/fase57-4-pack-economy/audit-before.json` (200.000 aperturas por producto con el motor real).
Instrumentos: `scripts/_fase57-4-audit.ts` y `src/domain/packs/packEconomy.ts` (puro; EV, coste de top tier y detector de outliers; nadie en la app lo importa todavía).

## 1. Fuentes de verdad (auditadas, no inventadas)

| Qué | Dónde | Notas |
|---|---|---|
| Precio | `PackDef.price` en `src/data/packs.ts` | Lo leen la tienda (`domain/store/resolve.ts` → `pack.price`), la ficha, `PackStoreCard`/`ShopHero` y el servidor (`buyPack` → `app_buy_pack(p_price = pack.price)`). La RPC (0019) cobra el `p_price` que le manda el servidor (solo `service_role`) y en SQL no hay tabla de precios. **Cambiar precios no requiere migración.** |
| Valor de referencia | `marketValue(card)` en `domain/economy/pricing.ts` | `50 × 1,45^(rank−1) × 1,06^(OVR−60)`, redondeado a 25. Depende del **rank de la edición** y del **OVR**. El serial solo cuenta en `instanceValue`, y ninguna edición del catálogo es serializada. La clase de sobre no influye. Es el valor que usa `economy:model` → `packStats.meanValue`. |
| Valor canjeable | `salvageValue(card)` en `domain/economy/salvage.ts` | Tabla por rareza (30/70/200/600/1600). Con el Marketplace OFF, es lo **único** que se convierte en créditos. |
| Probabilidades | `mainPackDistribution` (F57.3) | Sin cambios. |

Ranks: base 1 · masters-l/sdc 4 · **future-star 7** · **champions-s 10** · record-breaker/moments 13.

## 2. Valor por clase (331 cartas, `marketValue`)

| Clase | n | mín | P25 | mediana | media | P75 | P90 | máx | OVR medio | desguace |
|---|---|---|---|---|---|---|---|---|---|---|
| Base | 75 | 100 | 125 | 150 | 140 | 150 | 175 | 175 | 77,6 | 30 |
| Plata | 60 | 175 | 200 | 200 | 199 | 200 | 225 | 225 | 83,5 | 30 |
| Oro | 34 | 225 | 250 | 250 | 254 | 275 | 275 | 325 | 87,8 | 30 |
| Masters | 119 | 425 | 650 | 775 | 769 | 875 | 1.050 | 1.175 | 87,3 | 70 |
| **Champions** | 20 | 4.550 | 6.825 | 7.675 | **7.751** | 9.150 | 10.900 | 10.900 | 88,7 | 600 |
| **Prime** | 20 | 2.250 | 2.675 | 2.825 | **2.903** | 3.375 | 3.575 | 3.575 | 91,3 | 200 |
| Icon | 3 | 27.875 | 27.875 | 33.200 | 31.425 | 33.200 | 33.200 | 33.200 | 94,0 | 1.600 |

**Hallazgo 1:** en el sistema de valor actual **una Champions S vale 2,7× lo que vale una Prime** (rank 10 frente a 7), aunque la escalera de sobres coloca Prime por encima de Champions.

## 3–7. EV y dispersión con los precios actuales (200.000 aperturas por producto)

| Sobre | Precio | Cartas | EV/carta | EV/sobre analítico | Simulado (Δ) | **EV/precio** | Desguace/precio |
|---|---|---|---|---|---|---|---|
| Bronce | 750 | 5 | 911 | 4.553 | 4.547 (−0,14 %) | **6,07×** | 50,9 % |
| Plata | 2.500 | 6 | 1.870 | 11.222 | 11.221 (−0,01 %) | 4,49× | 31,1 % |
| Oro | 5.000 | 5 | 3.569 | 17.845 | 17.810 (−0,19 %) | **3,57×** | 22,3 % |
| Masters | 5.000 | 5 | 4.396 | 21.981 | 21.937 (−0,20 %) | 4,40× | 27,8 % |
| Champions | 8.000 | 5 | 7.812 | 39.058 | 39.020 (−0,10 %) | 4,88× | 29,9 % |
| **Icon** | 20.000 | **1** | 11.459 | 11.459 | 11.493 (+0,30 %) | **0,57×** | **3,1 %** |

Valor total por sobre (simulado):

| Sobre | mín | P10 | P25 | P50 | P75 | P90 | P95 | P99 | máx |
|---|---|---|---|---|---|---|---|---|---|
| Bronce | 500 | 775 | 875 | 1.350 | 4.275 | 10.625 | 21.750 | 36.275 | 100.025 |
| Plata | 1.075 | 1.300 | 1.850 | 5.200 | 12.475 | 34.625 | 39.575 | 62.025 | 133.400 |
| Oro | 1.125 | 2.000 | 4.200 | 10.150 | 34.125 | 41.275 | 49.100 | 71.850 | 140.050 |
| Masters | 1.150 | 3.575 | 7.450 | 14.050 | 36.000 | 45.575 | 62.200 | 76.825 | 139.625 |
| Champions | 1.225 | 12.225 | 19.100 | 38.275 | 51.525 | 72.850 | 80.350 | 104.525 | 166.000 |
| Icon | 2.250 | 2.375 | 2.675 | 3.175 | 27.875 | 33.200 | 33.200 | 33.200 | 33.200 |

## 8–10. Coste esperado de top tier (precios actuales; P(≥1) = 1 − (1 − p)^n)

| Sobre | P(≥1 Prime) → créditos | P(≥1 Icon) → créditos | P(≥1 Prime o Icon) → créditos | Créditos por carta Icon |
|---|---|---|---|---|
| Bronce | 14,1 % → 5.309 | 4,9 % → 15.303 | 18,5 % → 4.062 | 15.000 |
| Plata | 26,5 % → 9.437 | 16,7 % → 14.968 | 39,4 % → 6.351 | 13.889 |
| Oro | 41,0 % → 12.210 | 30,4 % → 16.431 | 60,6 % → 8.250 | 14.286 |
| Masters | 47,2 % → 10.587 | 34,1 % → 14.666 | 67,2 % → 7.437 | 12.500 |
| Champions | 67,2 % → 11.899 | 55,6 % → 14.381 | 88,4 % → 9.050 | 10.667 |
| **Icon** | 70 % → **28.571** | 30 % → **66.667** | 100 % → 20.000 | **66.667** |

**Hallazgo 2:** hoy el Sobre Icon es la forma **más cara** de conseguir una Icon (4,6× lo que cuesta vía Champions) y también de conseguir una Prime.

## 9. Duplicados

Dentro de cada clase la selección es uniforme (pools con peso 1). Por eso la probabilidad de que una carta de la clase *k* salga repetida es exactamente la fracción de esa clase que ya tienes, f_k: no hace falta ningún supuesto más. En el Sobre Icon, P(duplicado) = 0,7 · f_Prime + 0,3 · f_Icon.

| Fracción de Prime e Icon ya poseída | 0 % | 25 % | 50 % | 75 % | 100 % |
|---|---|---|---|---|---|
| P(la carta de Icon es duplicada) | 0 % | 25 % | 50 % | 75 % | 100 % |

Llevar una sola fracción para toda la colección (p. ej. «25 %») sí exige suponer cómo se reparte entre clases, y ese supuesto no está en el sistema.

Coleccionismo (problema del coleccionista): completar las 3 Icon exige ≈ 5,5 cartas Icon, es decir **≈ 18,3 Sobres Icon**. Completar las 20 Prime exige ≈ 72 cartas Prime, es decir ≈ 102,8 Sobres Icon. El anti-duplicado es `allow` y no se ha tocado.

## 11. Problemas encontrados

1. **Bronce es un outlier por arriba** (6,07×) y **Oro por abajo** (3,57×, peor que Plata y que Masters al mismo precio que Masters). Regla: los cinco a ±20 % de su mediana (4,49×).
2. **Icon es una trampa** (0,57×; 3,1 % en desguace; el camino más caro hacia cualquier top tier).
3. **Estructural:** con la tabla de F57.3, **un Sobre Champions da más de todo que un Sobre Icon.** 5 × 20 % = 1,0 Prime por sobre frente a 0,7, y 5 × 15 % = 0,75 Icon frente a 0,3, además de Oro, Masters y Champions encima. Con precio(Icon) > precio(Champions), Icon queda **dominado en todos los ejes a cualquier precio**, y su EV/precio no puede superar 11.459 / 39.058 ≈ **0,29×** el de Champions.

## 12. Propuesta y bloqueo

**Los cinco primeros sí se arreglan solo con precio.** Salen de EV / ≈4,5, llevado al escalón comercial más cercano:

| Sobre | Precio anterior → propuesto | EV/precio | Coste por Prime | Coste por Icon |
|---|---|---|---|---|
| Bronce | 750 → **1.000** | 4,55× | 6.667 | 20.000 |
| Plata | 2.500 → 2.500 | 4,49× | 8.333 | 13.889 |
| Oro | 5.000 → **4.000** | 4,46× | 8.000 | 11.429 |
| Masters | 5.000 → 5.000 | 4,40× | 8.333 | 12.500 |
| Champions | 8.000 → 8.000 | 4,88× | 8.000 | 10.667 |

Banda de 4,40× a 4,88× (±9 % de la mediana), precios estrictamente crecientes y 0 outliers entre los cinco.

**Icon NO:** las condiciones del encargo son incompatibles entre sí si solo se toca el precio.

| Icon a… | EV/precio | Frente a la mediana 4,49× | Orden estricto (> Champions) | ¿Trampa? |
|---|---|---|---|---|
| 20.000 (actual) | 0,57× | 0,13× | ✅ | sí |
| 10.000 (el mínimo por encima de Champions) | 1,15× | 0,26× | ✅ | **sí** (0,26× de la mediana; coste por Icon 33.333 frente a 10.667 vía Champions) |
| 4.000 | 2,86× | 0,64× | ❌ (más barato que Oro) | no |

Arreglarlo exige tocar algo que el encargo prohíbe o reserva para ti: el número de cartas de Icon (contrato F57.3 = 1), las probabilidades de F57.3, el valor de las cartas (rank de Future Star frente a Champions S) o el orden estricto de precios. Por la regla 12 (**STOP**) no he aplicado ningún precio: ni el de Icon ni la mitad «segura» de la tabla, porque el precio de Champions y el de Icon dependen de la misma decisión.

---

# Implementación (tras la decisión de producto: «Icon 3 cartas, 12.500»)

**Estado: GO.** Sin commit, sin push, sin deploy · 0 migraciones (siguen 54) · ninguna cuenta tocada · `GLOBAL_MARKET_ENABLED` y `PAYMENTS_ENABLED` siguen en `false`.

## Precio anterior → nuevo (única fuente: `PackDef.price`)

| Sobre | Precio | Cartas | EV/precio | Coste por Prime | Coste por Icon | Créditos esperados hasta la 1.ª Prime / Icon / Prime o Icon | Desguace/precio |
|---|---|---|---|---|---|---|---|
| Bronce | 750 → **1.000** | 5 | 6,07× → **4,55×** | 6.667 | 20.000 | 7.079 / 20.404 / 5.416 | 38,2 % |
| Plata | 2.500 | 6 | 4,49× | 8.333 | 13.889 | 9.437 / 14.968 / 6.351 | 31,1 % |
| Oro | 5.000 → **4.000** | 5 | 3,57× → **4,46×** | 8.000 | 11.429 | 9.768 / 13.144 / 6.600 | 27,9 % |
| Masters | 5.000 | 5 | 4,40× | 8.333 | 12.500 | 10.587 / 14.666 / 7.437 | 27,8 % |
| Champions | 8.000 | 5 | 4,88× | 8.000 | 10.667 | 11.899 / 14.381 / 9.050 | 29,9 % |
| **Icon** | 20.000 → **12.500** | 1 → **3** | 0,57× → **2,75×** | **5.952** (la más barata) | 13.889 | 12.847 / 19.026 / 12.500 | 14,9 % |

- Los cinco quedan entre 4,40× y 4,88× (mediana 4,49×; ±9 %).
- Icon queda en 0,61× la mediana. Es la prima de exclusividad, dentro del suelo de 0,6×.
- Icon es la vía más barata hacia una Prime y ya no la más cara hacia una Icon (antes 66.667 por carta Icon; ahora 13.889).
- Todas las Icon: ≈ 6,1 Sobres Icon. Todas las Prime: ≈ 34,3 Sobres Icon.

EV simulado de Icon: 34.418 (analítico 34.378, +0,12 %). Distribución del valor total de Icon: P10 8.300 · P25 9.125 · P50 38.100 · P75 39.775 · P90 68.775 · P95 69.575 · P99 94.275 · máx 99.600. Los cinco primeros sortean exactamente igual que antes; los datos están en `audit-after.json`.

## Qué se ha cambiado

- `src/data/packs.ts`: Bronce 1.000; Oro 4.000; Icon 12.500 y `cardCount: 3` (contrato nuevo, cada carta 70 % Prime / 30 % Icon); descripción de Icon. Las probabilidades de F57.3, `packCardClass`, las 331 cartas y los 26 sobres especiales **no cambian** (test D).
- `src/data/packStats.ts`: regenerado. Cambian 3 filas (Bronce, Oro, Icon) y las demás son idénticas.
- `src/domain/packs/packEconomy.ts` (nuevo): EV por carta y por sobre, coste de top tier con 1 − (1 − p)^n y regla de outliers.
- `src/domain/packs/packEconomy.test.tsx` (nuevo): tests A–J.
- Arnés `design-system/fase57` (`ICON3`, todas Prime/Icon) y `design-system/fase41` (etiqueta «Sobre Icon (12.500)»).
- Tests que fijaban precios o el número de cartas con literales, reescritos para derivarlos del precio canónico: `economy41.matrix`, `economy41.service`, `economy.render`, `catalog.test` y `store.test`, además de `basePackLine` (B1/B5), `packClass` (Icon con 3 cartas), `packs.power.service` (3 filas persistidas), `f573.packClass.ui` y `f57.packOpening`.
- Instrumentos fuera de CI: `scripts/_fase57-4-audit.ts` y `scripts/_fase57-4-runtime.ts`.

## Gates

- Tests 5007 → **5017/5017**.
- tsc web y scripts ✅.
- eslint: 0 errores y los mismos 27 avisos de antes.
- `npm run build` ✅.
- :3005 relanzada (PID 24184) tras parar solo nuestro `next start` (PID 11564). Túnel PID 15620 intacto.

## Runtime (`runtime.json` y capturas, 1440 y 390, sin sesión)

- Las seis fichas muestran el precio nuevo, las cartas por sobre y su tabla de F57.3, con su arte.
- Icon: «3 cartas por sobre», Prime 70 % / Icon 30 %, «Prime o Icon garantizada».
- En `/packs` aparecen los seis precios.
- En `/tienda`, la franja «Sobres» enseña los 4 primeros de 17: Bronce, Plata, Oro y Champions. Masters e Icon están en «Ver todos».
- No aparece ningún precio antiguo (750 o 20.000) en ninguna de las dos páginas.
