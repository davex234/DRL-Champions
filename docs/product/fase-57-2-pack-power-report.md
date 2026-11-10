# Hotfix 57.2 — Progresión real de sobres («Bronce no puede dar cartas top»)

2026-09-23 · rama `arch/stabilization` · sin commit, sin push, sin deploy · **0 migraciones**.

Evidencia: `docs/product/qa/fase57-2-pack-power/` (`sim.json` = 800.000 aperturas simuladas, `runtime.json` + `ficha-*.png` = fichas servidas por la app de :3005).
Instrumentos fuera de CI: `scripts/_fase57-2-sim.ts`, `_fase57-2-dist.ts`, `_fase57-2-excluded.ts`, `_fase57-2-runtime.ts`.

---

## 1. Causa exacta

Un Sobre Bronce entregó `brawk__masters-l` (OVR 93). Esto pasaba por tres motivos que se sumaban:

- **Cómo se sorteaba.** El motor (`openPack` → `buildPool` → `isEligible`) agrupa las cartas en buckets por la **rareza de su edición**: `bucketForRank(variant.rank)`. En ningún punto miraba el OVR.
- **La rareza no dice nada del poder.** En el catálogo diseñado, la edición base («común») llega a OVR 92 y Masters L / SDC («poco común») llegan a 95.
- **Bronce no filtraba nada más.** Bronce sortea 55 % común y 35 % poco común, así que cualquiera de esas 288 cartas era elegible. 79 de ellas tienen OVR ≥ 88. Masters L es poco común, y por eso la 93 del jugador entró por la vía normal: no fue pity, ni fallback, ni error de BD.

Medido antes del arreglo (100.000 Bronces): **67,7 % de los sobres traían al menos una carta ≥ 90**, un 9,8 % traían una de 95, y el máximo fue 95.

## 2. Distribución real del catálogo (331 cartas)

OVR: mín 70 · p10 78 · p25 81 · **mediana 85** · p75 89 · p90 92 · p95 93 · máx 95.

| Rareza (bucket) | Ediciones | n | OVR mín | mediana | máx |
|---|---|---|---|---|---|
| común | base | 169 | 70 | 82 | 92 |
| poco común | masters-l (59), masters-sdc (60) | 119 | 78 | 88 | 95 |
| rara | future-star | 20 | 87 | 91 | 95 |
| épica | champions-s | 20 | 80 | 88 | 95 |
| legendaria | record-breaker (2), moments (1) | 3 | 92 | 95 | 95 |

Hay 9 cartas de OVR 95, repartidas en cinco ediciones distintas.

## 3. Reglas finales (`src/domain/packs/power.ts` → `PACK_POWER_RULES`, fuente única)

| Sobre (id) | Techo OVR | Qué contiene |
|---|---|---|
| Bronce (`estandar`) | **≤ 85** | Cartas de nivel bajo y medio |
| Plata (`premium`) | **≤ 89** | Mejor que Bronce, sin el tramo alto |
| Oro (`oro`) | **≤ 93** | Acceso real a cartas muy buenas |
| Icon (`icon`) | **sin techo** | Las mejores del catálogo que admita su pool |

- **Dónde se aplica.** En el único filtro de elegibilidad del pool, `isEligible`, en su primera línea y en el servidor. Todos los caminos que eligen carta eligen dentro de ese pool, así que una carta por encima del techo no tiene ninguna vía para salir: peso, garantía, pity, hueco imposible, anti-duplicado (`resolveAntiDup` usa el `flat` del pool) y `engine.odds()`. Un bucket que se queda vacío se renormaliza. No hay fallback al catálogo.
- **Qué no cambia.** Precios, pesos, cartas por sobre, garantías, catálogo, stats y CardArt.
- **Catálogo persistido.** El servidor sortea con `content_cards`, cuya columna `ovr` es `int not null check 1..99`, así que el filtro vale igual. Si un OVR no fuera un número finito, la carta quedaría fuera del techo: el fallo es cerrado.

## 4. Por qué esos cortes

Los cortes salen de la distribución medida, no de números redondos:

