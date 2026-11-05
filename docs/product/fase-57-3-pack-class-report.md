# Fase 57.3 — Pack Class Distribution (Bronce · Plata · Oro · Masters · Champions · Icon)

2026-09-23 · sin commit, sin push, sin deploy · **0 migraciones** · **estado: GO** (build y runtime verificados tras autorización; ver §22 y cierre).

Evidencia: `docs/product/qa/fase57-3-pack-class/` (`sim.json` = simulación pura; `specials-identity.json` = sobres especiales antes/después).
Instrumento fuera de CI: `scripts/_fase57-3-sim.ts`.

## 1. Baseline antes / después

| | Antes | Después |
|---|---|---|
| Tests | 4983/4983 | **5007/5007** |
| Sorteo de los 6 sobres | rareza de variante + techo de OVR (57.2) | **clase de sobre** (`packClass`) |
| Cartas del Sobre Icon | 3 | **1** |
| Precio del Sobre Icon | 20.000 | 20.000 |
| Migraciones | 54 | 54 |

## 2–4. Clasificación de las 331 cartas (medida en el catálogo real y en `content_cards` de BD)

`packCardClass(card)` (`src/domain/packs/packClass.ts`) la deriva de `variantId` (edición) y `ovr`. No modifica ninguna carta.

| Clase | Regla | Cartas |
|---|---|---|
| Base | base, OVR 70–81 | **75** |
| Plata | base, OVR 82–85 | **60** |
| Oro | base, OVR 86–92 | **34** |
| Masters | masters-l (59) + masters-sdc (60) | **119** |
| Champions | champions-s | **20** |
| Prime | future-star | **20** |
| Icon | record-breaker (2) + moments (1) | **3** |
| **Total** | | **331** |

classified 331 · unclassified 0 · multiClassified 0 (test). El catálogo de BD (vía túnel, solo lectura) da exactamente los mismos recuentos.

## 5–6. Tabla final y fuente de verdad

| % por carta | Base | Plata | Oro | Masters | Champions | Prime | Icon |
|---|---|---|---|---|---|---|---|
| Bronce | 50 | 25 | 10 | 7 | 4 | 3 | 1 |
| Plata | 0 | 50 | 25 | 10 | 7 | 5 | 3 |
| Oro | 0 | 0 | 50 | 23 | 10 | 10 | 7 |
| Masters | 0 | 0 | 25 | 40 | 15 | 12 | 8 |
| Champions | 0 | 0 | 15 | 20 | 30 | 20 | 15 |
| Icon (1 carta) | 0 | 0 | 0 | 0 | 0 | 70 | 30 |

Fuente única: `packCardClass(card)` y `mainPackDistribution(packId)` en `src/domain/packs/packClass.ts`. De ahí leen: el motor (`openPack` → `openByClass`), `engine.odds()`, `validatePack`, el simulador de economía, la ficha (`classOddsFor` → `PackOddsPanel`), la tienda/eventos (`PackStoreCard`, `ShopHero`, `StoreProducts`, `PurchaseModal`) y los tests. `packDrawMode(packId)` dice explícitamente `class-distribution` o `rarity-weights`.

Progresión fijada por test: P(Prime) 3 → 5 → 10 → 12 → 20 → 70 y P(Icon) 1 → 3 → 7 → 8 → 15 → 30, ambas estrictamente crecientes.

## 7. power.ts / F57.2

`power.ts` no se borra. `PACK_POWER_RULES` queda **vacío** (los cuatro con techo eran Bronce, Plata, Oro e Icon, y los cuatro pasan a la tabla). Ningún otro sobre tenía techo, así que ninguno cambia. `withinPackPower` sigue en `isEligible` y no filtra nada. Un test impide que un sobre tenga a la vez techo y tabla.

## 8. Ningún bucket > 0 vacío

Se comprueba en tres sitios:
- En un test, para los seis sobres.
- En `validatePack`.
- En el catálogo del servidor: `estandar`, `premium`, `masters`, `champions` e `icon` tienen pool persistido (las 331 cartas, peso 1) y `oro` no tiene. Todas las clases con probabilidad tienen cartas.

Si una clase con probabilidad > 0 se quedara vacía, `openPack` lanza `EmptyPackClassError` (fallo cerrado, sin fallback). Está probado con un Icon sin cartas Icon.

## 9–10. Simulación pura (200.000 cartas por sobre; 200.000 aperturas de Icon)

