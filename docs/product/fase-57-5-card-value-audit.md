# Fase 57.5 — Revalorización de cartas: auditoría y propuesta (ESPERANDO APROBACIÓN)

2026-09-23, re-verificado el 2026-09-24 · **solo análisis y diseño**. No cambia ningún valor en producción, ni la UI, ni los precios, ni la BD, ni las migraciones (0). Sin commit, sin push, sin deploy.

**Re-verificación del 2026-09-24:**
- Se repitió el análisis y los 8 ficheros de evidencia salieron idénticos byte a byte (md5): las simulaciones son reproducibles.
- Se volvieron a pasar las gates.
- Se añadieron tres consumidores que faltaban en §2 y el impacto sobre los dos cerrojos de `marketReadiness` (§22 bis y `market-readiness-impact.json`).

Evidencia (`docs/product/qa/fase57-5-card-value/`):

| Fichero | Contenido |
|---|---|
| `current-values.json` | Las 331 cartas con su valor actual |
| `proposed-values.json` | Las 331 cartas con su valor propuesto |
| `values.csv` | Las 331 cartas, valor actual y propuesto |
| `class-distribution.json` | Distribución por clase, correlaciones y solapes |
| `pack-impact.json` | Impacto en los sobres (200.000 aperturas por sobre) |
| `top25-comparison.json` | Top 25 actual frente a propuesto |
| `outliers.json` | Mayores subidas y bajadas, y comprobaciones automáticas |
| `ovr-sensitivity.json` | Valor por clase y OVR, y enfrentamientos |
| `market-readiness-impact.json` | Cerrojos de ancla y desguace de `marketReadiness`, actual frente a propuesto |

Instrumentos:
- `scripts/_fase57-5-card-value.ts`: análisis puro.
- `src/domain/economy/cardValueProposal.ts`: la propuesta. **Ningún módulo de runtime lo importa**, y un test lo comprueba.
- `src/domain/economy/cardValueProposal.test.ts`: 9 tests.

## 1. Cómo funciona el valor actual

La fuente única es `marketValue(card)` en `src/domain/economy/pricing.ts`:

```
marketValue = max(25, redondeo_a_25( 50 × 1,45^(rank − 1) × 1,06^(OVR − 60) ))
```

- **Intervienen:** el `rank` de la variante (edición) y el OVR.
- **No intervienen:**
  - las stats;
  - el rol;
  - la clase de sobre de F57.3 (solo de forma indirecta, porque la clase se deriva de la edición);
  - el serial. El serial solo cuenta en `instanceValue` (`× serialMultiplier`, de ×1 a ×5), y hoy ninguna de las 7 ediciones del catálogo es serializada.
- **Mínimo** 25; sin máximo.
- **Ranks:** base 1 · masters-l/sdc 4 · future-star 7 · champions-s 10 · record-breaker/moments 13.

**Derivados:**

| Función | Cálculo |
|---|---|
| `instanceValue` | `marketValue` × serial |
| `quickSellValue` | 80 % de `instanceValue` |

**Aparte y no derivado:** `salvageValue` (`domain/economy/salvage.ts`) es una tabla por rareza (30/70/200/600/1.600). Es el desguace que paga el servidor y **no depende de `marketValue`**.

## 2. Qué consume el valor

| Uso | Consumidor |
|---|---|
| Mercado (OFF) | Ancla persistida `card_reference.fair_value` (`api/market/sync-reference`) y `content_card_market_anchor` (`api/admin/cards`), ambas = `marketValue`. La RPC `_price_anchor(_versioned)` (0004/0040) la usa como banda antifraude (`min_price_mult`/`max_price_mult`) cuando no hay precio medio. Además, `server/services/market.ts` (`reference`), `marketplace/value.ts` y los componentes `components/market/*`. |
| Colección / UI | `CardViewer` (valor de la carta), `collection-presentation` (valor de colección e «inversión»), `domain/collections/teamCollection`, `/mercado`. |
| Apertura | `pack/mint.ts` → `DropInstance.value = instanceValue` (se devuelve en la apertura; la ceremonia no lo muestra). |
| Venta rápida / crafting | `quickSellValue`, solo en la economía LOCAL sin sesión (`useGameStore`, `/inventario`) y en `craft/materials`. |
| Balance de sobres | `economy:model` → `packStats.meanValue`, `domain/packs/packEconomy` (F57.4, EV/precio) y sus tests. |
| Admin / generador | Admin de cartas (`estimatedValue`, vista previa) y `card-generator/specs`. |
| Cerrojo del mercado | `domain/economy/marketReadiness` (`anchorRatios`, `salvageBelowReference`), fijado por `marketReadiness.test.ts`. Ver §22 bis. |
| Mercado local sembrado | `data/marketSeed.ts`: los anuncios de ejemplo se ponen a precio con `marketValue`/`instanceValue`. |
| Arte de cartas (admin) | `server/services/cardArtwork.ts` → `estimatedValue`. |
| Otro sistema | `src/market/value.ts` tiene OTRO `marketValue(WorldPlayer)`, del modo carrera, que **no** es este. |