| Sobre | Corte | Razón |
|---|---|---|
| Bronce | ≤ 85 (mediana) | Le deja la mitad baja y media del catálogo. |
| Plata | ≤ 89 (p75) | Da cartas buenas (86–89) sin el tramo alto ≥ 90. Conserva 5 raras y 13 épicas, así que su garantía de rara sigue viva. |
| Oro | ≤ 93 (p95) | Da acceso real a 90–93, con un 91 % de sobres con al menos una ≥ 90, y reserva 94–95 para Icon. Conserva 17 épicas para su garantía. |
| Icon | sin techo | Es el escalón top. Su pool (rara/épica/legendaria) ya era el correcto. |

## 5. Cartas elegibles por sobre

| Sobre | Antes | Ahora | común | poco común | rara | épica | legendaria |
|---|---|---|---|---|---|---|---|
| Bronce | 331 | **181** | 135 | 41 | 0 | 5 | 0 |
| Plata | 331 | **261** | 163 | 80 | 5 | 13 | 0 |
| Oro | 331 | **315** | 169 | 113 | 15 | 17 | 1 |
| Icon | 331 | 331 | 169 | 119 | 20 | 20 | 3 |

## 6. Cartas y ediciones excluidas

| Sobre | Excluidas | Por edición |
|---|---|---|
| Bronce | 150 | masters-l 41 · masters-sdc 37 · base 34 · future-star 20 · champions-s 15 · record-breaker 2 · moments 1 |
| Plata | 70 | masters-l 22 · masters-sdc 17 · future-star 15 · champions-s 7 · base 6 · record-breaker 2 · moments 1 |
| Oro | 16 | future-star 5 · masters-l 4 · champions-s 3 · masters-sdc 2 · record-breaker 1 · moments 1 |
| Icon | 0 | — |

**No se excluye ninguna edición entera por nombre.** El criterio es el OVR de cada carta, porque la edición no predice el poder.

## 7. Resultados de la simulación

100.000 aperturas por sobre con el motor real (`PackEngine`) y sin BD. Se simuló cada sobre también **sin regla** (mismo sobre con otro id) para comparar antes y después.

### OVR por carta

| Sobre | mín | media | mediana | P90 | P95 | P99 | **máx** |
|---|---|---|---|---|---|---|---|
| Bronce ahora | 70 | 81,27 | 82 | 85 | 85 | 85 | **85** |
| Bronce antes | 70 | 84,61 | 85 | 92 | 93 | 95 | 95 |
| Plata ahora | 70 | 85,16 | 86 | 89 | 89 | 89 | **89** |
| Plata antes | 70 | 87,23 | 88 | 94 | 95 | 95 | 95 |
| Oro ahora | 70 | 87,79 | 89 | 92 | 93 | 93 | **93** |
| Oro antes | 70 | 88,61 | 89 | 95 | 95 | 95 | 95 |
| Icon (sin cambios) | 80 | 91,87 | 92 | 95 | 95 | 95 | **95** |

### Probabilidades por carta y por sobre

| Sobre | P(≥80) carta | P(≥85) carta | P(≥90) carta | P(≥95) carta | ≥1 de ≥90 en el sobre | ≥1 de 95 en el sobre |
|---|---|---|---|---|---|---|
| Bronce | 70,5 % | 16,9 % | **0 %** | **0 %** | **0 %** (antes 67,7 %) | 0 % (antes 9,8 %) |
| Plata | 89,2 % | 64,4 % | **0 %** | **0 %** | **0 %** (antes 95,4 %) | 0 % (antes 34,1 %) |
| Oro | 96,2 % | 78,8 % | 38,2 % | **0 %** | 91,0 % (antes 95,0 %) | 0 % (antes 43,9 %) |
| Icon | 100 % | 94,0 % | 75,6 % | 39,4 % | 100 % | 81,7 % |

### Rareza, edición, duplicados y sobres completos