| Sobre | Desviación máx. por clase | OVR mín | media | mediana | P90 | P95 | P99 | máx |
|---|---|---|---|---|---|---|---|---|
| Bronce | 0,106 pp | 70 | 81,78 | 81 | 89 | 92 | 95 | 95 |
| Plata | 0,098 pp | 78 | 86,05 | 85 | 92 | 93 | 95 | 95 |
| Oro | 0,106 pp | 78 | 88,57 | 88 | 93 | 95 | 95 | 95 |
| Masters | 0,203 pp | 78 | 88,67 | 88 | 94 | 95 | 95 | 95 |
| Champions | 0,166 pp | 78 | 89,60 | 89 | 95 | 95 | 95 | 95 |
| Icon | 0,020 pp (70,02 / 29,98) | 87 | 92,07 | 92 | 95 | 95 | 95 | 95 |

- No salió ninguna clase con 0 %.
- No hubo ningún sobre incompleto.
- El simulador de economía coincide con `openPack` en 15.000 semillas (Bronce, Plata y Champions).

El detalle esperado/observado por clase está en `sim.json`.

## 11–14. Icon

- Hay **20 cartas Prime y 3 Icon**.
- Dentro de su clase la selección es uniforme:
  - Prime: 1/20 = 5 % de la clase, o sea **3,5 %** por apertura para cada Future Star.
  - Icon: 1/3 de la clase, o sea **10 %** por apertura para cada Record Breaker o Moments.
  - Medido: Prime entre 4,90 y 5,09 %; Icon entre 33,0 y 33,6 %.
- **Exactamente 1 carta**: 5.000 aperturas del motor y 40 aperturas por la ruta del servidor (1 fila persistida por apertura).
- Solo sale future-star, record-breaker o moments. Nunca base, masters-l, masters-sdc ni champions-s.
- 70/30 real: 70,02 / 29,98.
- Precio: 20.000.
- **Si el usuario ya las tiene todas**, la política anti-duplicado del sobre es `allow` (sin cambios). El 100 % de las aperturas da un duplicado (medido con 20.000) y no hay compensación automática. No se ha tocado.

## 15. Masters y Champions

Sortean con la tabla. No cambian su precio (5.000 y 8.000), su arte, su `eventId`, su etiqueta «Evento» ni su nombre. Solo cambia la descripción, porque prometía «épica garantizada» y eso ya no es verdad.

## 16. Sobres especiales intactos

Se comparó el `openPack` anterior (copia) con el actual en los **26** sobres fuera de la línea: 1.500 semillas × (colección vacía / llena) × (sin pool / pool de BD real, incluidos los sesgos de equipo). Son 156.000 sorteos y hubo **0 diferencias**. En `packStats.ts` las 25 filas especiales son idénticas; solo cambian las 6 de la línea.

**Efecto derivado visible:** el texto de «guía» («la vía más barata para…») se calcula comparando lo medido entre todos los sobres. Como Bronce da ahora comunes más baratas (176 frente a 249), cambian las cifras de la guía de algunos especiales (p. ej. «7 veces» → «10 veces» más caro por común) y los titulares de EMEA y China. Es medición verdadera, no un cambio de reglas. Además se ajustó la guía para que un sobre que es la vía barata de una rareza de colección se presente así: Bronce ya no dice «pensado para perseguir rareza».

## 17. Fix «Garantizada» (F25)

Una fila de rareza solo dice «Garantizada» si es la rareza garantizada **y** no puede salir otra superior. Las inferiores nunca. Por ejemplo, EWC (épica o superior) ya no marca ninguna fila y el texto «Garantiza al menos una épica o superior» se mantiene.

En la línea principal solo Icon comunica garantía: **«Prime o Icon garantizada»**. Se quitaron las etiquetas «Rara garantizada», «Épica garantizada» y «Legendario» de Plata, Oro e Icon, y en tienda/eventos el «X+ garantizada» de los seis.

## 18. Apertura de una carta

- Con una carta, la ceremonia pone «1 carta», muestra un solo dorso y no enseña «Una a una · Revelar todas».
- Durante el revelado no hay tira ni contador «1 / 1», ni huecos reservados.
- El arnés `design-system/fase57` pasa a `ICON1`.

Probado con tests de render/código y verificado en runtime (arnés, 1440 y 390; ver Cierre).

## 19–22. Gates

| Gate | Resultado |
|---|---|
| `npm test` | **5007/5007** ✅ (antes 4983) |
| `tsc` web | ✅ |
| `tsc -p tsconfig.scripts.json` | ✅ |
| `eslint src` | 0 errores; 27 avisos, los mismos de antes (ninguno en código de esta fase) |
| `npm run build` | **PASS** tras autorización (ver Cierre). |