## 3. Qué significa «valor» hoy

**Son varios conceptos mezclados en un solo número:**
- referencia de mercado entre jugadores (ancla antifraude);
- valor de colección que se enseña en la UI;
- base de la venta rápida y del crafting locales (80 %);
- medida con la que se equilibran los sobres (F57.4).

El único valor que **se convierte en créditos en el servidor** (el desguace) NO sale de aquí. No se refactoriza en esta fase.

## 4–5. Distribución actual por clase (`marketValue`)

| Clase | n | mín | P10 | P25 | mediana | media | P75 | P90 | P95 | máx | desv. | OVR mín/medio/máx |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Base | 75 | 100 | 125 | 125 | 150 | 140 | 150 | 175 | 175 | 175 | 21 | 70 / 77,6 / 81 |
| Plata | 60 | 175 | 175 | 200 | 200 | 199 | 200 | 225 | 225 | 225 | 16 | 82 / 83,5 / 85 |
| Oro | 34 | 225 | 225 | 250 | 250 | 254 | 275 | 275 | 300 | 325 | 22 | 86 / 87,8 / 92 |
| Masters | 119 | 425 | 550 | 650 | 775 | 769 | 875 | 1.050 | 1.100 | 1.175 | 176 | 78 / 87,3 / 95 |
| **Champions** | 20 | 4.550 | 5.725 | 6.825 | **7.675** | **7.751** | 9.150 | 10.900 | 10.900 | 10.900 | 1.794 | 80 / 88,7 / 95 |
| **Prime** | 20 | 2.250 | 2.375 | 2.675 | **2.825** | **2.903** | 3.375 | 3.575 | 3.575 | 3.575 | 412 | 87 / 91,3 / 95 |
| Icon | 3 | 27.875 | 27.875 | 27.875 | 33.200 | 31.425 | 33.200 | 33.200 | 33.200 | 33.200 | 2.510 | 92 / 94,0 / 95 |

## 4 (explicación). El problema Champions vs Prime

El valor no mira la clase: mira el `rank` de la edición, y **champions-s tiene rank 10 y future-star rank 7**. Tres escalones de ×1,45 son ×3,05.

El OVR compensa muy poco: 1,06 por punto, y Prime solo tiene 2,5 puntos más de OVR medio (91,3 frente a 88,7), lo que da ×1,16.

Resultado: la clase Champions vale ×2,7 lo que vale Prime. El **100 %** de las Prime vale menos que la mediana de Champions, y la **peor** Champions (OVR 80, 4.550) vale más que la **mejor** Prime (OVR 95, 3.575).

## 5–7. Solapes y correlación OVR ↔ valor

| | Actual | Propuesto |
|---|---|---|
| Correlación global OVR↔valor / OVR↔log(valor) | 0,37 / 0,72 | **0,58 / 0,86** |
| Dentro de cada clase | 0,92–0,998 | 0,97–0,99 |
| % Prime < mediana Champions | **100 %** | 0 % |
| % Champions > mediana Prime | **100 %** | 0 % |
| P(Champions > Prime) (una carta al azar de cada) | 100 % | **7,3 %** |
| P(Masters > Champions) | 0 % | 6,1 % |
| P(Oro > Masters) | 0 % | 0,4 % |
| P(Prime > Icon) | 0 % | 5,0 % (15 % de las Prime superan a la Icon más barata) |

Hoy las clases no se solapan casi nada, porque manda la edición. Con la propuesta hay **solapes pequeños en las fronteras**, y siempre a favor de la carta con más OVR.

## 6–8. Fórmula propuesta (recomendación principal)