| Sobre | Rareza (por carta) | Edición (por carta) | Duplicados en el sobre | Sobres incompletos |
|---|---|---|---|---|
| Bronce | común 60,0 · poco común 38,0 · épica 1,95 | base 60,0 · SDC 21,3 · L 16,7 · champions 1,95 | 1,27 % (antes 0,64) | 0 |
| Plata | poco común 37,9 · rara 27,7 · común 25,3 · épica 9,1 | future-star 27,7 · base 25,3 · SDC 20,3 · L 17,5 · champions 9,1 | 3,87 % (antes 1,28) | 0 |
| Oro | poco común 32,1 · épica 30,7 · rara 23,9 · común 7,9 · legendaria 5,3 | champions 30,7 · future-star 23,9 · SDC 16,5 · L 15,7 · base 7,9 · record-breaker 5,3 | 2,20 % (antes 1,61) | 0 |
| Icon | legendaria 50,1 · épica 30 · rara 19,9 | idéntico al de antes | 6,58 % (igual) | 0 |

**Máximo OVR observado en Bronce: 85.**

## 8. Media, P95, P99 y máximo por sobre

| Sobre | Media | P95 | P99 | Máx |
|---|---|---|---|---|
| Bronce | 81,3 | 85 | 85 | 85 |
| Plata | 85,2 | 89 | 89 | 89 |
| Oro | 87,8 | 93 | 93 | 93 |
| Icon | 91,9 | 95 | 95 | 95 |

La media, el P95, el P99 y el máximo crecen en cada escalón (el mínimo, 70, es el mismo en Bronce, Plata y Oro).

## 9. Prueba de que Bronce ya no puede dar una 93

- **Test de regresión** (`power.test.ts`). `brawk__masters-l` (93, poco común) era elegible sin la regla y ya no lo es ni en Bronce ni en Plata. Sí lo es en Oro, porque 93 es su techo.
- **Propiedad** (`power.test.ts`). Para cada una de las 331 cartas: si su OVR supera el techo, `isEligible` devuelve falso y la carta no está en el pool (Bronce, Plata y Oro). Además, el pool nuevo es exactamente «pool de antes ∩ techo».
- **Motor real.** 4.000 aperturas por sobre con la colección llena, para activar el anti-duplicado, y el contador de pity cargado (ningún sobre base declara pity hoy; el test lo cubre por si lo declara): ninguna carta por encima del techo y todos los sobres completos.
- **Servidor** (`packs.power.service.test.ts`). 60 aperturas reales por `openPackForUser` en cada gama, contra el Supabase en memoria con la RPC `app_apply_pack_open`: ninguna **fila persistida** supera el techo.
- **Simulación.** Con 100.000 Bronces, el máximo fue 85.
- **Runtime.** La ficha `/packs/estandar` servida por la app en :3005 muestra «OVR 85 como máximo» y «No contiene rara ni legendaria», y no ofrece esas rarezas.

## 10. Sobres especiales intactos

- Ninguno de los 28 productos fuera de la gama base tiene regla.
- Su pool es **idéntico** al de antes, comprobado por test en todos. Incluye Team Heretics, Fnatic, G2, Liquid, Karmine, EMEA, Americas, Pacific, China, Masters, Champions, EWC e Inicial.
- `packStats.ts` regenerado: las 27 filas de especiales de pago quedan byte a byte iguales (Inicial es gratis y no tiene fila). Solo cambian las de `estandar`, `premium` y `oro`.
- En runtime, Team Heretics y Masters no muestran techo y conservan sus cinco rarezas.

## 11. Tests antes y después

| | Antes | Después |
|---|---|---|
| Tests totales | 4965 | **4983** |
| Resultado | 4965/4965 | **4983/4983 ✅** |

- **+18 tests:** 12 en `src/domain/packs/power.test.ts` y 6 en `src/server/services/packs.power.service.test.ts`.
- **3 pins reescritos** a su intención en `basePackLine.test.ts`. Fijaban lo que este hotfix corrige:
  - «el pool de la gama base es el catálogo entero»;
  - «ninguna rareza imposible»;
  - «todas ≥ 4,5× de valor».
- **Seguridad.** Reintento, doble clic simultáneo y carrera con el mismo gesto devuelven las mismas cartas, gastan un solo sobre y no hacen otro sorteo, en las tres gamas. Se suma a los tests de F38.
- **Probabilidades.** `engine.odds()` suma 100 ± 0,3 y los buckets vacíos quedan a 0.
- **Catálogo:** 331.

## 12. tsc

`tsc` web ✅ · `tsc -p tsconfig.scripts.json` ✅.