## 23–25. Migraciones, catálogo, mercado y pagos

- 0 migraciones (siguen 54).
- Catálogo: 331 cartas, sin tocar.
- `GLOBAL_MARKET_ENABLED = false` y `PAYMENTS_ENABLED = false`.

## 26. Ficheros

### Nuevos

- `src/domain/packs/packClass.ts`
- `src/domain/packs/packClass.test.ts`
- `src/components/packs/f573.packClass.ui.test.tsx`
- `scripts/_fase57-3-sim.ts`
- `docs/product/qa/fase57-3-pack-class/*`
- este informe

### Modificados (diff quirúrgico contra copia previa)

- **Motor y dominio:** `domain/packs/openPack.ts` (ruta por clase), `power.ts` (reglas vacías), `pool.ts` (comentario), `odds.ts` (`classOddsFor` + fix F25), `guidance.ts` (regla de colección); `pack/engine.ts`, `pack/types.ts` y `pack/validate.ts`; `domain/economy/simulator.ts`.
- **Datos:** `data/packs.ts` (Icon con `cardCount: 1`, textos y etiquetas) y `data/packStats.ts` (regenerado, cambian 6 filas).
- **UI:** `PackOdds.tsx`, `PackStoreCard.tsx`, `ShopHero.tsx`, `ShopRail.tsx`, `StoreProducts.tsx`, `PurchaseModal.tsx`, `storeView.ts`, `PackStage.tsx`, `PackOpeningExperience.tsx`, `PackOpenStage.tsx`, `MyPacks.tsx`, `packCatalog.ts`, `app/packs/[packId]/page.tsx`, `design-system/fase57/{fixtures,page}`.
- **Tests reescritos a su intención nueva:** `power.test.ts`, `packs.power.service.test.ts`, `basePackLine.test.ts` (B3/B4), `odds.test.ts` (5, 5b, 5c), `shop.test.tsx` (vitrina), `store.contract.test.tsx`, `f57.packOpening.test.tsx`.

## 27. Datos QA

Ninguno: no se ha abierto ni comprado ningún sobre en la demo ni en QA. Las lecturas de BD fueron solo SELECT.

## Consecuencias de producto (medidas, sin tocar precios)

| Sobre | Valor medio | Valor por crédito |
|---|---|---|
| Bronce | 4.568 | 6,09× (antes 2,85×) |
| Plata | 11.095 | 4,44× |
| Oro | 17.746 | 3,55× |
| Masters | 21.882 | 4,38× |
| Champions | 38.954 | 4,87× |
| **Icon** | **11.389** | **0,57×** (antes 2,79×, con 3 cartas) |

El valor por crédito ya no sube con el escalón. El test B3 que lo exigía se reescribió a lo que el contrato sí garantiza (más Prime e Icon en cada escalón). Ajustar precios queda como decisión aparte.

## 28. GO / NO-GO

**NO-GO provisional.** Todo lo contractual está verde: las 331 clasificadas, sin doble clase, sin cubo vacío, la simulación reproduce la tabla, Icon da 1 carta Prime/Icon y ningún especial ha cambiado. Pero falta `npm run build` y la comprobación en runtime de la ficha y la ceremonia. Con la build hecha y verificada en :3005, pasa a GO.

## Cierre (tras autorización)

- `npm run build` **PASS** (dos veces: la segunda tras alinear el arnés `design-system/fase57`, que pintaba su propia tira «1 / 1» con una carta; ahora, igual que la ceremonia real, no hay tira ni contador).
- `next start -p 3005` relanzado (PID 11564). Túnel SSH PID 15620 intacto. Solo se pararon los `next start` propios de :3005 (22764 y 26488, verificados antes).
- Runtime (`scripts/_fase57-3-runtime.ts`, sin sesión, sin comprar ni abrir): las fichas de Bronce, Plata, Oro, Masters, Champions e Icon enseñan su tabla exacta, sin rarezas. Icon: 20.000 créditos, «1 carta por sobre», Prime 70 % / Icon 30 %, «Prime o Icon garantizada». EWC, EMEA, China, Team Heretics, Fnatic e Inicial siguen con su reparto por rareza medido. En la ceremonia de Icon (arnés, 1440 y 390) hay un solo dorso, «1 carta», solo «Revelar», y el revelado va sin tira ni contador. Capturas y `runtime.json` en `docs/product/qa/fase57-3-pack-class/`.
- Tests finales 5007/5007.

**Veredicto: GO.**