```
valor = redondeo( 50 × MULT[clase] × 1,13^(OVR − 70) )

MULT:  Base 1 · Plata 1 · Oro 1 · Masters 4 · Champions 10 · Prime 18 · Icon 25
```

- **Clase:** sale de `packCardClass` (F57.3). Base, Plata y Oro son la misma edición con el mismo multiplicador; entre ellas manda solo el OVR, así que no hay salto en 81→82 (×1,16) ni en 85→86 (×1,13), que es lo que da un punto de OVR.
- **OVR:**
  - 1 punto = ×1,13;
  - 3 puntos = ×1,44;
  - 8 puntos = ×2,66;
  - de 70 a 95 = ×21 (hoy, ×4,3).

  El OVR pasa a pesar **más** que ahora.
- **Regla de diseño:** cada salto de clase del tramo alto es menor que 8 puntos de OVR:
  - Masters→Champions ×2,5;
  - Champions→Prime ×1,8;
  - Champions→Icon ×2,5.

  Además, Prime→Icon (×1,39) es menor que 3 puntos. Icon queda solo ×25 sobre la edición base, sin un multiplicador gigante por tener 3 cartas.
- **Redondeo:**

  | Tramo de valor | Paso |
  |---|---|
  | < 50 | 1 |
  | < 100 | 5 |
  | < 1.000 | 10 |
  | < 10.000 | 50 |
  | resto | 100 |

  El paso relativo (≤ 10 %) es menor que el crecimiento por punto (13 %), así que el valor es estrictamente creciente con el OVR en cada clase: probado de OVR 60 a 99, sin empates ni saltos por encima de ×1,2 por punto.
- **Cómo se eligió:** se compararon unas 81.600 combinaciones de crecimiento y multiplicadores. Solo se aceptaron las que cumplían a la vez:
  - medianas y medias crecientes con saltos ≥ 25 %;
  - las comparativas de la §9;
  - la banda de sobres de F57.4.

  De ahí se tomaron números limpios.
- **Alternativa (una):** crecimiento 1,12 y multiplicadores 1/3/7/12/16 (escala 75). Cumple jerarquía y comparativas, pero deja los sobres a ±19,9 % (al límite de la banda) y Masters 95 apenas por encima de Champions 87. Se descarta.
- **Modelo aditivo** (curva de OVR + bonus fijo por clase): descartado. Un bonus fijo pesa demasiado en OVR bajos y casi nada en altos, y rompía «Icon 87 < Champions 95» o la jerarquía.

## 9. Enfrentamientos OVR frente a clase

| Enfrentamiento | Propuesto | Actual |
|---|---|---|
| Masters 95 vs Champions 87 | **4.250** vs 4.000 → gana Masters | 1.175 vs 6.825 |
| Champions 95 vs Prime 87 | **10.600** vs 7.200 → gana Champions | 10.900 vs 2.250 |
| Prime 95 vs Icon 92 | **19.100** vs 18.400 → gana Prime (por poco) | 3.575 vs 27.875 |
| Champions 95 vs Icon 87 | **10.600** vs 10.000 → gana Champions | 10.900 vs 20.825 (hoy gana Icon 87) |

## 9–11. Distribución propuesta por clase

| Clase | mín | P10 | P25 | **mediana** | **media** | P75 | P90 | P95 | máx | desv. |
|---|---|---|---|---|---|---|---|---|---|---|
| Base | 50 | 80 | 120 | 130 | 132 | 150 | 190 | 190 | 190 | 37 |
| Plata | 220 | 220 | 240 | 280 | 264 | 280 | 310 | 310 | 310 | 33 |
| Oro | 350 | 350 | 400 | 450 | 450 | 510 | 580 | 650 | 740 | 94 |
| Masters | 530 | 870 | 1.250 | 1.800 | 1.869 | 2.300 | 3.350 | 3.750 | 4.250 | 885 |
| Champions | 1.700 | 2.750 | 4.000 | 5.100 | 5.518 | 7.350 | 10.600 | 10.600 | 10.600 | 2.619 |
| Prime | 7.200 | 8.100 | 10.400 | 11.700 | 12.625 | 16.900 | 19.100 | 19.100 | 19.100 | 3.770 |
| Icon | 18.400 | 18.400 | 18.400 | 26.500 | 23.800 | 26.500 | 26.500 | 26.500 | 26.500 | 3.818 |