## 13. Lint

`eslint src`: 0 errores. Hay 27 avisos, todos de antes; los ficheros tocados salen limpios.

## 14. Build

`npm run build` ✅. Se paró la app de :3005, se compiló y se relanzó (`next start`, PID 31480). El túnel (PID 15620) no se tocó.

## 15. Migraciones

**0.** El techo es lógica de sorteo del servidor y no hace falta nada en BD. No se ha tocado ninguna cuenta: no se ha abierto ni comprado ningún sobre de la demo ni de QA. La prueba de runtime visita las fichas sin sesión.

## 16. Ficheros

### Nuevos

- `src/domain/packs/power.ts`: regla canónica, `withinPackPower` y `packPowerCap`.
- `src/domain/packs/power.test.ts`
- `src/server/services/packs.power.service.test.ts`
- `scripts/_fase57-2-{sim,dist,excluded,runtime}.ts`
- `docs/product/qa/fase57-2-pack-power/*`
- este informe

### Modificados (diff quirúrgico contra copia previa)

| Fichero | Cambio |
|---|---|
| `src/domain/packs/pool.ts` | +7: la regla en `isEligible` |
| `src/domain/packs/odds.ts` | +4: `powerCap` en `PackOdds` |
| `src/components/packs/PackOdds.tsx` | +7: línea «OVR N como máximo · …» en «Qué puede salir» |
| `src/data/packs.ts` | 3 descripciones, solo texto y sin cifras (el número sale de la regla) |
| `src/data/packStats.ts` | Regenerado con `npm run economy:model -- --emit`; cambian 3 filas |
| `src/domain/economy/marketReadiness.ts` | `anchorRatios`: la entrada por rareza es el primer sobre de la escalera que puede darla (ver punto 17) |
| `src/data/basePackLine.test.ts` | 3 pins |

## 17. Efectos colaterales que decide el producto, y GO/NO-GO

### Efectos colaterales (medidos, no escondidos)

**1. El valor medio del contenido baja, porque ya no salen cartas top.** La relación valor por crédito sigue creciendo al subir de escalón y Oro sigue por encima de Prime.

| Sobre | Valor por crédito (antes → ahora) | Desguace medio (antes → ahora) |
|---|---|---|
| Bronce | 5,34× → 2,85× | 353 → 280 |
| Plata | 5,48× → 3,77× | 992 → 867 |
| Oro | 5,01× → 4,61× | 1709, sin cambio |

Los precios no se han tocado, como se pidió. Si se quiere recuperar valor por crédito en Bronce o Plata, esa decisión de precio es aparte.

**2. Ancla del mercado (cerrado).** Medía el coste por rareza con Bronce. Como Bronce ya no da raras ni legendarias, la referencia por rareza pasa al primer sobre de la escalera que sí las da:

| Rareza | Referencia | Ratio |
|---|---|---|
| rara | Plata | 1,91× |
| legendaria | Oro | 1,70× |

Las cinco rarezas siguen dentro de la banda 0,2–2,5. `GLOBAL_MARKET_ENABLED` sigue en `false`.

**3. Legendaria de Oro.** Solo una legendaria tiene OVR ≤ 93 (record-breaker, 92). Los pesos de Oro no cambian (3 %), así que un 5,3 % de las cartas de Oro son esa misma carta. Es honesto, pero concentrado.

**4. Duplicados dentro del sobre.** Suben porque los pools son más pequeños: Plata pasa de 1,3 % a 3,9 %.

**5. Deuda previa, no introducida aquí.** El panel de probabilidades de F25 marca «Garantizada» también en las rarezas **por debajo** de la garantía (Plata: «Común · Garantizada»). Es verdad en sentido estricto («al menos una común o superior») pero confunde. No se ha tocado porque queda fuera del alcance.

### Veredicto: **GO**

Bronce, Plata y Oro no pueden superar su techo por ningún camino: peso, garantía, pity, fallback, anti-duplicado, reintento, recuperación o carrera. Queda demostrado con propiedades sobre todo el catálogo, con el motor real, con las filas persistidas por el servicio, con 400.000 aperturas simuladas y en runtime. Icon y los 28 especiales no cambian. 0 migraciones.