- **Medianas:** 130 < 280 < 450 < 1.800 < 5.100 < 11.700 < 26.500. ✅
- **Medias:** 132 < 264 < 450 < 1.869 < 5.518 < 12.625 < 23.800. ✅
- Cada escalón es como mínimo ×1,6 y nunca ×10 (Champions→Prime ×2,3; Prime→Icon ×2,3 en mediana).
- **Sin problemas por los OVR reales**, con una advertencia: Icon tiene 3 cartas y su media (23.800) la arrastra la Record Breaker 92 (18.400).

## 13. Sensibilidad por OVR (propuesto)

| Clase \ OVR | 70 | 75 | 80 | 85 | 90 | 92 | 95 | OVR real |
|---|---|---|---|---|---|---|---|---|
| Base / Plata / Oro (misma curva) | 50 | 90 | 170 | 310 | 580 | 740 | 1.050 | 70–81 / 82–85 / 86–92 |
| Masters | 200 | 370 | 680 | 1.250 | 2.300 | 2.950 | 4.250 | 78–95 |
| Champions | 500 | 920 | 1.700 | 3.150 | 5.750 | 7.350 | 10.600 | 80–95 |
| Prime | 900 | 1.650 | 3.050 | 5.650 | 10.400 | 13.200 | 19.100 | 87–95 |
| Icon | 1.250 | 2.300 | 4.250 | 7.800 | 14.400 | 18.400 | 26.500 | 92–95 |

Las cifras fuera del OVR real de cada clase son teóricas. La curva actual está en `ovr-sensitivity.json`.

## 14–15. Top 25

- **Actual:** 3 Icon, luego 19 Champions (del puesto 4 al 23, incluida la Champions 80) y la primera Prime en el puesto 24.
- **Propuesto:**
  - 1–2: mada (Moments 95) y marteen (Record Breaker 95), 26.500.
  - 3–5: las tres Prime 95 (Lar0k, Sato, Xross), 19.100.
  - 6: PatMen (Record Breaker 92), 18.400.
  - 7–14: Prime de 94 a 91.
  - 15–16: slowly y splash (Champions 95), 10.600.
  - 17–25: Prime 90–88 intercaladas con Champions 94–93.

El detalle completo está en `top25-comparison.json`.

## 16–17. Mayores subidas y bajadas (`outliers.json`)

- **Subidas:** las 20 Future Star, de +241 % a +434 % (Prime 95: 3.575 → 19.100). Además Masters L 95 (primmie, Jinggg): 1.175 → 4.250 (+262 %).
- **Bajadas:**
  - Champions de OVR bajo: SiuFatBB (80) 4.550 → 1.700 (−63 %), las Champions 84 −52 %, las 87 −41 %.
  - Base 70–74: −35 a −50 % (100 → 50–80).
  - PatMen (Record Breaker 92) 27.875 → 18.400 (−34 %).
- **Comprobaciones automáticas:**
  - 0 valores ≤ 0.
  - 0 no finitos.
  - Máximo 26.500 (sin riesgo de overflow).
  - 0 inversiones entre cartas casi idénticas.
  - Pasos por punto de OVR entre ×1,08 y ×1,2, sin ningún empate.
  - Solo 5 «cambios extremos» (más de ×5): son las Future Star de 94 y 95, y es justo la corrección buscada.

## 18–21. Impacto en F57.4 (precios, probabilidades y cartas SIN tocar; 200.000 aperturas por sobre)

| Sobre | Precio | EV analítico | EV simulado | EV/precio actual → propuesto | P10 | P25 | P50 | P75 | P90 | P95 | P99 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Bronce | 1.000 | 5.725 | 5.723 | 4,55× → **5,72×** | 835 | 1.050 | 2.090 | 7.790 | 17.300 | 22.470 | 32.220 |
| Plata | 2.500 | 12.977 | 12.958 | 4,49× → **5,19×** | 1.970 | 3.270 | 8.850 | 19.940 | 30.080 | 37.030 | 53.230 |
| Oro | 4.000 | 20.675 | 20.652 | 4,46× → **5,17×** | 4.090 | 7.660 | 17.500 | 30.110 | 41.300 | 49.250 | 64.800 |
| Masters | 5.000 | 25.533 | 25.503 | 4,40× → **5,11×** | 7.490 | 12.940 | 23.050 | 34.800 | 47.170 | 55.200 | 69.950 |
| Champions | 8.000 | 40.957 | 40.963 | 4,88× → **5,12×** | 18.070 | 27.320 | 39.480 | 52.650 | 65.700 | 73.700 | 88.880 |
| **Icon** | 12.500 | 47.933 | 47.943 | 2,75× → **3,83×** | 33.900 | 39.600 | 47.300 | 55.300 | 63.400 | 66.200 | 72.100 |

- **La propuesta NO rompe F57.4.** Los cinco quedan a ±10,6 % de su mediana (5,17×), dentro de la banda de ±20 %. Icon queda a 0,74× esa mediana (suelo 0,6×).
- **Bronce pasa a ser el de más valor por crédito** (+10,6 % sobre la mediana). Si se quisiera centrarlo, sería materia de la F57.6, **no de esta fase**.
- El nivel absoluto de EV/precio sube (~4,5× → ~5,2×) porque la escala de valor es otra. Eso no afecta a la comparación entre sobres.

**Sobre Icon (12.500 créditos, 3 cartas, 70/30 por carta):**

| EV | Mediana | P90 | P99 | EV/precio | Mínimo posible | Máximo posible |
|---|---|---|---|---|---|---|
| 47.933 | 47.300 | 63.400 | 72.100 | 3,83× | 21.600 (3 Prime 87) | 79.500 (3 Icon 95) |

Su EV es el mayor de la línea; lo que se paga de más es la garantía de top tier. Sigue siendo un producto premium razonable: ya no es una trampa y tampoco es el más rentable.

**Coste de conseguir Prime/Icon:** **no cambia**, porque depende del precio y de las probabilidades, no del valor.

| Sobre | Créditos esperados hasta la 1.ª Prime | 1.ª Icon | 1.ª Prime o Icon |
|---|---|---|---|
| Bronce | 7.079 | 20.404 | 5.416 |
| Plata | 9.437 | 14.968 | 6.351 |
| Oro | 9.768 | 13.144 | 6.600 |
| Masters | 10.587 | 14.666 | 7.437 |
| Champions | 11.899 | 14.381 | 9.050 |
| Icon | 12.847 | 19.026 | 12.500 |

Por carta, Icon sigue siendo la vía más barata hacia una Prime (5.952).

## 22. Impacto potencial en el Marketplace (OFF; no se toca)

- **Anclas persistidas:** `card_reference.fair_value` y `content_card_market_anchor.fair_value` guardan `marketValue` como dato. Si se implementa la propuesta, hay que **re-sincronizarlas**: es una operación de datos con `api/market/sync-reference` y el admin, **no una migración de esquema**. Mientras no se haga, la banda antifraude (`_market_check_band`: ancla × min/max_price_mult) seguiría usando los valores viejos. Un anuncio de una Prime a su valor nuevo (p. ej. 19.100 frente al ancla 3.575) quedaría fuera de banda y marcado.
- **`card_price_stats.avg_price`:** tiene prioridad sobre el ancla y no cambia sola.
- **Precio sugerido / referencia:** `server/services/market.ts` (`reference`), `marketplace/value.ts` y los componentes de mercado pasarían al valor nuevo automáticamente, porque leen la función.
- **`market_config.min_price` (25):** no le afecta. El mínimo propuesto es 50 en catálogo.

## 22 bis. Cerrojos de `marketReadiness` con la propuesta

Los dos criterios medibles del cerrojo del mercado leen `marketValue`. Con la propuesta **siguen pasando** los dos.

| Bucket (edición) | Ancla actual → propuesta (banda 0,2–2,5) | Desguace / carta más barata, actual → propuesto (< 1) |
|---|---|---|
| common (base) | 0,78 → 1,03 | 0,30 → **0,60** |
| uncommon (masters) | 0,27 → 0,65 | 0,16 → 0,13 |
| rare (future-star) | 0,42 → 1,83 | 0,09 → 0,03 |
| epic (champions-s) | 1,58 → 1,12 | 0,13 → 0,35 |
| legendary (icon) | 1,58 → 1,20 | 0,06 → 0,09 |

**Hallazgo aparte (no se corrige):** el bucket de rareza, que sale de `bucketForRank` (rank de la edición), tiene la **misma inversión** que el valor.

- future-star (rank 7) es `rare` y champions-s (rank 10) es `epic`.
- Por eso el desguace del servidor paga **200 por una Prime y 600 por una Champions**.

La propuesta no lo toca, porque el desguace no depende del valor. Pero es la misma incoherencia de jerarquía y convendría decidirla junto a la F57.6.

Margen que se estrecha: el desguace de una Base OVR 70 pasa a ser el 60 % de su valor (hoy, el 30 %). Sigue por debajo de 1, así que comprar y desguazar no da beneficio.

## 23. Riesgos

1. **Cambio visible en colecciones:** el «valor de colección» de quien tenga Champions de OVR bajo baja hasta −63 % y el de quien tenga Future Star sube hasta ×5,3. Conviene comunicarlo.
2. **Anclas del mercado desincronizadas** si se implementa sin re-sincronizar (ver §22).
3. **`packStats.meanValue`** y la guía de los sobres cambian al regenerarlos.
4. **Economía local sin sesión:** la venta rápida y el crafting (80 %) de las Future Star suben mucho. Es un modo de un solo jugador, sin efecto competitivo.
5. **Icon con 3 cartas:** su media depende mucho de qué carta sea (18.400 frente a 26.500). Si entran más Icon, la media se mueve sola, pero la fórmula no.
6. **No afecta al juego:** el valor no toca OVR, stats, rol, combate, mazos, Draft, Coach ni competitivo; la propuesta ni siquiera está conectada.

## 24–28. Gates, ficheros y estado

- **Tests:** 5017 → **5026/5026** (+9 de la propuesta).
- **tsc web:** ✅.
- **tsc scripts:** ✅, tras corregir un error de tipos en `scripts/_fase57-4-runtime.ts` (script de QA de F57.4, fuera de CI; ver abajo).
- **eslint:** 0 errores, los mismos 27 avisos de antes.
- **Re-pasadas el 2026-09-24:**
  - `npm test`: 5026/5026.
  - `tsc` web y scripts: 0 errores.
  - `eslint src`: 0 errores y los mismos 27 avisos.
- **`npm run build`:** no ejecutado, por tres motivos:
  - ningún código de la app importa los ficheros nuevos;
  - en `cardValueProposal*.ts` no hay patrones `[x:y]` que Tailwind pueda leer como clases;
  - el build pisaría el `.next` que sirve :3005.

  :3005 y el túnel no se han tocado.
- **Ajeno a esta fase:** `src/design/tokens.ts` se modificó el 2026-09-23 a las 23:34, dentro de la ventana de esta fase, con tokens de diseño (CHAMFER, RECESSED, READOUT, DEPTH…). No es trabajo de la F57.5 y no se ha tocado; parece de otra sesión en paralelo.
- **Creados:**
  - `src/domain/economy/cardValueProposal.ts`
  - `src/domain/economy/cardValueProposal.test.ts`
  - `scripts/_fase57-5-card-value.ts`
  - `docs/product/qa/fase57-5-card-value/*` (8 JSON y 1 CSV)
  - este informe
- **Modificado:** `scripts/_fase57-4-runtime.ts`. Se quitó un segundo argumento no admitido en `shot()`: el script lo añadí después de pasar el tsc de F57.4 y no volví a pasarlo, así que el «tsc scripts OK» de F57.4 no era cierto al cerrar. No afecta al runtime.
- **BD modificada:** NO.
- **Runtime modificado:** NO.
- **Migraciones:** 0 (siguen 54).
- **Mercado y pagos:** `GLOBAL_MARKET_ENABLED` y `PAYMENTS_ENABLED` siguen en `false`.

## 29. Recomendación matemática

Implementar **`50 × MULT[clase] × 1,13^(OVR − 70)`** con MULT = 1/1/1/4/10/18/25 y el redondeo por tramos, sustituyendo el cuerpo de `marketValue`:

- arregla la inversión Champions/Prime: la mediana de Prime pasa a ser 2,3 veces la de Champions, frente a 0,37 veces hoy;
- hace que el OVR pese más (correlación con log(valor) 0,72 → 0,86);
- mantiene las comparativas de rendimiento que pediste;
- deja F57.4 en banda **sin tocar precios**.

Al implementarlo harán falta: regenerar `packStats`, re-sincronizar las anclas del mercado y ajustar los tests que fijan valores concretos.

## 30. ESPERANDO APROBACIÓN

No se ha implementado nada.
